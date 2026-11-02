import assert from "node:assert/strict";
import test from "node:test";
import { settlementCents, settlementCurrency, settlementInDisplayCurrency, type SharedMovement } from "../lib/settlement";

const base: SharedMovement = { date: "2026-10-01", amount: -100, paidBy: "marco", kind: "normal", accountId: "account", entityKind: "household", category: "Otros", marcoShare: 0.5, allocations: [] };
test("shared expenses respect the October cutoff and the payer", () => {
  assert.equal(settlementCents(base), 5000);
  assert.equal(settlementCents({ ...base, date: "2026-09-30" }), 0);
  assert.equal(settlementCents({ ...base, paidBy: "moni" }), -5000);
  assert.equal(settlementCents({ ...base, amount: -1.01 }), 50);
});
test("a Moni-only expense paid by Marco is owed in full", () => {
  assert.equal(settlementCents({ ...base, allocations: [{ owner: "moni", amount: "-100.00" }] }), 10000);
});
test("a refundable deposit belonging to a third party is not a balance with Moni", () => {
  assert.equal(settlementCents({ ...base, amount: 150, entityKind: "property", allocations: [{ owner: "marco", amount: "25" }, { owner: "moni", amount: "25" }, { owner: "other", amount: "100" }] }), -2500);
});
test("bank settlements reduce or increase the balance and ambiguous capital is flagged", () => {
  assert.equal(settlementCents({ ...base, amount: 20, kind: "settlement" }), -2000);
  assert.equal(settlementCents({ ...base, amount: -20, kind: "settlement" }), 2000);
  assert.equal(settlementCents({ ...base, kind: "settlement", entityKind: "property" }), null);
  assert.equal(settlementCents({ ...base, kind: "settlement", entityKind: "payable", amount: -50 }), 5000);
  assert.equal(settlementCents({ ...base, kind: "settlement", accountId: null }), null);
  assert.equal(settlementCents({ ...base, entityKind: "property", category: "Aporte" }), null);
  assert.equal(settlementCurrency("USDC"), "USD");
  assert.equal(settlementCurrency("ARS"), "USD");
  assert.equal(settlementCurrency("EUR"), "EUR");
  assert.equal(settlementInDisplayCurrency(1380000, "ARS", -27600, "-17.92"), 896);
  assert.equal(settlementInDisplayCurrency(12755856, "ARS", -127558.56, "-83.00"), 8300);
  assert.equal(settlementInDisplayCurrency(100, "ARS", -100, null), null);
});

test("a client payment collected for Moni creates a debt only for her share", () => {
  assert.equal(settlementCents({ ...base, amount: 100, entityKind: "payable", allocations: [{ owner: "moni", amount: "91" }, { owner: "other", amount: "9" }] }), -9100);
});

test("explicit historical balances carry forward once without a bank account", () => {
  const opening: SharedMovement = { ...base, kind: "opening", category: "Saldo inicial con Moni", accountId: null };
  assert.equal(settlementCents({ ...opening, amount: -363.02 }), 36302);
  assert.equal(settlementCents({ ...opening, amount: 421.95 }), -42195);
  assert.equal(settlementCents({ ...opening, date: "2026-10-02" }), null);
  assert.equal(settlementCents({ ...opening, category: "Otros" }), null);
  assert.equal(settlementCents({ ...opening, accountId: "cash" }), null);
});
