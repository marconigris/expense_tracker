import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { db, t } from "./db";
import { custodyBalances, custodyLedger, propertyYields, summarizeCustody } from "./reports";
import { ensureRates, shiftDate, usdPerUnit } from "./fx";
import { balanceAt, monthEnds, placeCustody, recordedBalance, wealthGroup, wealthTotals, type CustodyHolding, type WealthBucket } from "./wealth-math";
import { vehicleValue } from "./vehicle-math";

function valueVehicles(vehicles: (typeof t.vehicles.$inferSelect)[], month: string) {
  return vehicles.map((v) => ({ name: v.name, currency: v.currency, value: vehicleValue({ acquired: v.acquired, priceCents: Math.round(Number(v.price) * 100), share: Number(v.share), annualRate: Number(v.annualRate) }, month).value / 100 }));
}

/**
 * Accounts show Marco's own money: dad's holdings recorded per account are taken out. The bubbles subtract the
 * cash Marco owes dad and any of dad's bank money not yet placed in an account.
 */
export async function wealthView() {
  const [accounts, valuations, movements, custody, properties, custodyEntities, vehicles, purchases] = await Promise.all([
    db.select().from(t.accounts).where(eq(t.accounts.active, true)),
    db.select().from(t.valuations),
    db.select({ accountId: t.transactions.accountId, date: t.transactions.date, amount: t.transactions.amount,
      kind: t.transactions.kind, status: t.transactions.status, batchId: t.transactions.importBatchId }).from(t.transactions),
    custodyBalances(), propertyYields(),
    db.select({ id: t.entities.id, kind: t.entities.kind, name: t.entities.name }).from(t.entities),
    db.select().from(t.vehicles),
    db.select({ id: t.transactions.id, date: t.transactions.date, description: t.transactions.description, amount: t.transactions.amount, currency: t.transactions.currency }).from(t.transactions)
      .innerJoin(t.entities, eq(t.entities.id, t.transactions.entityId))
      .where(and(eq(t.transactions.status, "confirmed"), eq(t.transactions.kind, "normal"), lt(t.transactions.amount, "0"), inArray(t.entities.kind, ["personal", "household"])))
      .orderBy(desc(t.transactions.date)).limit(2000),
  ]);
  const custodyIds = new Set(custodyEntities.filter((e) => e.kind === "custody").map((e) => e.id));
  // Money a business owes Marco: latest valuation of that business with no account.
  const loans = custodyEntities.filter((e) => e.kind === "business").flatMap((e) => {
    const latest = valuations.filter((v) => v.entityId === e.id && !v.accountId).sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest && Number(latest.value) ? [{ name: e.name, currency: latest.currency, value: Number(latest.value), date: latest.date }] : [];
  });
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
  const foreign = [...new Set([...items.filter((a) => a.value).map((a) => a.currency), ...debts.map((c) => c.currency), ...vehicles.map((v) => v.currency)])].filter((c) => c !== "USD" && c !== "EUR");
  // Fresh rates are best effort: without network the latest stored rate is used.
  await ensureRates(foreign, shiftDate(today, -7), today).catch(() => undefined);
  const rates = Object.fromEntries(await Promise.all(foreign.map(async (c) => [c, await usdPerUnit(c, today)] as const)));
  const totals = wealthTotals(items.map((a) => ({ currency: a.currency, value: a.value, group: wealthGroup(a), name: a.name })), properties, rates, debts, loans, valueVehicles(vehicles, today));
  const missing = items.filter((a) => a.value == null);
  return { items: withData, otherAccounts: items.filter((a) => !withData.includes(a)), cash, placement, properties, loans, vehicles, purchases: purchases.filter((p) => !vehicles.some((v) => v.purchaseTransactionId === p.id)), totals, missing, rates };
}

