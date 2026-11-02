import { eq } from "drizzle-orm";
import { db, t } from "./db";
import { custodyBalances, propertyYields } from "./reports";
import { ensureRates, shiftDate, usdPerUnit } from "./fx";
import { recordedBalance, wealthGroup, wealthTotals } from "./wealth-math";

/** Snapshots and account statements are gross balances. Unknown openings stay unknown. */
export async function wealthView() {
  const [accounts, valuations, movements, custody, properties] = await Promise.all([
    db.select().from(t.accounts).where(eq(t.accounts.active, true)),
    db.select().from(t.valuations),
    db.select({ accountId: t.transactions.accountId, date: t.transactions.date, amount: t.transactions.amount,
      kind: t.transactions.kind, status: t.transactions.status, batchId: t.transactions.importBatchId }).from(t.transactions),
    custodyBalances(), propertyYields(),
  ]);
  const items = accounts.map((account) => {
    const txs = movements.filter((t) => t.accountId === account.id);
    const balance = recordedBalance(txs, valuations.filter((v) => v.accountId === account.id && v.currency === account.currency));
    return { ...account, ...balance };
  });
  const withData = items.filter((a) => a.value != null || movements.some((m) => m.accountId === a.id));
  const today = new Date().toISOString().slice(0, 10);
  const foreign = [...new Set([...items.filter((a) => a.value).map((a) => a.currency), ...custody.map((c) => c.currency)])].filter((c) => c !== "USD" && c !== "EUR");
  // Fresh rates are best effort: without network the latest stored rate is used.
  await ensureRates(foreign, shiftDate(today, -7), today).catch(() => undefined);
  const rates = Object.fromEntries(await Promise.all(foreign.map(async (c) => [c, await usdPerUnit(c, today)] as const)));
  const totals = wealthTotals(items.map((a) => ({ currency: a.currency, value: a.value, group: wealthGroup(a) })), properties, rates, custody);
  const missing = items.filter((a) => a.value == null);
  return { items: withData, otherAccounts: items.filter((a) => !withData.includes(a)), custody, properties, totals, missing };
}
