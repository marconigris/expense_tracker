import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, t } from "../db";
import type { NewTransaction } from "../db/schema";
import type { ImportResult } from "./pipeline";
import type { TaxReport } from "./revolut-tax";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const hash = (s: string) => createHash("sha1").update(s).digest("hex");

/** Imports only after all statement balances have reconciled. No automatic classifications. */
export async function importRevolutTax(report: TaxReport, filename: string, selectedAccountId: string): Promise<ImportResult> {
  const result: ImportResult = { batchId: null, format: "revolut-tax", imported: 0, duplicates: 0, errors: [] };
  if (report.errors.length) return { ...result, errors: report.errors };
  const accounts = await db.select().from(t.accounts).where(eq(t.accounts.institution, "Revolut"));
  if (!accounts.some((a) => a.id === selectedAccountId)) return { ...result, errors: ["Elegí una cuenta de Revolut para este informe"] };
  const bySlug = new Map(accounts.map((a) => [a.slug, a]));
  const missing = report.groups.filter((g) => !bySlug.has(g.slug));
  if (missing.length) return { ...result, errors: [`Faltan cuentas de Revolut: ${missing.map((g) => g.slug).join(", ")}`] };
  const accountIds = report.groups.map((g) => bySlug.get(g.slug)!.id);
  const [existing, rates] = await Promise.all([
    db.select({ accountId: t.transactions.accountId, date: t.transactions.date, amount: t.transactions.amount,
      description: t.transactions.description }).from(t.transactions).where(inArray(t.transactions.accountId, accountIds)),
    db.select().from(t.fxRates).where(eq(t.fxRates.currency, "EUR")),
  ]);
  rates.sort((a, b) => b.date.localeCompare(a.date));
  const latestDate = report.groups.flatMap((g) => g.rows.map((r) => r.date)).sort().at(-1);
  if (!latestDate) return { ...result, errors: ["El informe no contiene movimientos"] };
  const existingCount = new Map<string, number>();
  for (const row of existing) {
    const key = [row.accountId, row.date, Number(row.amount).toFixed(2), norm(row.description)].join("|");
    existingCount.set(key, (existingCount.get(key) ?? 0) + 1);
  }
  const occurrence = new Map<string, number>();
  const pending: { slug: string; rows: Omit<NewTransaction, "importBatchId">[] }[] = [];
  for (const group of report.groups) {
    const account = bySlug.get(group.slug)!;
    const rows: Omit<NewTransaction, "importBatchId">[] = [];
    for (const row of group.rows) {
      const key = [account.id, row.date, row.amount.toFixed(2), norm(row.description)].join("|");
      const nth = (occurrence.get(key) ?? 0) + 1;
      occurrence.set(key, nth);
      if (nth <= (existingCount.get(key) ?? 0)) { result.duplicates++; continue; }
      const rate = rates.find((r) => r.date <= row.date);
      if (!rate || row.sourceAmountEur === undefined) return { ...result, imported: 0, errors: [`Falta conversión EUR/USD para ${row.date}`] };
      const usd = group.currency === "USD" ? row.amount : row.sourceAmountEur * Number(rate.usdPerUnit);
      const baseKey = hash(key);
      rows.push({ accountId: account.id, date: row.date, description: row.description, amount: row.amount.toFixed(2),
        currency: group.currency, amountUsd: usd.toFixed(2), amountEur: row.sourceAmountEur.toFixed(2),
        dedupeKey: nth === 1 ? baseKey : hash(`${key}|row:${nth}`), status: "pending",
        notes: row.sourceCategory ? `Revolut: ${row.sourceCategory}.` : null });
    }
    pending.push({ slug: group.slug, rows });
  }
  const investments = await db.select({ id: t.entities.id }).from(t.entities).where(eq(t.entities.slug, "inversiones"));
  if (!investments.length) return { ...result, errors: ["Falta la entidad Inversiones"] };
  await db.transaction(async (tx) => {
    for (const group of pending) {
      if (!group.rows.length) continue;
      const account = bySlug.get(group.slug)!;
      const [batch] = await tx.insert(t.importBatches).values({ accountId: account.id, filename, format: "revolut-tax", rowCount: 0 }).returning();
      let batchInserted = 0;
      for (let i = 0; i < group.rows.length; i += 100) {
        const inserted = await tx.insert(t.transactions).values(group.rows.slice(i, i + 100).map((r) => ({ ...r, importBatchId: batch.id })))
          .onConflictDoNothing({ target: t.transactions.dedupeKey }).returning({ id: t.transactions.id });
        result.imported += inserted.length;
        batchInserted += inserted.length;
        result.duplicates += Math.min(100, group.rows.length - i) - inserted.length;
      }
      await tx.update(t.importBatches).set({ rowCount: batchInserted, skippedDuplicates: group.rows.length - batchInserted }).where(eq(t.importBatches.id, batch.id));
    }
    for (const group of report.groups) {
      if (group.closing === undefined) continue;
      const account = bySlug.get(group.slug)!;
      const prior = await tx.select({ id: t.valuations.id, value: t.valuations.value }).from(t.valuations)
        .where(and(eq(t.valuations.accountId, account.id), eq(t.valuations.date, latestDate), eq(t.valuations.currency, group.currency)));
      if (prior.length && Number(prior[0].value) !== group.closing) throw new Error(`Ya existe otro saldo para ${account.name}`);
      if (!prior.length) await tx.insert(t.valuations).values({ accountId: account.id, date: latestDate, currency: group.currency,
        value: group.closing.toFixed(2), notes: "Saldo de cierre del informe consolidado de Revolut. Verificar titularidad y movimientos posteriores." });
    }
  });
  if (report.cryptoSales) result.errors.push(`${report.cryptoSales} venta de cripto figura en el informe fiscal y queda pendiente de conciliar con el extracto de cripto.`);
  return result;
}
