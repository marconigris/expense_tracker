import { and, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { custodyAmount, custodyForm, marcoReportedAmount, type CustodyForm, type OwnershipAllocation } from "./allocations";
import { db, t } from "./db";
import type { Entity } from "./db/schema";

export type Currency = "USD" | "EUR";

export type MonthSummary = {
  month: string; // YYYY-MM
  income: number; // money that reached Marco
  spending: number; // Marco's consumption, positive number
  bySource: Record<string, number>;
  bySpend: Record<string, number>;
};

/** First day of the month `n` months before the current one. */
function monthsAgo(n: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

async function allocationsFor(ids: string[]) {
  const byTransaction = new Map<string, OwnershipAllocation[]>();
  if (ids.length === 0) return byTransaction;
  const allocations = await db.select().from(t.transactionAllocations).where(inArray(t.transactionAllocations.transactionId, ids));
  for (const allocation of allocations) {
    const current = byTransaction.get(allocation.transactionId) ?? [];
    current.push({ owner: allocation.owner, amount: allocation.amount });
    byTransaction.set(allocation.transactionId, current);
  }
  return byTransaction;
}

/**
 * Marco's monthly picture from confirmed, normal movements:
 * - business / investment: the signed sum is what it gave him (ads or fees reduce it).
 * - property: only distributions count as income; Marco's ownership is applied unless the movement has an explicit split.
 * - personal: outflows are consumption, inflows are other income.
 * - household: Marco consumes his share of everything spent, whoever paid it.
 * - custody (dad's money) and transfers stay out.
 */
export async function monthlySummary(currency: Currency, months = 12) {
  const amount = currency === "USD" ? t.transactions.amountUsd : t.transactions.amountEur;
  const from = monthsAgo(months - 1);
  const reportDate = sql<string>`coalesce(${t.transactions.recognitionDate}, ${t.transactions.date})::text`;
  const rows = await db
    .select({
      id: t.transactions.id,
      date: reportDate,
      entityId: t.transactions.entityId,
      original: t.transactions.amount,
      converted: amount,
    })
    .from(t.transactions)
    .where(
      and(
        eq(t.transactions.status, "confirmed"),
        eq(t.transactions.kind, "normal"),
        gte(reportDate, from),
        sql`${t.transactions.entityId} is not null`,
      ),
    );

  const [entities, allocations] = await Promise.all([
    db.select().from(t.entities),
    allocationsFor(rows.map((r) => r.id)),
  ]);
  const byId = new Map(entities.map((e) => [e.id, e]));

  const summaries = new Map<string, MonthSummary>();
  for (let i = months - 1; i >= 0; i--) {
    const month = monthsAgo(i).slice(0, 7);
    summaries.set(month, { month, income: 0, spending: 0, bySource: {}, bySpend: {} });
  }

  const add = (bucket: Record<string, number>, key: string, v: number) => (bucket[key] = (bucket[key] ?? 0) + v);

  for (const r of rows) {
    const s = summaries.get(r.date.slice(0, 7));
    const e = r.entityId ? byId.get(r.entityId) : undefined;
    if (!s || !e) continue;
    const shares = allocations.get(r.id) ?? [];
    const converted = Number(r.converted ?? 0);
    const value = marcoReportedAmount(Number(r.original), converted, shares, e.kind, Number(e.marcoShare));
    switch (e.kind) {
      case "business":
      case "investment":
        add(s.bySource, e.name, value);
        break;
      case "property":
        if (value > 0) add(s.bySource, e.name, value);
        break;
      case "personal":
        if (value < 0) add(s.bySpend, e.name, -value);
        if (value > 0) add(s.bySource, "Otros ingresos", value);
        break;
      case "household":
        add(s.bySpend, e.name, -value);
        break;
    }
  }
  for (const s of summaries.values()) {
    s.income = Object.values(s.bySource).reduce((a, b) => a + b, 0);
    s.spending = Object.values(s.bySpend).reduce((a, b) => a + b, 0);
  }
  return [...summaries.values()];
}

/** Balance of dad's money held by Marco, per currency. */
/** Dad's balances by currency and form; with `asOf`, only movements on or before that date. */
export async function custodyBalances(asOf?: string) {
  return summarizeCustody((await custodyLedger()).filter((m) => !asOf || m.date <= asOf));
}

/** Every movement of dad's money, already reduced to his part. */
export async function custodyLedger() {
  const rows = await db
    .select({ id: t.transactions.id, date: t.transactions.date, currency: t.transactions.currency, amount: t.transactions.amount, entityKind: t.entities.kind,
      description: t.transactions.description, accountKind: t.accounts.kind })
    .from(t.transactions)
    .leftJoin(t.entities, eq(t.entities.id, t.transactions.entityId))
    .leftJoin(t.accounts, eq(t.accounts.id, t.transactions.accountId))
    .where(and(eq(t.transactions.status, "confirmed"), inArray(t.transactions.kind, ["normal", "opening", "settlement"])));
  const allocations = await allocationsFor(rows.map((r) => r.id));
  return rows.map((row) => ({ date: row.date, currency: row.currency, form: custodyForm(row.accountKind, row.description),
    value: custodyAmount(Number(row.amount), row.entityKind === "custody", allocations.get(row.id) ?? []) })).filter((m) => m.value !== 0);
}

export function summarizeCustody(ledger: { currency: string; form: CustodyForm; value: number }[]) {
  const totals = new Map<string, { currency: string; form: CustodyForm; balance: number }>();
  for (const m of ledger) {
    const item = totals.get(`${m.currency}:${m.form}`) ?? { currency: m.currency, form: m.form, balance: 0 };
    item.balance += m.value;
    totals.set(`${m.currency}:${m.form}`, item);
  }
  // USD before EUR, cash before bank; rounding to cents avoids float noise in the sums.
  return [...totals.values()].map((c) => ({ ...c, balance: Math.round(c.balance * 100) / 100 }))
    .sort((a, b) => b.currency.localeCompare(a.currency) || b.form.localeCompare(a.form));
}

export async function pendingCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.transactions)
    .where(ne(t.transactions.status, "confirmed"));
  return r.n;
}

