"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { importStatement, type ImportResult } from "@/lib/import/pipeline";

export async function importAction(_prev: ImportResult | null, form: FormData): Promise<ImportResult> {
  await requireOwner();
  const accountId = String(form.get("accountId") ?? "");
  const file = form.get("file");
  if (!accountId || !(file instanceof File) || file.size === 0) {
    return { batchId: null, format: "", imported: 0, duplicates: 0, errors: ["Elegí una cuenta y un archivo"] };
  }
  const result = await importStatement({
    accountId,
    filename: file.name,
    data: Buffer.from(await file.arrayBuffer()),
  });
  revalidatePath("/revisar");
  return result;
}

export type Decision = {
  id: string;
  entityId: string | null;
  category: string | null;
  kind: "normal" | "transfer" | "settlement" | "opening" | "excluded" | "receivable";
  paidBy?: "marco" | "moni";
  // Pattern to learn from this decision, e.g. "mercadona".
  rulePattern?: string;
};

export async function confirmAction(decisions: Decision[]) {
  const user = await requireOwner();
  for (const d of decisions) {
    await db
      .update(t.transactions)
      .set({
        entityId: d.kind === "transfer" || d.kind === "excluded" ? null : d.entityId,
        category: d.kind === "transfer" || d.kind === "excluded" ? null : d.category,
        kind: d.kind,
        ...(d.paidBy ? { paidBy: d.paidBy } : {}),
        status: "confirmed",
        createdBy: sql`coalesce(${t.transactions.createdBy}, ${user.id}::uuid)`,
      })
      .where(eq(t.transactions.id, d.id));

    const pattern = d.rulePattern?.trim().toLowerCase();
    if (d.kind !== "excluded" && pattern && pattern.length >= 3) {
      const [tx] = await db.select().from(t.transactions).where(eq(t.transactions.id, d.id));
      await db.insert(t.rules).values({
        pattern,
        accountId: tx.accountId,
        direction: Number(tx.amount) < 0 ? "out" : "in",
        entityId: d.kind === "transfer" ? null : d.entityId,
        category: d.kind === "transfer" ? null : d.category,
        kind: d.kind,
      });
    }
  }
  revalidatePath("/revisar");
  revalidatePath("/");
}

/** Accept every suggestion at or above `minConfidence` as it is. */
export async function confirmConfidentAction(minConfidence: number) {
  await requireOwner();
  await db
    .update(t.transactions)
    .set({ status: "confirmed" })
    .where(and(eq(t.transactions.status, "suggested"), sql`${t.transactions.confidence} >= ${minConfidence}`));
  revalidatePath("/revisar");
  revalidatePath("/");
}

export async function deleteBatchAction(batchId: string) {
  await requireOwner();
  // Only undo batches nobody has started reviewing.
  const confirmed = await db
    .select({ id: t.transactions.id })
    .from(t.transactions)
    .where(and(eq(t.transactions.importBatchId, batchId), eq(t.transactions.status, "confirmed")))
    .limit(1);
  if (confirmed.length) throw new Error("El lote ya tiene movimientos confirmados");
  await db.delete(t.importBatches).where(inArray(t.importBatches.id, [batchId]));
  revalidatePath("/importar");
  revalidatePath("/revisar");
}
