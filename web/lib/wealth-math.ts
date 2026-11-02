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

export type WealthGroup = "cash" | "stocks";
type Money = { currency: string; value: number | null; group: WealthGroup };
export type WealthBucket = { cash: number; stocks: number; properties: number; total: number; converted: { currency: string; amount: number }[] };

/** Only IBKR holds stocks and funds; banks, money market, Cocos and crypto can be withdrawn quickly. */
export function wealthGroup(account: { slug: string }): WealthGroup {
  return account.slug.startsWith("ibkr") ? "stocks" : "cash";
}

/**
 * Marco's wealth in two buckets that are never mixed: EUR stays in EUR, every other currency is converted to USD
 * with `usdPerUnit`. Balances are gross: money held for others is shown elsewhere, not subtracted here.
 */
export function wealthTotals(accounts: Money[], properties: { stake: number; stakeCurrency: string }[], usdPerUnit: Record<string, number | null>) {
  const usd: WealthBucket = { cash: 0, stocks: 0, properties: 0, total: 0, converted: [] };
  const eur: WealthBucket = { cash: 0, stocks: 0, properties: 0, total: 0, converted: [] };
  const missingRates = new Set<string>();
  let hasEur = false;
  const add = (currency: string, amount: number, field: WealthGroup | "properties") => {
    if (!amount) return;
    if (currency === "EUR") { hasEur = true; eur[field] += amount; return; }
    const rate = currency === "USD" ? 1 : usdPerUnit[currency];
    if (rate == null) { missingRates.add(currency); return; }
    usd[field] += amount * rate;
    if (currency !== "USD" && field !== "properties") {
      const item = usd.converted.find((c) => c.currency === currency);
      if (item) item.amount += amount; else usd.converted.push({ currency, amount });
    }
  };
  for (const a of accounts) if (a.value != null) add(a.currency, a.value, a.group);
  for (const p of properties) add(p.stakeCurrency, p.stake, "properties");
  for (const b of [usd, eur]) b.total = b.cash + b.stocks + b.properties;
  return { usd, eur: hasEur ? eur : null, missingRates: [...missingRates] };
}
