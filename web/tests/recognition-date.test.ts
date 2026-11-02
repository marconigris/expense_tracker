import assert from "node:assert/strict";
import test from "node:test";
import { wiseCashbackRecognitionDate } from "../lib/recognition-date";

test("Wise Main cashback is recognized in the month it accrues, across year boundaries", () => {
  assert.equal(wiseCashbackRecognitionDate("wise-usd", "Cashback", 10, "2026-01-07"), "2025-12-31");
  assert.equal(wiseCashbackRecognitionDate("wise-usd", "Cashback", 10, "2026-07-03"), "2026-06-30");
  assert.equal(wiseCashbackRecognitionDate("wise-usd", "Cashback", 10, "2024-03-05"), "2024-02-29");
});

test("unrelated movements keep their original reporting date", () => {
  assert.equal(wiseCashbackRecognitionDate("wise-eur", "Cashback", 10, "2026-07-03"), null);
  assert.equal(wiseCashbackRecognitionDate("wise-usd", "Other", 10, "2026-07-03"), null);
  assert.equal(wiseCashbackRecognitionDate("wise-usd", "Cashback", -10, "2026-07-03"), null);
});
