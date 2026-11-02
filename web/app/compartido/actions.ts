"use server";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { ensureRates } from "@/lib/fx";
import { parseCsv } from "@/lib/import/csv";
import { parsePartnerRevolut } from "@/lib/import/partner-revolut";
import { isPartnerExpenseSpace, PARTNER_AREAS, partnerArea, partnerCsvKey, partnerSplit, validatePartnerExpense, type PartnerExpense } from "@/lib/partner-input";

export type PartnerResult = { ok: boolean; message: string; requestId?: string };
export type PreviewResult = { ok: boolean; message: string; source?: string; rows?: (PartnerExpense & { suggestedArea?: string })[]; skipped?: number };

function safeMessage(error: unknown, fallback: string) {
  return error instanceof Error && /^(Revisá|Elegí|Indicá|Ingresá|Volvé|Falta la cotización|El archivo)/.test(error.message) ? error.message : fallback;
}

function formPercent(value: FormDataEntryValue | null) {
  const n = Number(value);
  if (value == null || ![0, 50, 100].includes(n)) throw new Error("Elegí un reparto válido.");
  return n;
}

async function addExpenses(userId: string, areaInput: string, percent: number, rows: { expense: PartnerExpense; key: string; source: string | null }[]) {
  const area = partnerArea(areaInput);
  const slug = PARTNER_AREAS[area];
  partnerSplit(1, percent);
  if (!rows.length || rows.length > 500) throw new Error("Elegí entre 1 y 500 gastos.");
  const dates = rows.map((r) => r.expense.date).sort();
  if (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`) > 370 * 86400_000) throw new Error("Elegí gastos de un período de hasta un año por vez.");
  await ensureRates([...rows.map((r) => r.expense.currency), "EUR"], dates[0], dates[dates.length - 1]);
  const currencies = [...new Set(rows.map((r) => r.expense.currency).filter((c) => c !== "USD").concat("EUR"))];
  const fx = await db.select().from(t.fxRates).where(and(inArray(t.fxRates.currency, currencies), lte(t.fxRates.date, dates[dates.length - 1]))).orderBy(t.fxRates.date);
  const rate = (currency: string, date: string) => {
    if (currency === "USD") return 1;
    const match = fx.filter((r) => r.currency === currency && r.date <= date).at(-1);
    if (!match || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${match.date}T00:00:00Z`) > 7 * 86400_000 || !Number.isFinite(Number(match.usdPerUnit)) || Number(match.usdPerUnit) <= 0) throw new Error(`Falta la cotización de ${currency} para ${date}.`);
    return Number(match.usdPerUnit);
  };
  const values = rows.map(({ expense, key, source }) => {
    const amount = -expense.amount;
    const usd = amount * rate(expense.currency, expense.date);
    const eur = expense.currency === "EUR" ? amount : usd / rate("EUR", expense.date);
    return { userId, date: expense.date, description: expense.description, amount: amount.toFixed(2), currency: expense.currency,
      amountUsd: usd.toFixed(2), amountEur: eur.toFixed(2), area, source, dedupeKey: key };
  });
  const result = await db.transaction(async (tx) => {
    const [space] = slug ? await tx.select().from(t.entities).where(eq(t.entities.slug, slug)) : [];
    if (slug && (!space || !isPartnerExpenseSpace(space) || space.kind !== "household")) throw new Error("Elegí una categoría compartida válida.");
    const inserted = await tx.insert(t.partnerExpenses).values(values).onConflictDoNothing({ target: t.partnerExpenses.dedupeKey }).returning({ id: t.partnerExpenses.id, dedupeKey: t.partnerExpenses.dedupeKey });
    if (inserted.length && space) {
      const keys = inserted.map((r) => r.dedupeKey);
      const chosen = values.filter((v) => keys.includes(v.dedupeKey));
      const transactions = await tx.insert(t.transactions).values(chosen.map((row) => ({
        accountId: null, date: row.date, description: row.description, amount: row.amount, currency: row.currency,
        amountUsd: row.amountUsd, amountEur: row.amountEur, kind: "normal" as const, entityId: space.id, category: "Otros",
        status: "confirmed" as const, paidBy: "moni" as const, suggestedBy: "manual" as const, createdBy: userId,
        dedupeKey: row.dedupeKey, notes: row.source ? `Gasto compartido seleccionado por Moni de su CSV (${row.source}).` : "Gasto compartido cargado por Moni desde sus fondos.",
      }))).returning({ id: t.transactions.id, amount: t.transactions.amount });
      const allocations = transactions.flatMap((row) => {
        const split = partnerSplit(Math.abs(Number(row.amount)), percent);
        return [{ transactionId: row.id, owner: "marco" as const, amount: split.marco }, { transactionId: row.id, owner: "moni" as const, amount: split.moni }];
      });
      await tx.insert(t.transactionAllocations).values(allocations);
      await tx.update(t.partnerExpenses).set({ transactionId: sql`(select ${t.transactions.id} from ${t.transactions} where ${t.transactions.dedupeKey} = ${t.partnerExpenses.dedupeKey})` })
        .where(and(eq(t.partnerExpenses.userId, userId), inArray(t.partnerExpenses.dedupeKey, keys)));
    }
    return inserted.length;
  });
  for (const path of ["/", "/moni", "/compartido", "/revisar"]) revalidatePath(path);
  return result;
}

