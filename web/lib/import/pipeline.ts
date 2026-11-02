import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { classifyPending } from "../classify";
import { db, t } from "../db";
import type { Account } from "../db/schema";
import { convert, ensureRates } from "../fx";
import { parseCsv, type ParsedRow } from "./csv";
import { wiseCashbackRecognitionDate } from "../recognition-date";

export type ImportResult = {
  batchId: string | null;
  format: string;
  imported: number;
  duplicates: number;
  errors: string[];
  classified?: Awaited<ReturnType<typeof classifyPending>>;
};

const normalizeDescription = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Multi-currency exports (Revolut, Wise) list every pocket in one file, so each row goes
 * to the sibling account of the same institution that holds its currency.
 */
function routeRow(row: ParsedRow, selected: Account, siblings: Account[]): Account | null {
  const currency = row.currency ?? selected.currency;
  const wantsSavings = row.product ? /savings|deposit|ahorro/i.test(row.product) : selected.kind === "savings";
  if (selected.currency === currency && (selected.kind === "savings") === wantsSavings) return selected;
  const candidates = siblings.filter((a) => a.currency === currency && a.active);
  return candidates.find((a) => (a.kind === "savings") === wantsSavings) ?? candidates[0] ?? null;
}

export async function importStatement(input: { accountId: string; filename: string; data: Buffer }): Promise<ImportResult> {
  if (input.filename.toLowerCase().endsWith(".pdf")) {
    return { batchId: null, format: "pdf", imported: 0, duplicates: 0, errors: ["Los PDF se importan desde la Mac con: npm run codex:pdf"] };
  }
  const { rows, format, errors } = parseCsv(input.data.toString("utf8"));
  return importRows({ accountId: input.accountId, filename: input.filename, format, rows, errors });
}

/** Stores already-parsed rows: routing, dedupe, FX and first-pass classification. */
export async function importRows(input: {
  accountId: string;
  filename: string;
  format: string;
  rows: ParsedRow[];
  errors?: string[];
}): Promise<ImportResult> {
  const { rows, format } = input;
  const errors = [...(input.errors ?? [])];
  const [selected] = await db.select().from(t.accounts).where(eq(t.accounts.id, input.accountId));
  if (!selected) throw new Error("Cuenta inexistente");
  if (rows.length === 0) return { batchId: null, format, imported: 0, duplicates: 0, errors };

  const siblings = await db.select().from(t.accounts).where(eq(t.accounts.institution, selected.institution));
  const dates = rows.map((r) => r.date).sort();
  await ensureRates(
    rows.map((r) => r.currency ?? selected.currency).concat("EUR"),
    dates[0],
    dates[dates.length - 1],
  );

  const [batch] = await db
    .insert(t.importBatches)
    .values({ accountId: selected.id, filename: input.filename, format })
    .returning();

  const insertedIds: string[] = [];
  let duplicates = 0;
  const noReferenceOccurrences = new Map<string, number>();
  const existingNoReferenceCounts = new Map<string, number>();
  for (const row of rows) {
    const account = routeRow(row, selected, siblings);
    if (!account) {
      errors.push(`${row.date} ${row.description}: no hay cuenta ${selected.institution} en ${row.currency}`);
      continue;
    }
    const identity = [account.id, row.date, row.amount.toFixed(2), normalizeDescription(row.description)];
    const legacyKey = createHash("sha1").update(identity.join("|")).digest("hex");
    let dedupeKey = row.reference
      ? createHash("sha1").update([...identity, row.reference].join("|")).digest("hex")
      : legacyKey;

    // Align imports made before reference-aware deduplication with the bank reference.
    // After this one-time update, another row with the same details can be inserted.
    if (row.reference) {
      const [existingWithReference] = await db
        .select({ id: t.transactions.id })
        .from(t.transactions)
        .where(eq(t.transactions.dedupeKey, dedupeKey))
        .limit(1);
      if (existingWithReference) {
        duplicates++;
        continue;
      }
      const [legacy] = await db
        .select({ id: t.transactions.id })
        .from(t.transactions)
        .where(eq(t.transactions.dedupeKey, legacyKey))
        .limit(1);
      if (legacy) {
        await db.update(t.transactions).set({ dedupeKey }).where(eq(t.transactions.id, legacy.id));
        duplicates++;
        continue;
      }
    } else {
      const occurrence = (noReferenceOccurrences.get(legacyKey) ?? 0) + 1;
      noReferenceOccurrences.set(legacyKey, occurrence);
      let existingCount = existingNoReferenceCounts.get(legacyKey);
      if (existingCount === undefined) {
        const matches = await db
          .select({ description: t.transactions.description })
          .from(t.transactions)
          .where(and(
            eq(t.transactions.accountId, account.id),
            eq(t.transactions.date, row.date),
            eq(t.transactions.amount, row.amount.toFixed(2)),
          ));
        existingCount = matches.filter((tx) => normalizeDescription(tx.description) === identity[3]).length;
        existingNoReferenceCounts.set(legacyKey, existingCount);
      }
      if (occurrence <= existingCount) {
        duplicates++;
        continue;
      }
      if (occurrence > 1) {
        dedupeKey = createHash("sha1").update([...identity, `row:${occurrence}`].join("|")).digest("hex");
      }
    }
    const [inserted] = await db
      .insert(t.transactions)
      .values({
        accountId: account.id,
        date: row.date,
        recognitionDate: wiseCashbackRecognitionDate(account.slug, row.description, row.amount, row.date),
        description: row.description,
        amount: row.amount.toFixed(2),
        currency: account.currency,
        ...(await convert(row.amount, account.currency, row.date)),
        importBatchId: batch.id,
        dedupeKey,
      })
      .onConflictDoNothing({ target: t.transactions.dedupeKey })
      .returning({ id: t.transactions.id });
    if (inserted) insertedIds.push(inserted.id);
    else duplicates++;
  }

  await db
    .update(t.importBatches)
    .set({ rowCount: insertedIds.length, skippedDuplicates: duplicates })
    .where(eq(t.importBatches.id, batch.id));

  const classified = insertedIds.length ? await classifyPending(insertedIds) : undefined;
  return { batchId: batch.id, format, imported: insertedIds.length, duplicates, errors, classified };
}
