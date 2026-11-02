import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Everything is modelled from Marco's point of view. An entity answers
// "who does this money belong to", an account answers "where does it sit".

export const entityKind = pgEnum("entity_kind", [
  "personal", // Marco himself
  "business", // only flows between the business and Marco count
  "household", // shared living costs with Moni, split 50/50
  "property", // joint real-estate investment
  "investment", // Marco's financial wealth: interest, brokers, crypto
  "custody", // money held in Marco's accounts that belongs to his father
  "payable", // amounts collected on someone else's behalf
]);

export const accountKind = pgEnum("account_kind", ["bank", "savings", "broker", "cash", "crypto"]);

// normal: counts as income/expense for its entity (sign tells which).
// transfer: between Marco's accounts, including untracked services, ignored in reports.
// settlement: Moni paying Marco back (or vice versa) for a household.
// opening: initial balance of an account, only affects balances.
// excluded: kept for account history but already recorded elsewhere or outside this period.
// receivable: an advance to someone, or its repayment; outstanding principal is tracked separately.
export const txKind = pgEnum("tx_kind", ["normal", "transfer", "settlement", "opening", "excluded", "receivable"]);

export const txStatus = pgEnum("tx_status", ["pending", "suggested", "confirmed"]);

export const payer = pgEnum("payer", ["marco", "moni"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "partner"] }).notNull(),
  // scrypt hash set with `npm run set-password`; null = cannot sign in yet.
  passwordHash: text("password_hash"),
});

export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: entityKind("kind").notNull(),
  // Marco's share of the entity: 1 for his own things, 0.5 for households.
  marcoShare: numeric("marco_share", { precision: 5, scale: 4 }).notNull().default("1"),
  // Currency the entity naturally lives in, used for its native view.
  currency: text("currency").notNull().default("USD"),
  // Shown to Moni too (households and La Mariposa).
  sharedWithMoni: boolean("shared_with_moni").notNull().default(false),
  // Single-key shortcut in the review inbox.
  shortcut: text("shortcut"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  currency: text("currency").notNull(),
  kind: accountKind("kind").notNull(),
  // Prior used before any rule or AI suggestion.
  defaultEntityId: uuid("default_entity_id").references(() => entities.id),
  // Free-text context for the classifier ("mostly coaching ads", ...).
  hint: text("hint"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id),
  filename: text("filename").notNull(),
  format: text("format").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  skippedDuplicates: integer("skipped_duplicates").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null when Moni records something she paid from her own accounts.
    accountId: uuid("account_id").references(() => accounts.id),
    date: date("date").notNull(),
    // When income or expense was generated, if different from the bank posting date.
    recognitionDate: date("recognition_date"),
    description: text("description").notNull(),
    // Signed, in the original currency: negative = money out.
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }),
    amountEur: numeric("amount_eur", { precision: 14, scale: 2 }),
    kind: txKind("kind").notNull().default("normal"),
    entityId: uuid("entity_id").references(() => entities.id),
    category: text("category"),
    status: txStatus("status").notNull().default("pending"),
    confidence: real("confidence"),
    suggestedBy: text("suggested_by", { enum: ["rule", "transfer", "account", "ai", "manual"] }),
    paidBy: payer("paid_by").notNull().default("marco"),
    // Both legs of an internal transfer share this id.
    transferGroup: uuid("transfer_group"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tx_date_idx").on(t.date),
    index("tx_status_idx").on(t.status),
    index("tx_entity_idx").on(t.entityId),
    uniqueIndex("tx_dedupe_idx").on(t.dedupeKey),
  ],
);

// Ownership of a single bank movement can be shared without duplicating the movement.
// Allocation amounts use the transaction's currency and must sum to its signed amount.
export const transactionAllocations = pgTable(
  "transaction_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    owner: text("owner", { enum: ["marco", "moni", "papa", "other"] }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("tx_allocation_owner_idx").on(t.transactionId, t.owner)],
);

// Partner-owned expense records are kept outside Marco's ledger when personal.
// Shared entries also link to exactly one transaction in the joint ledger.
export const partnerExpenses = pgTable("partner_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull(),
  amountEur: numeric("amount_eur", { precision: 14, scale: 2 }).notNull(),
  area: text("area").notNull(),
  source: text("source"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("partner_expense_key_idx").on(t.dedupeKey), uniqueIndex("partner_expense_transaction_idx").on(t.transactionId), index("partner_expense_user_date_idx").on(t.userId, t.date)]);

// Rows from Moni's CSVs waiting for her decision. Saved rows move to partner_expenses (same dedupe key);
// discarded ones stay here so re-importing the file does not bring them back.
export const partnerImportRows = pgTable("partner_import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  source: text("source").notNull(),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // positive = spent
  currency: text("currency").notNull(),
  reference: text("reference"),
  occurrence: integer("occurrence").notNull().default(0),
  status: text("status", { enum: ["pending", "discarded"] }).notNull().default("pending"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("partner_import_key_idx").on(t.dedupeKey), index("partner_import_user_idx").on(t.userId, t.status, t.date)]);

// Learned from confirmations: "description contains X" -> entity/category.
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  pattern: text("pattern").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["in", "out"] }),
  entityId: uuid("entity_id").references(() => entities.id),
  category: text("category"),
  kind: txKind("kind").notNull().default("normal"),
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// USD value of one unit of `currency` on `date` (ARS uses MEP).
export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date").notNull(),
    currency: text("currency").notNull(),
    usdPerUnit: numeric("usd_per_unit", { precision: 18, scale: 10 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [uniqueIndex("fx_date_currency_idx").on(t.date, t.currency)],
);

// Point-in-time value of Marco's stake in a property or a manual balance.
export const valuations = pgTable("valuations", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id").references(() => entities.id),
  accountId: uuid("account_id").references(() => accounts.id),
  date: date("date").notNull(),
  // Value of the whole asset; Marco's part is value * entity.marcoShare.
  // With both account and a custody entity: how much of that account's balance belongs to that person.
  value: numeric("value", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  notes: text("notes"),
});

export type Entity = typeof entities.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Rule = typeof rules.$inferSelect;
