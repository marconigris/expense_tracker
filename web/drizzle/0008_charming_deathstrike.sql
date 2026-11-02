CREATE TABLE "wealth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"currency" text NOT NULL,
	"cash" numeric(14, 2) NOT NULL,
	"stocks" numeric(14, 2) NOT NULL,
	"properties" numeric(14, 2) NOT NULL,
	"debt" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wealth_snapshot_month_idx" ON "wealth_snapshots" USING btree ("month","currency");