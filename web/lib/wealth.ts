import { eq } from "drizzle-orm";
import { db, t } from "./db";
import { custodyBalances, propertyYields } from "./reports";
import { recordedBalance } from "./wealth-math";

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
  return { items: withData, otherAccounts: items.filter((a) => !withData.includes(a)), custody, properties };
}
