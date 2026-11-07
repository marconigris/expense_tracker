CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"acquired" date NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"share" numeric(5, 4) NOT NULL,
	"annual_rate" numeric(5, 4) NOT NULL,
	"purchase_transaction_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_purchase_transaction_id_transactions_id_fk" FOREIGN KEY ("purchase_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_purchase_idx" ON "vehicles" USING btree ("purchase_transaction_id");