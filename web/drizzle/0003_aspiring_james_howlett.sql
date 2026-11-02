CREATE TABLE "transaction_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_allocation_owner_idx" ON "transaction_allocations" USING btree ("transaction_id","owner");