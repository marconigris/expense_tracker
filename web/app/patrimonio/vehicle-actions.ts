"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { marcoReportedAmount } from "@/lib/allocations";
import { validIsoDate } from "@/lib/partner-input";

export type VehicleResult = { ok: boolean; message: string };

export async function addVehicle(_previous: VehicleResult | null, data: FormData): Promise<VehicleResult> {
  await requireOwner();
  try {
    const name = String(data.get("name") ?? "").trim();
    const acquired = String(data.get("acquired") ?? "");
    const transactionId = String(data.get("transaction") ?? "");
    const price = Number(String(data.get("price") ?? "").replace(",", "."));
    const share = Number(data.get("share")) / 100;
    const annualRate = Number(data.get("annualRate")) / 100;
    if (!name || name.length > 100 || !validIsoDate(acquired) || !Number.isFinite(price) || price <= 0 || price > 1e9 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001 || !Number.isFinite(share) || share <= 0 || share > 1 || !Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1 || !/^[0-9a-f-]{36}$/i.test(transactionId)) return { ok: false, message: "Revisá los datos del auto y elegí el pago de compra." };
    const [row] = await db.select({ tx: t.transactions, entity: t.entities }).from(t.transactions).innerJoin(t.entities, eq(t.entities.id, t.transactions.entityId)).where(and(eq(t.transactions.id, transactionId), eq(t.transactions.kind, "normal"), eq(t.transactions.status, "confirmed"))).limit(1);
    if (!row || !["personal", "household"].includes(row.entity.kind) || Number(row.tx.amount) >= 0 || price > Math.abs(Number(row.tx.amount))) return { ok: false, message: "El pago elegido no alcanza para esa compra o no es un gasto personal o compartido." };
    const allocations = await db.select().from(t.transactionAllocations).where(eq(t.transactionAllocations.transactionId, transactionId));
    const marco = Math.abs(marcoReportedAmount(Number(row.tx.amount), Number(row.tx.amount), allocations, row.entity.kind, Number(row.entity.marcoShare)));
    if (price * share > marco + 0.005) return { ok: false, message: "Tu parte del auto supera tu parte del pago elegido." };
    const [created] = await db.insert(t.vehicles).values({ name, acquired, price: price.toFixed(2), currency: row.tx.currency, share: share.toFixed(4), annualRate: annualRate.toFixed(4), purchaseTransactionId: transactionId }).onConflictDoNothing({ target: t.vehicles.purchaseTransactionId }).returning({ id: t.vehicles.id });
    if (!created) return { ok: false, message: "Ese pago ya está asociado a un auto." };
    revalidatePath("/"); revalidatePath("/patrimonio");
    return { ok: true, message: "Auto guardado en patrimonio." };
  } catch {
    return { ok: false, message: "No se pudo guardar el auto. Revisá el pago y volvé a intentar." };
  }
}