/** Money advanced to others, less repayments, across all confirmed history. */
export async function receivableBalances(currency: Currency) {
  const amount = currency === "USD" ? t.transactions.amountUsd : t.transactions.amountEur;
  const rows = await db
    .select({ person: t.transactions.category, balance: sql<string>`-coalesce(sum(${amount}), 0)` })
    .from(t.transactions)
    .where(and(eq(t.transactions.status, "confirmed"), eq(t.transactions.kind, "receivable")))
    .groupBy(t.transactions.category);
  return rows.filter((r) => r.person && Number(r.balance) !== 0).map((r) => ({ person: r.person!, balance: Number(r.balance) }));
}

/** Capital Marco has in each property and what it returned in the last 12 months. */
export async function propertyYields() {
  const props = await db.select().from(t.entities).where(eq(t.entities.kind, "property"));
  const vals = await db.select().from(t.valuations);
  if (props.length === 0) return [];
  const returns = await db
    .select({ id: t.transactions.id, entityId: t.transactions.entityId, original: t.transactions.amount, converted: t.transactions.amountUsd })
    .from(t.transactions)
    .where(and(eq(t.transactions.status, "confirmed"), eq(t.transactions.kind, "normal"), gte(t.transactions.date, monthsAgo(11)),
      inArray(t.transactions.entityId, props.map((p) => p.id)), gt(t.transactions.amount, "0")));
  const allocations = await allocationsFor(returns.map((r) => r.id));
  return props.map((p: Entity) => {
    const latest = vals.filter((v) => v.entityId === p.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const stake = latest ? Number(latest.value) * Number(p.marcoShare) : 0;
    const returned = returns.filter((r) => r.entityId === p.id).reduce((sum, row) => {
      const shares = allocations.get(row.id) ?? [];
      return sum + marcoReportedAmount(Number(row.original), Number(row.converted ?? 0), shares, p.kind, Number(p.marcoShare));
    }, 0);
    return { slug: p.slug, name: p.name, share: Number(p.marcoShare), value: latest ? Number(latest.value) : 0, stake, stakeCurrency: latest?.currency ?? "USD", returned, yieldPct: stake ? returned / stake : null };
  });
}