export async function addManualExpense(_previous: PartnerResult | null, form: FormData): Promise<PartnerResult> {
  const user = await requirePartner();
  const requestId = String(form.get("requestId") ?? "");
  try {
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Volvé a cargar la página para guardar el gasto.");
    const amountText = String(form.get("amount") ?? "").trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) throw new Error("Ingresá un monto válido.");
    const expense = validatePartnerExpense({ date: String(form.get("date") ?? ""), description: String(form.get("description") ?? ""), amount: Number(amountText), currency: String(form.get("currency") ?? "") });
    const key = createHash("sha256").update(`moni-manual:${user.id}:${requestId}`).digest("hex");
    const count = await addExpenses(user.id, String(form.get("area") ?? ""), formPercent(form.get("percent")), [{ expense, key, source: null }]);
    return { ok: true, message: count ? "Gasto guardado." : "Este gasto ya estaba guardado.", requestId: randomUUID() };
  } catch (error) {
    return { ok: false, message: safeMessage(error, "No pudimos guardar el gasto. Probá de nuevo."), requestId };
  }
}

export async function previewPartnerCsv(_previous: PreviewResult | null, form: FormData): Promise<PreviewResult> {
  const user = await requirePartner();
  const file = form.get("file");
  const source = String(form.get("source") ?? "").trim();
  const fallbackCurrency = String(form.get("currency") ?? "").toUpperCase();
  if (!(file instanceof File) || !/\.csv$/i.test(file.name) || file.size === 0 || file.size > 1_000_000 || !source || source.length > 100) return { ok: false, message: "Elegí un CSV de hasta 1 MB e indicá el banco o tarjeta." };
  const text = await file.text();
  const consolidated = parsePartnerRevolut(text);
  if (consolidated?.errors.length) return { ok: false, message: `No pude leer todo el extracto: ${consolidated.errors[0]} Revisá el archivo antes de importarlo.` };
  const parsed = consolidated ?? parseCsv(text);
  if (parsed.rows.length > 500) return { ok: false, message: "El archivo supera 500 movimientos. Dividilo en archivos más chicos." };
  const seen = new Map<string, number>();
  const rows: PartnerExpense[] = [];
  let skipped = parsed.errors.length;
  for (const row of parsed.rows) {
    if (row.amount >= 0) { skipped++; continue; }
    try {
      const base = validatePartnerExpense({ date: row.date, description: row.description, amount: Math.abs(row.amount), currency: row.currency || fallbackCurrency, reference: row.reference });
      const identity = JSON.stringify([base.date, base.description.toLocaleLowerCase("es"), base.amount, base.currency, base.reference ?? ""]);
      const occurrence = seen.get(identity) ?? 0;
      seen.set(identity, occurrence + 1);
      rows.push({ ...base, occurrence });
    } catch { skipped++; }
  }
  if (!rows.length) return { ok: false, message: parsed.errors[0] ?? "No encontré gastos compatibles en el archivo." };
  const previous = await db.select({ description: t.partnerExpenses.description, area: t.partnerExpenses.area }).from(t.partnerExpenses)
    .where(eq(t.partnerExpenses.userId, user.id));
  const areas = new Map<string, Set<string>>();
  for (const item of previous) {
    if (!Object.hasOwn(PARTNER_AREAS, item.area)) continue;
    const key = item.description.trim().toLocaleLowerCase("es");
    const known = areas.get(key) ?? new Set<string>();
    known.add(item.area); areas.set(key, known);
  }
  return { ok: true, message: "Elegí los gastos que quieras cargar.", source, rows: rows.map((row) => {
    const known = areas.get(row.description.trim().toLocaleLowerCase("es"));
    return known?.size === 1 ? { ...row, suggestedArea: [...known][0] } : row;
  }), skipped };
}

export async function importPartnerCsv(_previous: PartnerResult | null, form: FormData): Promise<PartnerResult> {
  const user = await requirePartner();
  try {
    const source = String(form.get("source") ?? "").trim();
    if (!source || source.length > 100) throw new Error("Indicá el banco o tarjeta.");
    const selected = form.getAll("row");
    if (!selected.length || selected.length > 500) throw new Error("Elegí al menos un gasto compartido.");
    const rows = selected.map((value) => {
      const raw = JSON.parse(String(value)) as PartnerExpense;
      const expense = validatePartnerExpense(raw);
      return { expense, key: partnerCsvKey(user.id, source, expense), source };
    });
    if (new Set(rows.map((r) => r.key)).size !== rows.length) throw new Error("El archivo contiene selecciones repetidas.");
    const count = await addExpenses(user.id, String(form.get("area") ?? ""), formPercent(form.get("percent")), rows);
    return { ok: true, message: `${count} gastos guardados · ${rows.length - count} ya estaban cargados.`, requestId: randomUUID() };
  } catch (error) {
    return { ok: false, message: safeMessage(error, "No pudimos importar los gastos. Probá de nuevo.") };
  }
}

export async function deleteOwnExpense(form: FormData) {
  const user = await requirePartner();
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Movimiento inválido.");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.partnerExpenses).where(and(eq(t.partnerExpenses.id, id), eq(t.partnerExpenses.userId, user.id)));
    if (!row) throw new Error("No podés modificar este movimiento.");
    if (row.transactionId) {
      const deleted = await tx.delete(t.transactions).where(and(eq(t.transactions.id, row.transactionId), eq(t.transactions.createdBy, user.id), eq(t.transactions.paidBy, "moni"),
        eq(t.transactions.kind, "normal"), isNull(t.transactions.accountId),
        inArray(t.transactions.entityId, tx.select({ id: t.entities.id }).from(t.entities).where(and(eq(t.entities.sharedWithMoni, true), eq(t.entities.kind, "household"))))))
        .returning({ id: t.transactions.id });
      if (!deleted.length) throw new Error("No podés modificar este movimiento.");
    } else await tx.delete(t.partnerExpenses).where(and(eq(t.partnerExpenses.id, id), eq(t.partnerExpenses.userId, user.id)));
  });
  for (const path of ["/", "/moni", "/compartido"]) revalidatePath(path);
}
