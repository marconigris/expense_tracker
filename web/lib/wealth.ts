import { asc, eq } from "drizzle-orm";
import { db, t } from "./db";
import { custodyBalances, propertyYields } from "./reports";
import { ensureRates, shiftDate, usdPerUnit } from "./fx";
import { placeCustody, recordedBalance, wealthGroup, wealthTotals, type CustodyHolding, type WealthBucket } from "./wealth-math";

/**
 * Accounts show Marco's own money: dad's holdings recorded per account are taken out. The bubbles subtract the
 * cash Marco owes dad and any of dad's bank money not yet placed in an account.
 */
export async function wealthView() {
  const [accounts, valuations, movements, custody, properties, custodyEntities] = await Promise.all([
    db.select().from(t.accounts).where(eq(t.accounts.active, true)),
    db.select().from(t.valuations),
    db.select({ accountId: t.transactions.accountId, date: t.transactions.date, amount: t.transactions.amount,
      kind: t.transactions.kind, status: t.transactions.status, batchId: t.transactions.importBatchId }).from(t.transactions),
    custodyBalances(), propertyYields(),
    db.select({ id: t.entities.id }).from(t.entities).where(eq(t.entities.kind, "custody")),
  ]);
  const custodyIds = new Set(custodyEntities.map((e) => e.id));
  const latestHolding = new Map<string, (typeof valuations)[number]>();
  for (const v of valuations) {
    if (!v.accountId || !v.entityId || !custodyIds.has(v.entityId)) continue;
    const prev = latestHolding.get(v.accountId);
    if (!prev || v.date > prev.date) latestHolding.set(v.accountId, v);
  }
  const items = accounts.map((account) => {
    const txs = movements.filter((t) => t.accountId === account.id);
    const balance = recordedBalance(txs, valuations.filter((v) => v.accountId === account.id && !v.entityId && v.currency === account.currency));
    const holding = latestHolding.get(account.id);
    const dad = holding && holding.currency === account.currency ? Number(holding.value) : 0;
    return { ...account, ...balance, gross: balance.value, dad, value: balance.value == null ? null : Math.round((balance.value - dad) * 100) / 100 };
  });
  const withData = items.filter((a) => a.value != null || movements.some((m) => m.accountId === a.id));
  const holdings: CustodyHolding[] = items.filter((a) => a.dad).map((a) => ({ accountId: a.id, name: a.name, currency: a.currency, value: a.dad }));
  const cash = custody.filter((c) => c.form === "cash");
  const placement = placeCustody(custody.filter((c) => c.form === "bank"), holdings);
  const debts = [
    ...cash.map((c) => ({ currency: c.currency, balance: c.balance, name: "Efectivo que le debés a papá" })),
    ...placement.filter((p) => p.unplaced).map((p) => ({ currency: p.currency, balance: p.unplaced, name: "Plata de papá sin ubicar en una cuenta" })),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const foreign = [...new Set([...items.filter((a) => a.value).map((a) => a.currency), ...debts.map((c) => c.currency)])].filter((c) => c !== "USD" && c !== "EUR");
  // Fresh rates are best effort: without network the latest stored rate is used.
  await ensureRates(foreign, shiftDate(today, -7), today).catch(() => undefined);
  const rates = Object.fromEntries(await Promise.all(foreign.map(async (c) => [c, await usdPerUnit(c, today)] as const)));
  const totals = wealthTotals(items.map((a) => ({ currency: a.currency, value: a.value, group: wealthGroup(a), name: a.name })), properties, rates, debts);
  const missing = items.filter((a) => a.value == null);
  return { items: withData, otherAccounts: items.filter((a) => !withData.includes(a)), cash, placement, properties, totals, missing, rates };
}

/** Saves this month's totals (overwriting earlier saves this month) and returns every month recorded. */
export async function wealthHistory(totals: { usd: WealthBucket; eur: WealthBucket | null }) {
  const month = new Date().toISOString().slice(0, 7);
  const buckets: [string, WealthBucket][] = [["USD", totals.usd]];
  if (totals.eur) buckets.push(["EUR", totals.eur]);
  const rows = buckets.map(([currency, b]) => ({ month, currency, cash: b.cash.toFixed(2), stocks: b.stocks.toFixed(2), properties: b.properties.toFixed(2),
      debt: b.custody.toFixed(2), total: b.total.toFixed(2), updatedAt: new Date() }));
  for (const row of rows) {
    await db.insert(t.wealthSnapshots).values(row).onConflictDoUpdate({ target: [t.wealthSnapshots.month, t.wealthSnapshots.currency], set: row });
  }
  const history = await db.select().from(t.wealthSnapshots).orderBy(asc(t.wealthSnapshots.month));
  return history.map((r) => ({ month: r.month, currency: r.currency, cash: Number(r.cash), stocks: Number(r.stocks),
    properties: Number(r.properties), debt: Number(r.debt), total: Number(r.total) }));
}
