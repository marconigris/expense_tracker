import { and, desc, eq, lte } from "drizzle-orm";
import { db, t } from "./db";

// USD value of one unit of each currency. USD-pegged stablecoins count as USD.
const PEGGED: Record<string, number> = { USD: 1, USDT: 1, USDC: 1 };

async function fetchSeries(currency: string, from: string, to: string) {
  if (currency === "ARS") {
    // Full MEP ("bolsa") history; mid between buy and sell.
    const res = await fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa");
    if (!res.ok) throw new Error(`MEP rates: HTTP ${res.status}`);
    const rows = (await res.json()) as { compra: number; venta: number; fecha: string }[];
    return rows
      .filter((r) => r.fecha >= from && r.fecha <= to)
      .map((r) => ({ date: r.fecha, usdPerUnit: 2 / (r.compra + r.venta), source: "argentinadatos-mep" }));
  }
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=${currency}&symbols=USD`);
  if (!res.ok) throw new Error(`${currency} rates: HTTP ${res.status}`);
  const body = (await res.json()) as { rates: Record<string, { USD: number }> };
  return Object.entries(body.rates).map(([date, r]) => ({ date, usdPerUnit: r.USD, source: "frankfurter" }));
}

/** Make sure fx_rates covers [from, to] for every currency (a few days of slack for weekends). */
export async function ensureRates(currencies: string[], from: string, to: string) {
  const start = shiftDate(from, -7);
  for (const currency of new Set(currencies)) {
    if (currency in PEGGED) continue;
    const series = await fetchSeries(currency, start, to);
    for (let i = 0; i < series.length; i += 500) {
      await db
        .insert(t.fxRates)
        .values(series.slice(i, i + 500).map((r) => ({ ...r, currency, usdPerUnit: String(r.usdPerUnit) })))
        .onConflictDoNothing();
    }
  }
}

/** Latest known rate on or before `date`. */
export async function usdPerUnit(currency: string, date: string): Promise<number | null> {
  if (currency in PEGGED) return PEGGED[currency];
  const [row] = await db
    .select({ v: t.fxRates.usdPerUnit })
    .from(t.fxRates)
    .where(and(eq(t.fxRates.currency, currency), lte(t.fxRates.date, date)))
    .orderBy(desc(t.fxRates.date))
    .limit(1);
  return row ? Number(row.v) : null;
}

/** Amount converted to USD and EUR, or nulls when a rate is missing. */
export async function convert(amount: number, currency: string, date: string) {
  const [toUsd, eurUsd] = await Promise.all([usdPerUnit(currency, date), usdPerUnit("EUR", date)]);
  const usd = toUsd == null ? null : amount * toUsd;
  const eur = currency === "EUR" ? amount : usd != null && eurUsd ? usd / eurUsd : null;
  return { amountUsd: usd == null ? null : usd.toFixed(2), amountEur: eur == null ? null : eur.toFixed(2) };
}

export function shiftDate(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
