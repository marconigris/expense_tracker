ALTER TABLE "transactions" ADD COLUMN "recognition_date" date;
--> statement-breakpoint
UPDATE "transactions" AS t
SET "recognition_date" = (date_trunc('month', t."date") - interval '1 day')::date
FROM "accounts" AS a
WHERE t."account_id" = a."id" AND a."slug" = 'wise-usd'
  AND lower(trim(t."description")) = 'cashback' AND t."amount" > 0
  AND t."date" BETWEEN '2026-01-01' AND '2026-10-31';
