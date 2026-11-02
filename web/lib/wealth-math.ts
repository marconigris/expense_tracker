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
type Money = { currency: string; value: number | null; group: WealthGroup; name?: string };
type Field = WealthGroup | "loans" | "properties" | "custody";
/** One contribution to a bubble line, in the bucket's currency; `original` is set when it was converted. */
export type WealthLine = { name: string; amount: number; original?: { amount: number; currency: string } };
export type WealthBucket = { cash: number; stocks: number; loans: number; properties: number; custody: number; total: number;
  converted: { currency: string; amount: number }[]; lines: Record<Field, WealthLine[]> };

/** IBKR and crypto wallets are investments; banks, money market and Cocos can be withdrawn quickly. */
export function wealthGroup(account: { slug: string; kind?: string }): WealthGroup {
  return account.slug.startsWith("ibkr") || account.kind === "crypto" ? "stocks" : "cash";
}

/**
 * Marco's wealth in two buckets that are never mixed: EUR stays in EUR, every other currency is converted to USD
 * with `usdPerUnit`. Accounts carry only Marco's own money; `debts` (cash owed to dad, dad's money not yet
 * placed in an account) are subtracted.
 */
export function wealthTotals(accounts: Money[], properties: { stake: number; stakeCurrency: string; name?: string }[], usdPerUnit: Record<string, number | null>,
  debts: { currency: string; balance: number; name: string }[] = [], loans: { currency: string; value: number; name: string }[] = []) {
  const bucket = (): WealthBucket => ({ cash: 0, stocks: 0, loans: 0, properties: 0, custody: 0, total: 0, converted: [], lines: { cash: [], stocks: [], loans: [], properties: [], custody: [] } });
  const usd = bucket();
  const eur = bucket();
  const missingRates = new Set<string>();
  let hasEur = false;
  const add = (currency: string, amount: number, field: Field, name = currency) => {
    if (!amount) return;
    if (currency === "EUR") { hasEur = true; eur[field] += amount; eur.lines[field].push({ name, amount }); return; }
    const rate = currency === "USD" ? 1 : usdPerUnit[currency];
    if (rate == null) { missingRates.add(currency); return; }
    usd[field] += amount * rate;
    usd.lines[field].push(currency === "USD" ? { name, amount } : { name, amount: amount * rate, original: { amount, currency } });
    if (currency !== "USD" && (field === "cash" || field === "stocks")) {
      const item = usd.converted.find((c) => c.currency === currency);
      if (item) item.amount += amount; else usd.converted.push({ currency, amount });
    }
  };
  for (const a of accounts) if (a.value != null) add(a.currency, a.value, a.group, a.name);
  for (const p of properties) add(p.stakeCurrency, p.stake, "properties", p.name);
  for (const d of debts) add(d.currency, d.balance, "custody", d.name);
  for (const l of loans) add(l.currency, l.value, "loans", l.name);
  for (const b of [usd, eur]) for (const lines of Object.values(b.lines)) lines.sort((x, y) => y.amount - x.amount);
  for (const b of [usd, eur]) b.total = b.cash + b.stocks + b.loans + b.properties - b.custody;
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

export type CustodyHolding = { accountId: string; name: string; currency: string; value: number };

/**
 * Dad's bank money by currency, placed in the accounts that hold it. What is not placed in any account
 * is `unplaced` and still has to be taken out of Marco's side so it never counts as his.
 */
export function placeCustody(bank: { currency: string; balance: number }[], holdings: CustodyHolding[]) {
  const currencies = [...new Set([...bank.map((b) => b.currency), ...holdings.map((h) => h.currency)])];
  return currencies.map((currency) => {
    const total = bank.filter((b) => b.currency === currency).reduce((sum, b) => sum + b.balance, 0);
    const held = holdings.filter((h) => h.currency === currency).sort((a, b) => b.value - a.value);
    const placed = held.reduce((sum, h) => sum + h.value, 0);
    return { currency, total, held, unplaced: Math.round((total - placed) * 100) / 100 };
  });
}

type Movement2 = { accountId: string | null; date: string; amount: string; status: string; batchId: string | null; kind?: string };

/**
 * Balance of each account at `date`, walking back from its latest known balance (`anchor`) by undoing the
 * physical movements after `date`. Accounts without movements keep their anchor value (marked `assumed`).
 * Settlements (e.g. Moni paying what she owed) are not undone: collecting a debt does not change net worth.
 */
export function balanceAt(anchor: { value: number; date: string }, movements: Movement2[], date: string) {
  if (date >= anchor.date) return { value: anchor.value, assumed: false };
  const relevant = movements.filter((m) => m.batchId != null || m.status === "confirmed");
  const after = relevant.filter((m) => m.date > date && m.date <= anchor.date && m.kind !== "settlement");
  const cents = Math.round(anchor.value * 100) - after.reduce((sum, m) => sum + Math.round(Number(m.amount) * 100), 0);
  return { value: cents / 100, assumed: relevant.length === 0 };
}

/** Last day of each month from `from` (YYYY-MM) up to, not including, `until` (YYYY-MM). */
export function monthEnds(from: string, until: string) {
  const out: { month: string; end: string }[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` < until; m === 12 ? (y++, m = 1) : m++) {
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) });
  }
  return out;
}
