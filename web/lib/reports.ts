import { and, eq, gte, ne, sql } from "drizzle-orm";
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

/**
 * Marco's monthly picture from confirmed, normal movements:
 * - business / investment: the signed sum is what it gave him (ads or fees reduce it).
 * - property: only distributions count as income; contributions are capital, not spending.
 * - personal: outflows are consumption, inflows are other income.
 * - household: Marco consumes his share of everything spent, whoever paid it.
 * - custody (dad's money) and transfers stay out.
 */
export async function monthlySummary(currency: Currency, months = 12) {
  const amount = currency === "USD" ? t.transactions.amountUsd : t.transactions.amountEur;
  const from = monthsAgo(months - 1);
  const rows = await db
    .select({
      month: sql<string>`to_char(${t.transactions.date}, 'YYYY-MM')`,
      entityId: t.transactions.entityId,
      inflow: sql<string>`coalesce(sum(${amount}) filter (where ${amount} > 0), 0)`,
      outflow: sql<string>`coalesce(sum(${amount}) filter (where ${amount} < 0), 0)`,
    })
    .from(t.transactions)
    .where(
      and(
        eq(t.transactions.status, "confirmed"),
        eq(t.transactions.kind, "normal"),
        gte(t.transactions.date, from),
        sql`${t.transactions.entityId} is not null`,
      ),
    )
    .groupBy(sql`1`, t.transactions.entityId);

  const entities = await db.select().from(t.entities);
  const byId = new Map(entities.map((e) => [e.id, e]));

  const summaries = new Map<string, MonthSummary>();
  for (let i = months - 1; i >= 0; i--) {
    const month = monthsAgo(i).slice(0, 7);
    summaries.set(month, { month, income: 0, spending: 0, bySource: {}, bySpend: {} });
  }

  const add = (bucket: Record<string, number>, key: string, v: number) => (bucket[key] = (bucket[key] ?? 0) + v);

  for (const r of rows) {
    const s = summaries.get(r.month);
    const e = r.entityId ? byId.get(r.entityId) : undefined;
    if (!s || !e) continue;
    const inflow = Number(r.inflow);
    const outflow = -Number(r.outflow);
    switch (e.kind) {
      case "business":
      case "investment":
        add(s.bySource, e.name, inflow - outflow);
        break;
      case "property":
        add(s.bySource, e.name, inflow);
        break;
      case "personal":
        add(s.bySpend, e.name, outflow);
        if (inflow) add(s.bySource, "Otros ingresos", inflow);
        break;
      case "household":
        add(s.bySpend, e.name, (outflow - inflow) * Number(e.marcoShare));
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
export async function custodyBalances() {
  return db
    .select({ currency: t.transactions.currency, balance: sql<string>`sum(${t.transactions.amount})` })
    .from(t.transactions)
    .innerJoin(t.entities, eq(t.entities.id, t.transactions.entityId))
    .where(and(eq(t.entities.kind, "custody"), ne(t.transactions.kind, "transfer")))
    .groupBy(t.transactions.currency);
}

export async function pendingCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.transactions)
    .where(ne(t.transactions.status, "confirmed"));
  return r.n;
}

/** Capital Marco has in each property and what it returned in the last 12 months. */
export async function propertyYields() {
  const amount = t.transactions.amountUsd;
  const props = await db.select().from(t.entities).where(eq(t.entities.kind, "property"));
  const vals = await db.select().from(t.valuations);
  const returns = await db
    .select({ entityId: t.transactions.entityId, total: sql<string>`coalesce(sum(${amount}) filter (where ${amount} > 0), 0)` })
    .from(t.transactions)
    .where(and(eq(t.transactions.status, "confirmed"), gte(t.transactions.date, monthsAgo(11))))
    .groupBy(t.transactions.entityId);
  return props.map((p: Entity) => {
    const latest = vals.filter((v) => v.entityId === p.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const stake = latest ? Number(latest.value) * Number(p.marcoShare) : 0;
    const returned = Number(returns.find((r) => r.entityId === p.id)?.total ?? 0);
    return { name: p.name, share: Number(p.marcoShare), stake, stakeCurrency: latest?.currency ?? "USD", returned, yieldPct: stake ? returned / stake : null };
  });
}
