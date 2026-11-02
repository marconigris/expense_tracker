CREATE TABLE "partner_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"amount_eur" numeric(14, 2) NOT NULL,
	"area" text NOT NULL,
	"source" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_expenses" ADD CONSTRAINT "partner_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_expenses" ADD CONSTRAINT "partner_expenses_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_expense_key_idx" ON "partner_expenses" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_expense_transaction_idx" ON "partner_expenses" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "partner_expense_user_date_idx" ON "partner_expenses" USING btree ("user_id","date");