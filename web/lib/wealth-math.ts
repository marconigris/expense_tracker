type Movement = { date: string; amount: string; kind: string; status: string; batchId: string | null };
type Snapshot = { date: string; value: string; notes: string | null };

/** A snapshot is never silently rolled forward: some assets lack transaction detail. */
export function recordedBalance(movements: Movement[], snapshots: Snapshot[]) {
  const snapshot = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (snapshot) return { value: Number(snapshot.value), date: snapshot.date, source: "snapshot" as const,
    notes: snapshot.notes, later: movements.some((m) => m.date > snapshot.date && m.batchId != null) };
  const openings = movements.filter((m) => m.kind === "opening" && m.status === "confirmed");
  if (!openings.length) return { value: null, date: null, source: "unknown" as const, notes: null, later: false };
  const from = openings.map((m) => m.date).sort()[0];
  const relevant = movements.filter((m) => m.date >= from && (m.batchId != null || m.status === "confirmed"));
  return { value: relevant.reduce((sum, m) => sum + Math.round(Number(m.amount) * 100), 0) / 100,
    date: relevant.map((m) => m.date).sort().at(-1) ?? from, source: "opening" as const, notes: null, later: false };
}

type Money = { currency: string; value: number | null };
export type WealthBucket = { accounts: number; properties: number; custody: number; total: number; converted: { currency: string; amount: number }[] };

/**
 * Marco's net worth in two buckets that are never mixed: EUR stays in EUR, every other currency is
 * converted to USD with `usdPerUnit`. Dad's custody is subtracted; property stakes count in their currency.
 */
export function wealthTotals(accounts: Money[], custody: { currency: string; balance: number }[], properties: { stake: number; stakeCurrency: string }[],
  usdPerUnit: Record<string, number | null>) {
  const usd: WealthBucket = { accounts: 0, properties: 0, custody: 0, total: 0, converted: [] };
  const eur: WealthBucket = { accounts: 0, properties: 0, custody: 0, total: 0, converted: [] };
  const missingRates = new Set<string>();
  let hasEur = false;
  const add = (currency: string, amount: number, field: "accounts" | "properties" | "custody") => {
    if (!amount) return;
    if (currency === "EUR") { hasEur = true; eur[field] += amount; return; }
    const rate = currency === "USD" ? 1 : usdPerUnit[currency];
    if (rate == null) { missingRates.add(currency); return; }
    usd[field] += amount * rate;
    if (currency !== "USD" && field === "accounts") {
      const item = usd.converted.find((c) => c.currency === currency);
      if (item) item.amount += amount; else usd.converted.push({ currency, amount });
    }
  };
  for (const a of accounts) if (a.value != null) add(a.currency, a.value, "accounts");
  for (const p of properties) add(p.stakeCurrency, p.stake, "properties");
  for (const c of custody) add(c.currency, c.balance, "custody");
  for (const b of [usd, eur]) b.total = b.accounts + b.properties - b.custody;
  return { usd, eur: hasEur ? eur : null, missingRates: [...missingRates] };
}
