import assert from "node:assert/strict";
import test from "node:test";
import { parsePartnerRevolut } from "../lib/import/partner-revolut";

test("consolidated Revolut report reads each account ledger and stops before investments", () => {
  const csv = ["Current Accounts Summaries,,,,", "Personal Account (EUR),,,,", "Current Accounts Transaction Statements,,,,", "Personal Account (EUR),,,,", "Date,Description,Category,Money in/out,Balance", "Oct 1 2026,broken,Merchant,-€12,€0"].join("\n");
  assert.equal(parsePartnerRevolut(csv)?.errors.length, 1);
  const report = ["Current Accounts Transaction Statements,,,,", "Personal Account (EUR),,,,", "Date,Description,Category,Money in/out,Balance", '"Oct 1, 2026",Shop,Merchant,-€12.50,€20', "Total,,,,", "---------,,,,", "Savings  (USD),,,,", "Date,Description,Category,Money in/out,Balance", '"Oct 2, 2026",Transfer,Transfer,-$5,$15', "Total,,,,", "Investment Services Transaction Statements,,,,", '"Oct 3, 2026",Investment,,-$999,'].join("\n");
  assert.deepEqual(parsePartnerRevolut(report), { rows: [
    { date: "2026-10-01", description: "Shop · Personal Account", amount: -12.5, currency: "EUR" },
    { date: "2026-10-02", description: "Transfer · Savings", amount: -5, currency: "USD" },
  ], errors: [] });
  assert.equal(parsePartnerRevolut("Date,Description,Amount\n2026-10-01,Shop,-1"), null);
});
