import { and, eq, isNull, sql } from "drizzle-orm";
import { db, t } from "../lib/db";
import { ACCOUNTS, CUSTODY_OPENING, ENTITIES, SEED_RULES } from "../lib/catalog";

async function main() {
  for (const [i, e] of ENTITIES.entries()) {
    const values = { ...e, sortOrder: i };
    await db.insert(t.entities).values(values).onConflictDoUpdate({ target: t.entities.slug, set: values });
  }
  const entityIds = Object.fromEntries((await db.select().from(t.entities)).map((e) => [e.slug, e.id]));

  await db
    .update(t.transactions)
    .set({ category: "Trainings" })
    .where(and(eq(t.transactions.entityId, entityIds.coaching), eq(t.transactions.category, "Coaching de negocio")));
  await db
    .update(t.rules)
    .set({ category: "Trainings" })
    .where(and(eq(t.rules.entityId, entityIds.coaching), eq(t.rules.category, "Coaching de negocio")));
  await db
    .update(t.rules)
    .set({ entityId: entityIds.coaching, category: "Trainings", kind: "normal" })
    .where(and(eq(t.rules.pattern, "udemy"), eq(t.rules.kind, "normal")));

  for (const [i, { defaultEntity, ...a }] of ACCOUNTS.entries()) {
    const values = { ...a, defaultEntityId: defaultEntity ? entityIds[defaultEntity] : null, sortOrder: i };
    await db.insert(t.accounts).values(values).onConflictDoUpdate({ target: t.accounts.slug, set: values });
  }

  await db
    .insert(t.users)
    .values([
      { email: "nigris.marco@gmail.com", name: "Marco", role: "owner" },
      { email: "monica.gilardoni00@gmail.com", name: "Moni", role: "partner" },
    ])
    .onConflictDoNothing();

  // First run only: capital Marco reported on 2026-11-01, starter rules, dad's opening balances.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(t.valuations);
  if (count === 0) {
    await db.insert(t.rules).values(
      SEED_RULES.map(({ entity, ...r }) => ({ ...r, entityId: entity ? entityIds[entity] : null })),
    );
    await db.insert(t.transactions).values(
      CUSTODY_OPENING.map((o) => ({
        ...o,
        date: "2026-01-01",
        kind: "opening" as const,
        entityId: entityIds["papa"],
        status: "confirmed" as const,
        suggestedBy: "manual" as const,
        dedupeKey: `opening:papa:${o.description}`,
      })),
    );
    await db.insert(t.valuations).values([
      { entityId: entityIds["la-mariposa"], date: "2026-11-01", value: "120000", currency: "USD", notes: "Capital aportado total; Marco tiene 50%" },
      { entityId: entityIds["marquis"], date: "2026-11-01", value: "157000", currency: "USD", notes: "Capital aportado total; Marco tiene 33%" },
    ]);
  }

  const udemyRules = await db
    .select({ id: t.rules.id })
    .from(t.rules)
    .where(and(eq(t.rules.pattern, "udemy"), isNull(t.rules.accountId), eq(t.rules.direction, "out")))
    .limit(1);
  if (udemyRules.length === 0) {
    await db.insert(t.rules).values({
      pattern: "udemy",
      direction: "out",
      entityId: entityIds.coaching,
      category: "Trainings",
    });
  }

  // Historical Tricount estimate includes the shared EUR 3,500 vehicle purchase.
  const [carPurchase] = await db.select().from(t.transactions).where(and(eq(t.transactions.dedupeKey, "tricount:historical-estimate:2026-jun"), eq(t.transactions.date, "2026-06-01"), eq(t.transactions.amount, "-8328"), eq(t.transactions.currency, "EUR"), eq(t.transactions.kind, "normal"), eq(t.transactions.status, "confirmed"), eq(t.transactions.entityId, entityIds["hogar-europa"]), eq(t.transactions.paidBy, "moni"))).limit(1);
  const carAllocations = carPurchase ? await db.select({ id: t.transactionAllocations.id }).from(t.transactionAllocations).where(eq(t.transactionAllocations.transactionId, carPurchase.id)).limit(1) : [];
  if (carPurchase && !carAllocations.length) await db.insert(t.vehicles).values({ name: "Auto Europa", acquired: "2026-06-01", price: "3500", currency: "EUR", share: "0.5", annualRate: "0.15", purchaseTransactionId: carPurchase.id }).onConflictDoNothing({ target: t.vehicles.purchaseTransactionId });

  console.log(`Seeded ${ENTITIES.length} entities and ${ACCOUNTS.length} accounts`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
