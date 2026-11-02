import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../lib/import/csv";

test("reads Bunq semicolon CSVs, European amounts and counterparties", () => {
  const csv = 'Date;"Interest Date";"Amount";"Account";"Counterparty";"Name";"Description"\n'
    + '2026-03-21;"2026-03-21";"-5.000,00";"account";"counterparty";"Someone";""\n'
    + '2026-03-26;"2026-03-26";"6,53";"account";"counterparty";"bunq";"bunq Payday"';
  const parsed = parseCsv(csv);
  assert.equal(parsed.format, "bunq");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].amount, -5000);
  assert.equal(parsed.rows[0].description, "Someone");
  assert.equal(parsed.rows[1].amount, 6.53);
  assert.equal(parsed.rows[1].description, "bunq — bunq Payday");
});
