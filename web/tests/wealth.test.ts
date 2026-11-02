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
import { wealthGroup, wealthTotals } from "../lib/wealth-math";

test("EUR stays apart, other currencies go to USD, IBKR is stocks, and nothing is subtracted", () => {
  const accounts = [
    { currency: "USD", value: 1000, group: "cash" as const }, { currency: "USDC", value: 500, group: "cash" as const },
    { currency: "ARS", value: 150000, group: "cash" as const }, { currency: "USD", value: 4000, group: "stocks" as const },
    { currency: "EUR", value: 2000, group: "cash" as const }, { currency: "ZAR", value: 0, group: "cash" as const },
    { currency: "USD", value: null, group: "cash" as const },
  ];
  const result = wealthTotals(accounts, [{ stake: 60000, stakeCurrency: "USD" }], { USDC: 1, ARS: 0.001 });
  assert.equal(result.usd.cash, 1650);
  assert.equal(result.usd.stocks, 4000);
  assert.equal(result.usd.total, 1650 + 4000 + 60000);
  assert.deepEqual(result.usd.converted, [{ currency: "USDC", amount: 500 }, { currency: "ARS", amount: 150000 }]);
  assert.equal(result.eur?.total, 2000);
  assert.deepEqual(result.missingRates, []);
});

test("no EUR bucket without EUR money, and missing rates are reported", () => {
  const result = wealthTotals([{ currency: "BRL", value: 100, group: "cash" }], [], { BRL: null });
  assert.equal(result.eur, null);
  assert.deepEqual(result.missingRates, ["BRL"]);
});

test("only IBKR counts as stocks and funds", () => {
  assert.equal(wealthGroup({ slug: "ibkr" }), "stocks");
  assert.equal(wealthGroup({ slug: "cocos-fci-dolares-plus" }), "cash");
  assert.equal(wealthGroup({ slug: "revolut-ahorro-usd" }), "cash");
});
