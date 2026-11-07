import assert from "node:assert/strict";
import test from "node:test";
import { vehicleValue } from "../lib/vehicle-math";
import { wealthTotals } from "../lib/wealth-math";

test("vehicle depreciation applies only to Marco's share and never falls below zero", () => {
  const car = { acquired: "2026-06-01", priceCents: 350000, share: 0.5, annualRate: 0.2 };
  assert.deepEqual(vehicleValue(car, "2026-05"), { cost: 0, depreciation: 0, value: 0 });
  assert.equal(vehicleValue(car, "2027-05").value, 140000);
  assert.equal(vehicleValue(car, "2031-05").value, 0);
  assert.equal(vehicleValue(car, "2031-06").depreciation, 0);
});

test("the shared Europe car is depreciated at 15% of Marco's half and appears as an asset", () => {
  const car = { acquired: "2026-06-01", priceCents: 350000, share: 0.5, annualRate: 0.15 };
  const june = vehicleValue(car, "2026-06");
  assert.deepEqual(june, { cost: 175000, depreciation: 2188, value: 172812 });
  assert.equal(vehicleValue(car, "2027-05").value, 148750);
  const total = wealthTotals([], [], {}, [], [], [{ name: "Auto Europa", currency: "EUR", value: june.value / 100 }]);
  assert.equal(total.eur?.vehicles, 1728.12);
  assert.equal(total.eur?.total, 1728.12);
});
