import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, t } from "./db";

const FROM = "2026-08-10";
const TO = "2026-09-30";

/** Confirmed European history; it never feeds the balance starting in October. */
export async function tarifaReport() {
  const [rows, pending] = await Promise.all([
    db.select({ id: t.transactions.id, date: t.transactions.date, description: t.transactions.description,
      amount: t.transactions.amount, currency: t.transactions.currency, paidBy: t.transactions.paidBy,
      category: t.transactions.category, account: t.accounts.name, marcoShare: t.entities.marcoShare })
      .from(t.transactions).innerJoin(t.entities, eq(t.transactions.entityId, t.entities.id))
      .leftJoin(t.accounts, eq(t.transactions.accountId, t.accounts.id))
      .where(and(eq(t.entities.slug, "hogar-europa"), eq(t.transactions.kind, "normal"), eq(t.transactions.status, "confirmed"),
        gte(t.transactions.date, FROM), lte(t.transactions.date, TO)))
      .orderBy(asc(t.transactions.date), asc(t.transactions.description)),
    db.select({ n: sql<number>`count(*)::int` }).from(t.transactions)
      .where(and(ne(t.transactions.status, "confirmed"), gte(t.transactions.date, FROM), lte(t.transactions.date, TO))),
  ]);
  const allocations = rows.length ? await db.select().from(t.transactionAllocations)
    .where(inArray(t.transactionAllocations.transactionId, rows.map((row) => row.id))) : [];
  const shares = new Map<string, { owner: string; amount: string }[]>();
  for (const a of allocations) shares.set(a.transactionId, [...(shares.get(a.transactionId) ?? []), { owner: a.owner, amount: a.amount }]);
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.paidBy}|${row.currency}`;
    totals.set(key, (totals.get(key) ?? 0) - Math.round(Number(row.amount) * 100));
  }
  return { rows: rows.map((row) => ({ ...row, shares: shares.get(row.id) ?? [] })), pending: pending[0].n, totals: [...totals].map(([key, cents]) => {
    const [paidBy, currency] = key.split("|");
    return { paidBy, currency, cents };
  }) };
}
