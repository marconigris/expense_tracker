import { sql } from "drizzle-orm";
import { db, t } from "../lib/db";
import { ACCOUNTS, CUSTODY_OPENING, ENTITIES, SEED_RULES } from "../lib/catalog";

async function main() {
  for (const [i, e] of ENTITIES.entries()) {
    const values = { ...e, sortOrder: i };
    await db.insert(t.entities).values(values).onConflictDoUpdate({ target: t.entities.slug, set: values });
  }
  const entityIds = Object.fromEntries((await db.select().from(t.entities)).map((e) => [e.slug, e.id]));

  for (const [i, { defaultEntity, ...a }] of ACCOUNTS.entries()) {
    const values = { ...a, defaultEntityId: entityIds[defaultEntity], sortOrder: i };
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

  console.log(`Seeded ${ENTITIES.length} entities and ${ACCOUNTS.length} accounts`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
