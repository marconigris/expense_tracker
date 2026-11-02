import assert from "node:assert/strict";
import test from "node:test";
import { recordedBalance } from "../lib/wealth-math";

const movement = { date: "2026-01-02", amount: "-15.00", kind: "normal", status: "confirmed", batchId: "batch" };
test("missing openings are unknown, never a sum presented as a balance", () => {
  assert.equal(recordedBalance([movement], []).value, null);
});
test("an opening and physical statement movements yield an account balance", () => {
  const opening = { date: "2026-01-01", amount: "100.00", kind: "opening", status: "confirmed", batchId: null };
  const excludedPhysical = { ...movement, date: "2026-01-03", amount: "5.00", kind: "excluded", status: "suggested" };
  assert.equal(recordedBalance([opening, movement, excludedPhysical], []).value, 90);
});
test("a snapshot stays dated and is not silently rolled forward", () => {
  const result = recordedBalance([movement], [{ date: "2026-01-01", value: "300.00", notes: "as reported" }]);
  assert.equal(result.value, 300);
  assert.equal(result.later, true);
  assert.equal(result.date, "2026-01-01");
});
