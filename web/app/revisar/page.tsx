import { requireOwner } from "@/lib/auth";
import { asc, eq, ne } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { CATEGORIES } from "@/lib/catalog";
import { db, t } from "@/lib/db";
import { Inbox } from "./inbox";

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Revisar movimientos</h1>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  await requireOwner();
  const [rows, entities] = await Promise.all([
    db
      .select({ tx: t.transactions, account: t.accounts.name })
      .from(t.transactions)
      .leftJoin(t.accounts, eq(t.accounts.id, t.transactions.accountId))
      .where(ne(t.transactions.status, "confirmed"))
      .orderBy(asc(t.transactions.confidence), asc(t.transactions.date))
      .limit(500),
    db.select().from(t.entities).where(eq(t.entities.active, true)).orderBy(asc(t.entities.sortOrder)),
  ]);
  return (
    <Inbox
      rows={rows.map(({ tx, account }) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: Number(tx.amount),
        currency: tx.currency,
        amountUsd: tx.amountUsd == null ? null : Number(tx.amountUsd),
        account: account ?? "A mano",
        kind: tx.kind,
        entityId: tx.entityId,
        category: tx.category,
        confidence: tx.confidence,
        suggestedBy: tx.suggestedBy,
      }))}
      entities={entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind, shortcut: e.shortcut, categories: CATEGORIES[e.kind] ?? [] }))}
    />
  );
}
