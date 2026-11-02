import assert from "node:assert/strict";
import test from "node:test";
import { parseRevolutTaxReport } from "../lib/import/revolut-tax";

const report = `Current Accounts Summaries
Personal Account (EUR)
Average balance Q1 2026,€0.00,Opening balance,€100.00
Average balance Q2 2026,€0.00,Closing balance,€92.00
Crypto Summaries
Average balance Q1 2026,€0.00,Opening balance,€9.99
Current Accounts Transaction Statements
Personal Account (EUR)
Date,Description,Category,Money in/out,Balance,Tax withheld,Other taxes,Fees
"Jan 1, 2026",Plan,Merchant,-€8.00,€92.00,€0.00,€0.00,€8.00
Flexible Cash Funds Transaction Statements
Flexible Cash Funds  (EUR)
Date,Description,Net return,Tax withheld,Other taxes,Service fees,Net return distributed and withdrawn
"Jan 1, 2026",Interest earned,€0.36,€0.00,€0.00,€0.05,€0.31
Investment Services Transaction Statements`;

test("keeps current-account amount net of fees and imports fund returns after fees", () => {
  const parsed = parseRevolutTaxReport(report)!;
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.groups.find((g) => g.slug === "revolut-eur")!.opening, 100);
  assert.equal(parsed.groups.find((g) => g.slug === "revolut-eur")!.rows[0].amount, -8);
  assert.equal(parsed.groups.find((g) => g.slug === "revolut-ahorro-eur")!.rows[0].amount, 0.31);
});
test("rejects a report when its running balance or net return does not reconcile", () => {
  assert.ok(parseRevolutTaxReport(report.replace("€92.00,€0.00", "€91.00,€0.00"))!.errors.length);
  assert.ok(parseRevolutTaxReport(report.replace("€0.05,€0.31", "€0.05,€0.32"))!.errors.length);
});
test("does not identify normal CSVs as tax reports", () => assert.equal(parseRevolutTaxReport("Date,Amount\n2026-01-01,1"), null));
