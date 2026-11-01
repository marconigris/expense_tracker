CREATE TYPE "public"."account_kind" AS ENUM('bank', 'savings', 'broker', 'cash', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('personal', 'business', 'household', 'property', 'investment', 'custody');--> statement-breakpoint
CREATE TYPE "public"."payer" AS ENUM('marco', 'moni');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('normal', 'transfer', 'settlement', 'opening');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'suggested', 'confirmed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"institution" text NOT NULL,
	"currency" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"default_entity_id" uuid,
	"hint" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"marco_share" numeric(5, 4) DEFAULT '1' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"shared_with_moni" boolean DEFAULT false NOT NULL,
	"shortcut" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "entities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"usd_per_unit" numeric(18, 10) NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"skipped_duplicates" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"account_id" uuid,
	"direction" text,
	"entity_id" uuid,
	"category" text,
	"kind" "tx_kind" DEFAULT 'normal' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"amount_usd" numeric(14, 2),
	"amount_eur" numeric(14, 2),
	"kind" "tx_kind" DEFAULT 'normal' NOT NULL,
	"entity_id" uuid,
	"category" text,
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"confidence" real,
	"suggested_by" text,
	"paid_by" "payer" DEFAULT 'marco' NOT NULL,
	"transfer_group" uuid,
	"import_batch_id" uuid,
	"dedupe_key" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"account_id" uuid,
	"date" date NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_entity_id_entities_id_fk" FOREIGN KEY ("default_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_date_currency_idx" ON "fx_rates" USING btree ("date","currency");--> statement-breakpoint
CREATE INDEX "tx_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "tx_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tx_entity_idx" ON "transactions" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_dedupe_idx" ON "transactions" USING btree ("dedupe_key");