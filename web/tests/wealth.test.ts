import assert from "node:assert/strict";
import test from "node:test";
import { recordedBalance } from "../lib/wealth-math";
import { custodyForm } from "../lib/allocations";

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
import { balanceAt, groupAccounts, monthEnds, propertyShareAt, placeCustody, wealthGroup, wealthTotals } from "../lib/wealth-math";

test("EUR stays apart, other currencies go to USD, IBKR is stocks, and debts are subtracted", () => {
  const accounts = [
    { currency: "USD", value: 1000, group: "cash" as const }, { currency: "USDC", value: 500, group: "cash" as const },
    { currency: "ARS", value: 150000, group: "cash" as const }, { currency: "USD", value: 4000, group: "stocks" as const },
    { currency: "EUR", value: 2000, group: "cash" as const }, { currency: "ZAR", value: 0, group: "cash" as const },
    { currency: "USD", value: null, group: "cash" as const },
  ];
  const result = wealthTotals(accounts, [{ stake: 60000, stakeCurrency: "USD" }], { USDC: 1, ARS: 0.001 },
    [{ currency: "USD", balance: 300, name: "a" }, { currency: "USD", balance: 200, name: "b" }, { currency: "EUR", balance: 500, name: "c" }]);
  assert.equal(result.usd.cash, 1650);
  assert.equal(result.usd.stocks, 4000);
  assert.equal(result.usd.custody, 500);
  assert.equal(result.usd.total, 1650 + 4000 + 60000 - 500);
  assert.deepEqual(result.usd.converted, [{ currency: "USDC", amount: 500 }, { currency: "ARS", amount: 150000 }]);
  assert.equal(result.eur?.total, 1500);
  assert.deepEqual(result.missingRates, []);
});

test("no EUR bucket without EUR money, and missing rates are reported", () => {
  const result = wealthTotals([{ currency: "BRL", value: 100, group: "cash" }], [], { BRL: null });
  assert.equal(result.eur, null);
  assert.deepEqual(result.missingRates, ["BRL"]);
});

test("IBKR and crypto wallets count as stocks, funds and crypto", () => {
  assert.equal(wealthGroup({ slug: "ibkr" }), "stocks");
  assert.equal(wealthGroup({ slug: "binance", kind: "crypto" }), "stocks");
  assert.equal(wealthGroup({ slug: "cocos-fci-dolares-plus" }), "cash");
  assert.equal(wealthGroup({ slug: "revolut-ahorro-usd" }), "cash");
});

test("accounts group by region and bank, sorted by name", () => {
  const accounts = [
    { institution: "Revolut", name: "Revolut USD", currency: "USD" }, { institution: "Efectivo", name: "Efectivo USD", currency: "USD" },
    { institution: "Cocos", name: "Cocos USD", currency: "USD" }, { institution: "Binance", name: "Binance", currency: "USDT" },
    { institution: "Bunq", name: "Bunq Ahorro EUR", currency: "EUR" }, { institution: "Revolut", name: "Revolut Ahorro EUR", currency: "EUR" },
    { institution: "ARQ", name: "ARQ USDc", currency: "USDC" }, { institution: "Wise", name: "Wise USD", currency: "USD" },
  ];
  assert.deepEqual(groupAccounts(accounts).map((g) => [g.region, g.banks.map((b) => [b.bank, b.accounts.map((a) => a.name)])]), [
    ["Europa EUR", [["Bunq", ["Bunq Ahorro EUR"]], ["Revolut", ["Revolut Ahorro EUR"]]]],
    ["Europa USD", [["Revolut", ["Revolut USD"]], ["Wise", ["Wise USD"]]]],
    ["Argentina", [["ARQ", ["ARQ USDc"]], ["Cocos", ["Cocos USD"]]]],
    ["Crypto", [["Binance", ["Binance"]]]],
    ["Efectivo", [["Efectivo", ["Efectivo USD"]]]],
  ]);
});

