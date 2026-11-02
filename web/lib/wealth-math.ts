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
export type WealthBucket = { cash: number; stocks: number; properties: number; custody: number; total: number; converted: { currency: string; amount: number }[] };

/** Only IBKR holds stocks and funds; banks, money market, Cocos and crypto can be withdrawn quickly. */
export function wealthGroup(account: { slug: string }): WealthGroup {
  return account.slug.startsWith("ibkr") ? "stocks" : "cash";
}

/**
 * Marco's wealth in two buckets that are never mixed: EUR stays in EUR, every other currency is converted to USD
 * with `usdPerUnit`. Account balances are gross; dad's custody sits in Marco's accounts and is subtracted.
 */
export function wealthTotals(accounts: Money[], properties: { stake: number; stakeCurrency: string }[], usdPerUnit: Record<string, number | null>,
  custody: { currency: string; balance: number }[] = []) {
  const usd: WealthBucket = { cash: 0, stocks: 0, properties: 0, custody: 0, total: 0, converted: [] };
  const eur: WealthBucket = { cash: 0, stocks: 0, properties: 0, custody: 0, total: 0, converted: [] };
  const missingRates = new Set<string>();
  let hasEur = false;
  const add = (currency: string, amount: number, field: WealthGroup | "properties" | "custody") => {
    if (!amount) return;
    if (currency === "EUR") { hasEur = true; eur[field] += amount; return; }
    const rate = currency === "USD" ? 1 : usdPerUnit[currency];
    if (rate == null) { missingRates.add(currency); return; }
    usd[field] += amount * rate;
    if (currency !== "USD" && field !== "properties" && field !== "custody") {
      const item = usd.converted.find((c) => c.currency === currency);
      if (item) item.amount += amount; else usd.converted.push({ currency, amount });
    }
  };
  for (const a of accounts) if (a.value != null) add(a.currency, a.value, a.group);
  for (const p of properties) add(p.stakeCurrency, p.stake, "properties");
  for (const c of custody) add(c.currency, c.balance, "custody");
  for (const b of [usd, eur]) b.total = b.cash + b.stocks + b.properties - b.custody;
  return { usd, eur: hasEur ? eur : null, missingRates: [...missingRates] };
}

const EUROPE = ["Bunq", "Revolut", "Wise"];
const REGIONS: [string, string[]][] = [
  ["Europa EUR", EUROPE],
  ["Europa USD", EUROPE],
  ["Argentina", ["ARQ", "Brubank", "Cocos"]],
  ["Crypto", ["Binance", "Crypto.com"]],
];

/** European banks split by currency (EUR apart from the rest); other regions by bank. */
function regionOf(account: { institution: string; currency: string }) {
  if (EUROPE.includes(account.institution)) return account.currency === "EUR" ? "Europa EUR" : "Europa USD";
  return REGIONS.find(([, banks]) => banks.includes(account.institution))?.[0] ?? account.institution;
}

/** Regions in a fixed order, then any other institution as its own group; banks and accounts sorted by name. */
export function groupAccounts<T extends { institution: string; name: string; currency: string }>(accounts: T[]) {
  const byName = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });
  const order = (region: string) => { const i = REGIONS.findIndex(([r]) => r === region); return i < 0 ? REGIONS.length : i; };
  const regions = [...new Set(accounts.map(regionOf))].sort((a, b) => order(a) - order(b) || byName(a, b));
  return regions.map((region) => {
    const inRegion = accounts.filter((a) => regionOf(a) === region);
    const banks = [...new Set(inRegion.map((a) => a.institution))].sort(byName);
    return { region, banks: banks.map((bank) => ({ bank, accounts: inRegion.filter((a) => a.institution === bank).sort((a, b) => byName(a.name, b.name)) })) };
  });
}
