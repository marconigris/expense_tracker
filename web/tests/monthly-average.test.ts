import assert from "node:assert/strict";
import test from "node:test";
import { recordedMonthlyAverage } from "../lib/monthly-average";

test("averages use months with recorded activity, including months with zero net income", () => {
  const months = Array.from({ length: 10 }, (_, i) => ({ hasActivity: true, income: i ? 100 : 0, spending: 50 }));
  const result = recordedMonthlyAverage([...months, { hasActivity: false, income: 0, spending: 0 }]);
  assert.equal(result.count, 10);
  assert.equal(result.income, 90);
  assert.equal(result.spending, 50);
  assert.equal(recordedMonthlyAverage([]).income, 0);
});
