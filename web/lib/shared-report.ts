import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, t } from "./db";
import { MONI_SETTLEMENT_START } from "./catalog";
import { settlementCents, settlementCurrency } from "./settlement";
import type { OwnershipAllocation } from "./allocations";

export async function sharedReport() {
  const [entities, pending] = await Promise.all([
    db.select().from(t.entities).where(eq(t.entities.sharedWithMoni, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(t.transactions)
      .where(and(ne(t.transactions.status, "confirmed"), gte(t.transactions.date, MONI_SETTLEMENT_START))),
  ]);
  const pendingSinceCutoff = pending[0].n;
  if (!entities.length) return { entities: [], totals: [], details: [], needsReview: 0, pendingSinceCutoff };
  const rows = await db.select({ tx: t.transactions, entity: t.entities }).from(t.transactions)
    .innerJoin(t.entities, eq(t.transactions.entityId, t.entities.id))
    .where(and(eq(t.transactions.status, "confirmed"), gte(t.transactions.date, MONI_SETTLEMENT_START),
      inArray(t.transactions.kind, ["normal", "settlement"]), inArray(t.entities.id, entities.map((e) => e.id))));
  const allocations = rows.length ? await db.select().from(t.transactionAllocations)
    .where(inArray(t.transactionAllocations.transactionId, rows.map(({ tx }) => tx.id))) : [];
  const shares = new Map<string, OwnershipAllocation[]>();
  for (const a of allocations) shares.set(a.transactionId, [...(shares.get(a.transactionId) ?? []), { owner: a.owner, amount: a.amount }]);
  const totals = new Map<string, number>();
  const groups = new Map<string, Map<string, number>>();
  let needsReview = 0;
  const details = rows.flatMap(({ tx, entity }) => {
    const cents = settlementCents({ date: tx.date, amount: Number(tx.amount), paidBy: tx.paidBy,
      kind: tx.kind as "normal" | "settlement", accountId: tx.accountId, entityKind: entity.kind,
      category: tx.category, marcoShare: Number(entity.marcoShare), allocations: shares.get(tx.id) ?? [] });
    if (cents == null) { needsReview++; return []; }
    if (!cents) return [];
    const currency = settlementCurrency(tx.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + cents);
    const group = groups.get(entity.id) ?? new Map<string, number>();
    group.set(currency, (group.get(currency) ?? 0) + cents); groups.set(entity.id, group);
    return [{ id: tx.id, date: tx.date, description: tx.description, entity: entity.name, currency, cents, paidBy: tx.paidBy, kind: tx.kind, amount: Number(tx.amount) }];
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { entities: entities.map((e) => ({ id: e.id, name: e.name, balances: [...(groups.get(e.id) ?? [])].map(([currency, cents]) => ({ currency, cents })) })),
    totals: [...totals].map(([currency, cents]) => ({ currency, cents })), details, needsReview, pendingSinceCutoff };
}
