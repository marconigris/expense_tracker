/** Wise Main cashback accrues during the month before it is credited. */
export function wiseCashbackRecognitionDate(accountSlug: string, description: string, amount: number, postingDate: string): string | null {
  if (accountSlug !== "wise-usd" || description.trim().toLowerCase() !== "cashback" || amount <= 0) return null;
  const [year, month] = postingDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}
