import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CATEGORIES } from "./catalog";
import { db, t } from "./db";
import type { Rule, Transaction } from "./db/schema";
import { shiftDate } from "./fx";

const TRANSFER_WINDOW_DAYS = 3;
// Legs in the same currency must match almost exactly; across currencies allow the FX spread.
const SAME_CURRENCY_TOLERANCE = 0.005;
const CROSS_CURRENCY_TOLERANCE = 0.03;

type Suggestion = Partial<Pick<Transaction, "entityId" | "category" | "kind" | "confidence" | "suggestedBy" | "transferGroup">>;

async function suggest(id: string, s: Suggestion) {
  await db.update(t.transactions).set({ ...s, status: "suggested" }).where(eq(t.transactions.id, id));
}

/** Pairs an outflow in one account with a matching inflow in another as an internal transfer. */
async function detectTransfers(txs: Transaction[]) {
  const matched = new Set<string>();
  for (const tx of txs) {
    if (matched.has(tx.id) || !tx.accountId || tx.amountUsd == null) continue;
    const usd = Number(tx.amountUsd);
    const [other] = await db
      .select()
      .from(t.transactions)
      .where(
        and(
          isNotNull(t.transactions.accountId),
          ne(t.transactions.accountId, tx.accountId),
          sql`${t.transactions.transferGroup} is null`,
          sql`${t.transactions.date} between ${shiftDate(tx.date, -TRANSFER_WINDOW_DAYS)} and ${shiftDate(tx.date, TRANSFER_WINDOW_DAYS)}`,
          sql`sign(${t.transactions.amountUsd}) = ${-Math.sign(usd)}`,
          sql`abs(abs(${t.transactions.amountUsd}) - ${Math.abs(usd)}) <= ${Math.abs(usd)} * case when ${t.transactions.currency} = ${tx.currency} then ${SAME_CURRENCY_TOLERANCE}::numeric else ${CROSS_CURRENCY_TOLERANCE}::numeric end`,
          ne(t.transactions.status, "confirmed"),
        ),
      )
      .orderBy(sql`abs(${t.transactions.date} - ${tx.date}::date)`)
      .limit(1);
    if (!other || matched.has(other.id)) continue;
    const group = randomUUID();
    for (const id of [tx.id, other.id]) {
      await suggest(id, { kind: "transfer", entityId: null, category: null, transferGroup: group, confidence: 0.85, suggestedBy: "transfer" });
      matched.add(id);
    }
  }
  return matched;
}

export function matchRule(tx: Pick<Transaction, "description" | "accountId" | "amount">, rules: Rule[]) {
  const text = tx.description.toLowerCase();
  const direction = Number(tx.amount) < 0 ? "out" : "in";
  return rules
    .filter((r) => text.includes(r.pattern.toLowerCase()))
    .filter((r) => !r.accountId || r.accountId === tx.accountId)
    .filter((r) => !r.direction || r.direction === direction)
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
}

/** Runs pending movements through transfers → rules → account default. */
export async function classifyPending(ids?: string[]) {
  const where = ids ? inArray(t.transactions.id, ids) : eq(t.transactions.status, "pending");
  let txs = await db.select().from(t.transactions).where(and(where, eq(t.transactions.status, "pending")));
  if (txs.length === 0) return { transfers: 0, rules: 0, fallback: 0 };

  const transfers = await detectTransfers(txs);
  txs = txs.filter((tx) => !transfers.has(tx.id));

  const rules = await db.select().from(t.rules);
  const byRule = new Set<string>();
  for (const tx of txs) {
    const rule = matchRule(tx, rules);
    if (!rule) continue;
    await suggest(tx.id, { entityId: rule.entityId, category: rule.category, kind: rule.kind, confidence: 0.9, suggestedBy: "rule" });
    await db.update(t.rules).set({ hits: sql`${t.rules.hits} + 1` }).where(eq(t.rules.id, rule.id));
    byRule.add(tx.id);
  }
  txs = txs.filter((tx) => !byRule.has(tx.id));

  // No clue left: the account's usual entity, flagged as low confidence for the AI pass or for review.
  const accounts = await db.select().from(t.accounts);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const tx of txs) {
    const account = tx.accountId ? accountById.get(tx.accountId) : undefined;
    await suggest(tx.id, { entityId: account?.defaultEntityId ?? null, confidence: 0.3, suggestedBy: "account" });
  }

  return { transfers: transfers.size, rules: byRule.size, fallback: txs.length };
}

export type AiItem = {
  id: string;
  date: string;
  account: string;
  accountHint: string | null;
  description: string;
  amount: number;
  currency: string;
};

export type AiContext = {
  entities: { slug: string; name: string; kind: string; categories: string[] }[];
  examples: { description: string; account: string; amount: number; currency: string; entity: string; category: string | null }[];
};

export type AiSuggestion = { id: string; entity: string; category: string; transfer: boolean; confidence: number };

/**
 * Second opinion for movements only the account default could guess. The model call is injected
 * so it can run wherever the AI lives (today: the Codex CLI on Marco's Mac).
 */
export async function refineWithAi(ask: (items: AiItem[], ctx: AiContext) => Promise<AiSuggestion[]>, batchSize = 60) {
  const txs = await db
    .select({ tx: t.transactions, account: t.accounts })
    .from(t.transactions)
    .leftJoin(t.accounts, eq(t.accounts.id, t.transactions.accountId))
    .where(and(eq(t.transactions.status, "suggested"), eq(t.transactions.suggestedBy, "account")))
    .orderBy(t.transactions.date);
  if (txs.length === 0) return 0;

  const entities = await db.select().from(t.entities).where(eq(t.entities.active, true));
  const entityBySlug = new Map(entities.map((e) => [e.slug, e]));
  const examples = await db
    .select({
      description: t.transactions.description,
      account: t.accounts.name,
      amount: t.transactions.amount,
      currency: t.transactions.currency,
      entity: t.entities.slug,
      category: t.transactions.category,
    })
    .from(t.transactions)
    .innerJoin(t.entities, eq(t.entities.id, t.transactions.entityId))
    .innerJoin(t.accounts, eq(t.accounts.id, t.transactions.accountId))
    .where(and(eq(t.transactions.status, "confirmed"), eq(t.transactions.kind, "normal")))
    .orderBy(desc(t.transactions.date))
    .limit(80);
  const ctx: AiContext = {
    entities: entities.map((e) => ({ slug: e.slug, name: e.name, kind: e.kind, categories: CATEGORIES[e.kind] ?? [] })),
    examples: examples.map((e) => ({ ...e, amount: Number(e.amount) })),
  };

  let updated = 0;
  for (let i = 0; i < txs.length; i += batchSize) {
    const chunk = txs.slice(i, i + batchSize);
    const ids = new Set(chunk.map(({ tx }) => tx.id));
    const results = await ask(
      chunk.map(({ tx, account }) => ({
        id: tx.id,
        date: tx.date,
        account: account?.name ?? "Registrado a mano",
        accountHint: account?.hint ?? null,
        description: tx.description,
        amount: Number(tx.amount),
        currency: tx.currency,
      })),
      ctx,
    );
    for (const r of results) {
      if (!ids.has(r.id)) continue;
      const entity = entityBySlug.get(r.entity);
      if (!r.transfer && !entity) continue;
      await suggest(r.id, {
        kind: r.transfer ? "transfer" : "normal",
        entityId: r.transfer ? null : entity!.id,
        category: r.transfer ? null : r.category,
        confidence: Math.max(0, Math.min(1, r.confidence)),
        suggestedBy: "ai",
      });
      updated++;
    }
  }
  return updated;
}