test("dad's money is cash when it came as cash or passed through a cash account", () => {
  assert.equal(custodyForm(null, "Saldo inicial papá: efectivo USD"), "cash");
  assert.equal(custodyForm(null, "Saldo inicial papá: banco USD"), "bank");
  assert.equal(custodyForm("cash", "Pago intereses"), "cash");
  assert.equal(custodyForm("bank", "Card transaction efectivo"), "bank");
});

test("each bubble line lists where its money comes from, largest first", () => {
  const result = wealthTotals([
    { currency: "EUR", value: 100, group: "cash", name: "Revolut EUR" }, { currency: "EUR", value: 900, group: "cash", name: "Bunq EUR" },
    { currency: "ARS", value: 1000, group: "cash", name: "Brubank ARS" },
  ], [{ stake: 50, stakeCurrency: "USD", name: "La Mariposa" }], { ARS: 0.001 }, [{ currency: "USD", balance: 30, name: "Efectivo que le debés a papá" }]);
  assert.deepEqual(result.eur?.lines.cash, [{ name: "Bunq EUR", amount: 900 }, { name: "Revolut EUR", amount: 100 }]);
  assert.deepEqual(result.usd.lines.cash, [{ name: "Brubank ARS", amount: 1, original: { amount: 1000, currency: "ARS" } }]);
  assert.deepEqual(result.usd.lines.properties, [{ name: "La Mariposa", amount: 50 }]);
  assert.deepEqual(result.usd.lines.custody, [{ name: "Efectivo que le debés a papá", amount: 30 }]);
});

test("dad's bank money is placed in accounts; the rest stays unplaced", () => {
  const result = placeCustody([{ currency: "EUR", balance: 25314.21 }, { currency: "USD", balance: 47496.67 }],
    [{ accountId: "bunq", name: "Bunq Ahorro EUR", currency: "EUR", value: 25314.21 }, { accountId: "ws", name: "Wise Savings USD", currency: "USD", value: 23000 }]);
  assert.deepEqual(result.map((r) => [r.currency, r.held.map((h) => h.name), r.unplaced]), [
    ["EUR", ["Bunq Ahorro EUR"], 0],
    ["USD", ["Wise Savings USD"], 24496.67],
  ]);
});

test("month-end balances walk back from the latest balance by undoing later movements", () => {
  const moves = [
    { accountId: "a", date: "2026-10-05", amount: "500.00", status: "confirmed", batchId: "b" },
    { accountId: "a", date: "2026-09-10", amount: "-200.00", status: "suggested", batchId: "b" },
    { accountId: "a", date: "2026-10-20", amount: "999.00", status: "suggested", batchId: null },
  ];
  const anchor = { value: 1000, date: "2026-10-31" };
  assert.deepEqual(balanceAt(anchor, moves, "2026-10-31"), { value: 1000, assumed: false });
  assert.deepEqual(balanceAt(anchor, moves, "2026-09-30"), { value: 500, assumed: false });
  assert.deepEqual(balanceAt(anchor, moves, "2026-08-31"), { value: 700, assumed: false });
  assert.deepEqual(balanceAt(anchor, [], "2026-08-31"), { value: 1000, assumed: true });
});

test("month ends run up to the current month", () => {
  assert.deepEqual(monthEnds("2026-01", "2026-03"), [{ month: "2026-01", end: "2026-01-31" }, { month: "2026-02", end: "2026-02-28" }]);
  assert.deepEqual(monthEnds("2026-11", "2026-11"), []);
});

test("La Mariposa was all Marco's until Moni bought half", () => {
  assert.equal(propertyShareAt("la-mariposa", 0.5, "2026-07-31"), 1);
  assert.equal(propertyShareAt("la-mariposa", 0.5, "2026-08-19"), 0.5);
  assert.equal(propertyShareAt("marquis", 0.33, "2026-01-31"), 0.33);
});
