import { Suspense } from "react";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { PeriodTransactions } from "./transactions";

export default function PeriodPage() {
  return <Suspense fallback={<p className="text-muted">Cargando movimientos…</p>}><Content /></Suspense>;
}

async function Content() {
  await connection();
  await requireOwner();
  const rows = await db.select({ tx: t.transactions, account: t.accounts.name, entity: t.entities.name,
    entityKind: t.entities.kind, marcoShare: t.entities.marcoShare, sharedWithMoni: t.entities.sharedWithMoni })
    .from(t.transactions)
    .leftJoin(t.accounts, eq(t.accounts.id, t.transactions.accountId))
    .leftJoin(t.entities, eq(t.entities.id, t.transactions.entityId))
    .where(and(gte(t.transactions.date, "2026-08-10"), lte(t.transactions.date, "2026-09-30")))
    .orderBy(asc(t.transactions.date), asc(t.transactions.description), asc(t.transactions.id));
  const allocations = rows.length ? await db.select().from(t.transactionAllocations)
    .where(inArray(t.transactionAllocations.transactionId, rows.map(({ tx }) => tx.id))) : [];
  const byId = new Map<string, { owner: string; amount: number }[]>();
  for (const a of allocations) byId.set(a.transactionId, [...(byId.get(a.transactionId) ?? []), { owner: a.owner, amount: Number(a.amount) }]);
  return <PeriodTransactions rows={rows.map(({ tx, account, entity, entityKind, marcoShare, sharedWithMoni }) => ({
    id: tx.id, date: tx.date, description: tx.description, amount: Number(tx.amount), currency: tx.currency,
    amountUsd: tx.amountUsd == null ? null : Number(tx.amountUsd), account: account ?? "Sin cuenta",
    entity, entityKind, sharedWithMoni: sharedWithMoni ?? false, marcoShare: marcoShare == null ? null : Number(marcoShare),
    category: tx.category, kind: tx.kind, status: tx.status, paidBy: tx.paidBy, notes: tx.notes,
    allocations: byId.get(tx.id) ?? [],
  }))} />;
}