/** Saves this month's totals (overwriting earlier saves this month) and returns every month recorded. */
export async function wealthHistory(totals: { usd: WealthBucket; eur: WealthBucket | null }) {
  const month = new Date().toISOString().slice(0, 7);
  const buckets: [string, WealthBucket][] = [["USD", totals.usd]];
  if (totals.eur) buckets.push(["EUR", totals.eur]);
  const rows = buckets.map(([currency, b]) => ({ month, currency, cash: b.cash.toFixed(2), stocks: b.stocks.toFixed(2), loans: b.loans.toFixed(2), properties: (b.properties + b.vehicles).toFixed(2),
      debt: b.custody.toFixed(2), total: b.total.toFixed(2), updatedAt: new Date() }));
  for (const row of rows) {
    await db.insert(t.wealthSnapshots).values(row).onConflictDoUpdate({ target: [t.wealthSnapshots.month, t.wealthSnapshots.currency], set: row });
  }
  const history = await db.select().from(t.wealthSnapshots).orderBy(asc(t.wealthSnapshots.month));
  return history.map((r) => ({ month: r.month, currency: r.currency, cash: Number(r.cash), stocks: Number(r.stocks), loans: Number(r.loans),
    properties: Number(r.properties), debt: Number(r.debt), total: Number(r.total) }));
}

type View = Awaited<ReturnType<typeof wealthView>>;
export type WealthPointRow = { month: string; currency: string; cash: number; stocks: number; loans: number; properties: number; debt: number; total: number };

/**
 * Month-end net worth since January, rebuilt from today's balances by undoing later movements. Dad's custody is
 * taken at each month end. Accounts with no imported movements are assumed unchanged and listed in `assumed`.
 */
export async function wealthTimeline(view: View, from = "2026-01") {
  const until = new Date().toISOString().slice(0, 7);
  const months = monthEnds(from, until);
  if (!months.length) return { points: [] as WealthPointRow[], assumed: [] as string[] };
  const [movements, ledger] = await Promise.all([
    db.select({ accountId: t.transactions.accountId, date: t.transactions.date, amount: t.transactions.amount,
      status: t.transactions.status, batchId: t.transactions.importBatchId, kind: t.transactions.kind }).from(t.transactions),
    custodyLedger(),
  ]);
  const accounts = [...view.items, ...view.otherAccounts].filter((a) => a.gross != null && a.date);
  const currencies = [...new Set([...accounts.map((a) => a.currency), ...ledger.map((m) => m.currency), ...view.vehicles.map((v) => v.currency)])].filter((c) => c !== "USD" && c !== "EUR");
  await ensureRates(currencies, `${from}-01`, months.at(-1)!.end).catch(() => undefined);
  const assumed = new Set<string>();
  const points: WealthPointRow[] = [];
  for (const { month, end } of months) {
    const balances = accounts.map((a) => {
      const b = balanceAt({ value: a.gross!, date: a.date! }, movements.filter((m) => m.accountId === a.id), end);
      if (b.assumed && b.value) assumed.add(a.name);
      return { currency: a.currency, value: b.value, group: wealthGroup(a), name: a.name };
    });
    const custody = summarizeCustody(ledger.filter((m) => m.date <= end));
    const debts = custody.map((c) => ({ currency: c.currency, balance: c.balance, name: "Plata de papá" }));
    const rates = Object.fromEntries(await Promise.all(currencies.map(async (c) => [c, await usdPerUnit(c, end)] as const)));
    // Loans are taken as owed all year, like accounts without movements.
    const totals = wealthTotals(balances, view.properties, rates, debts, view.loans, valueVehicles(view.vehicles, month));
    for (const [currency, b] of [["USD", totals.usd], ["EUR", totals.eur]] as const) {
      if (b) points.push({ month, currency, cash: b.cash, stocks: b.stocks, loans: b.loans, properties: b.properties + b.vehicles, debt: b.custody, total: b.total });
    }
  }
  return { points, assumed: [...assumed].sort() };
}
