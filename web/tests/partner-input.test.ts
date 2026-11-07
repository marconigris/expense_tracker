import assert from "node:assert/strict";
import test from "node:test";
import { isPartnerExpenseSpace, partnerArea, partnerCsvKey, partnerSplit, validIsoDate, validatePartnerExpense } from "../lib/partner-input";
import { settlementCents } from "../lib/settlement";
import { partnerMonthly } from "../lib/partner-report";

test("partner expenses are restricted to active shared household or property spaces", () => {
  assert.equal(isPartnerExpenseSpace({ active: true, sharedWithMoni: true, kind: "household" }), true);
  assert.equal(isPartnerExpenseSpace({ active: true, sharedWithMoni: true, kind: "property" }), true);
  assert.equal(isPartnerExpenseSpace({ active: true, sharedWithMoni: false, kind: "property" }), false);
  assert.equal(isPartnerExpenseSpace({ active: false, sharedWithMoni: true, kind: "household" }), false);
  assert.equal(isPartnerExpenseSpace({ active: true, sharedWithMoni: true, kind: "payable" }), false);
  assert.equal(partnerArea("personal"), "personal");
  assert.throws(() => partnerArea("coaching"));
  assert.throws(() => partnerArea("__proto__"));
});

test("monthly spending combines private costs and Moni's share without counting Marco's share", () => {
  const rows = [
    { date: "2026-10-01", area: "personal", amount: -20, amountUsd: -20, marcoShare: 0, allocations: [] },
    { date: "2026-10-02", area: "brasil", amount: -100, amountUsd: -100, marcoShare: 0.5, allocations: [] },
    { date: "2026-10-03", area: "brasil", amount: -60, amountUsd: -60, marcoShare: 0.5, allocations: [{ owner: "marco" as const, amount: "-50" }, { owner: "moni" as const, amount: "-10" }] },
    { date: "2026-10-04", area: "europa", amount: -30, amountUsd: null, marcoShare: 0.5, allocations: [] },
  ];
  assert.deepEqual(partnerMonthly(rows), [{ month: "2026-10", total: 80, areas: { personal: 20, brasil: 60 }, missingFx: 1 }]);
  assert.deepEqual(partnerMonthly([{ date: "2026-10-05", area: "brasil", amount: 20, amountUsd: 20, marcoShare: 0.5, allocations: [] }]),
    [{ month: "2026-10", total: -10, areas: { brasil: -10 }, missingFx: 0 }]);
});

test("a car purchase keeps the shared balance but is removed from Moni's consumption", () => {
  const rows = [{ date: "2026-10-02", area: "brasil", amount: -4000, amountUsd: -4000, marcoShare: 0.5, allocations: [], capitalFraction: 0.875 }];
  assert.equal(partnerMonthly(rows)[0].total, 250);
});

test("a Moni-paid split creates the right balance without losing cents", () => {
  const split = partnerSplit(101.01, 50);
  assert.deepEqual(split, { marco: "-50.51", moni: "-50.50" });
  assert.equal(settlementCents({ date: "2026-10-02", amount: -101.01, paidBy: "moni", kind: "normal", accountId: null,
    entityKind: "household", category: "Otros", marcoShare: 0.5, allocations: [{ owner: "marco", amount: split.marco }, { owner: "moni", amount: split.moni }] }), -5051);
  assert.deepEqual(partnerSplit(12.35, 0), { marco: "0.00", moni: "-12.35" });
  assert.deepEqual(partnerSplit(12.35, 100), { marco: "-12.35", moni: "0.00" });
  assert.throws(() => partnerSplit(1, 33));
});

test("CSV reimports are stable but distinct repeated expenses are retained", () => {
  const row = validatePartnerExpense({ date: "2026-10-02", description: "Mercado", amount: 12.34, currency: "BRL", occurrence: 0 });
  assert.equal(partnerCsvKey("moni", "Banco", row), partnerCsvKey("moni", " banco ", row));
  assert.notEqual(partnerCsvKey("moni", "Banco", row), partnerCsvKey("moni", "Banco", { ...row, occurrence: 1 }));
  assert.notEqual(partnerCsvKey("moni", "Banco", row), partnerCsvKey("moni", "Otra tarjeta", row));
  assert.notEqual(partnerCsvKey("moni", "Banco", row), partnerCsvKey("otra persona", "Banco", row));
});

test("invalid dates, amounts and currencies cannot enter partner expenses", () => {
  assert.equal(validIsoDate("2026-02-30"), false);
  const row = { date: "2026-10-02", description: "Mercado", amount: 12.34, currency: "BRL" };
  assert.throws(() => validatePartnerExpense({ ...row, amount: -12 }));
  assert.throws(() => validatePartnerExpense({ ...row, amount: 12.345 }));
  assert.throws(() => validatePartnerExpense({ ...row, currency: "INVALID" }));
  assert.throws(() => validatePartnerExpense({ ...row, date: "2026-02-30" }));
});

test("Camp expenses are Moni's own and stay out of her consumption total", () => {
  assert.equal(partnerArea("camp"), "camp");
  const rows = [
    { date: "2026-10-01", area: "personal", amount: -20, amountUsd: -20, marcoShare: 0, allocations: [] },
    { date: "2026-10-01", area: "camp", amount: -75, amountUsd: -75, marcoShare: 0, allocations: [] },
  ];
  assert.deepEqual(partnerMonthly(rows), [{ month: "2026-10", total: 20, areas: { personal: 20, camp: 75 }, missingFx: 0 }]);
});
