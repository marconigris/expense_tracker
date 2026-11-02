import assert from "node:assert/strict";
import test from "node:test";
import { custodyAmount, isMoniSettlementDate, marcoReportedAmount } from "../lib/allocations";

test("a shared property payout reports Marco's allocated share and dad's custody", () => {
  const allocations = [
    { owner: "marco" as const, amount: "330.00" },
    { owner: "papa" as const, amount: "670.00" },
  ];
  assert.equal(marcoReportedAmount(1000, 1000, allocations, "property", 0.33), 330);
  assert.equal(custodyAmount(1000, false, allocations), 670.00);
});

test("a refundable tenant deposit is not counted as Marco's rental income", () => {
  const allocations = [
    { owner: "marco" as const, amount: "250.00" },
    { owner: "moni" as const, amount: "250.00" },
    { owner: "other" as const, amount: "1000.00" },
  ];
  assert.equal(marcoReportedAmount(1500, 1500, allocations, "property", 0.5), 250.00);
  assert.equal(custodyAmount(1500, false, allocations), 0);
});

test("household and property defaults apply once, while explicit shares are not halved twice", () => {
  assert.equal(marcoReportedAmount(-100, -100, [], "household", 0.5), -50);
  assert.equal(marcoReportedAmount(1000, 1000, [], "property", 0.33), 330);
  const allocations = [
    { owner: "marco" as const, amount: "-50" },
    { owner: "moni" as const, amount: "-50" },
  ];
  assert.equal(marcoReportedAmount(-100, -100, allocations, "household", 0.5), -50);
});

test("unallocated custody belongs to dad and Moni's settlement starts in October", () => {
  assert.equal(custodyAmount(-100, true, []), -100);
  assert.equal(custodyAmount(100, false, []), 0);
  assert.equal(isMoniSettlementDate("2026-09-30"), false);
  assert.equal(isMoniSettlementDate("2026-10-01"), true);
});

test("an incomplete split cannot silently change financial reports", () => {
  const allocations = [{ owner: "marco" as const, amount: "49.00" }, { owner: "moni" as const, amount: "50.00" }];
  assert.throws(() => marcoReportedAmount(100, 100, allocations, "property", 0.5), /do not add up/);
  assert.throws(() => custodyAmount(100, false, allocations), /do not add up/);
});
