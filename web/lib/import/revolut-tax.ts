import Papa from "papaparse";
import { parseAmount, type ParsedRow } from "./csv";

export type TaxGroup = { slug: string; currency: string; rows: ParsedRow[]; opening?: number; closing?: number };
export type TaxReport = { groups: TaxGroup[]; errors: string[]; cryptoSales: number };

const GROUPS: Record<string, { slug: string; currency: string }> = {
  "Personal Account (EUR)": { slug: "revolut-eur", currency: "EUR" },
  "Personal Account (USD)": { slug: "revolut-usd", currency: "USD" },
  "Personal Account (ZAR)": { slug: "revolut-zar", currency: "ZAR" },
  "Pro (EUR)": { slug: "revolut-pro", currency: "EUR" },
  "Pro (USD)": { slug: "revolut-pro-usd", currency: "USD" },
  "Flexible Cash Funds (EUR)": { slug: "revolut-ahorro-eur", currency: "EUR" },
  "Flexible Cash Funds (USD)": { slug: "revolut-ahorro-usd", currency: "USD" },
};
const MONTH: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function dateValue(s: string): string | null {
  const m = s.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  return m && MONTH[m[1]] ? `${m[3]}-${MONTH[m[1]]}-${m[2].padStart(2, "0")}` : null;
}
const cents = (n: number) => Math.round(n * 100);
const keyName = (s: string) => s.trim().replace(/\s+/g, " ");

/** A consolidated tax report contains separate account ledgers and fund-return tables. */
export function parseRevolutTaxReport(text: string): TaxReport | null {
  const matrix = Papa.parse<string[]>(text, { skipEmptyLines: false }).data;
  if (!matrix.some((r) => r[0]?.trim() === "Current Accounts Transaction Statements")) return null;
  const groups = new Map<string, TaxGroup>();
  const errors: string[] = [];
  let area = "summary";
  let current = "";
  let running: number | undefined;
  let cryptoSales = 0;
  for (const [index, row] of matrix.entries()) {
    const head = keyName(row[0] ?? "");
    if (head === "Investment Services Summaries" || head === "Crypto Summaries") { current = ""; area = "other-summary"; continue; }
    if (head === "Current Accounts Transaction Statements") { area = "current"; current = ""; continue; }
    if (head === "Flexible Cash Funds Transaction Statements") { area = "funds"; current = ""; continue; }
    if (head === "Investment Services Transaction Statements") { area = "other"; current = ""; continue; }
    if (head === "Crypto Transaction Statements") { area = "crypto"; current = ""; continue; }
    if (/^(Personal Account|Pro|Flexible Cash Funds) \([A-Z]{3}\)$/.test(head)) {
      current = head; running = undefined;
      if (GROUPS[head] && !groups.has(head)) groups.set(head, { ...GROUPS[head], rows: [] });
      continue;
    }
    if (area === "summary" && current && GROUPS[current]) {
      const group = groups.get(current)!;
      const open = row.findIndex((v) => keyName(v) === "Opening balance");
      const close = row.findIndex((v) => keyName(v) === "Closing balance");
      if (open >= 0) group.opening = parseAmount(row[open + 1]) ?? undefined;
      if (close >= 0) group.closing = parseAmount(row[close + 1]) ?? undefined;
      continue;
    }
    if (area === "crypto" && /^\d{2}\.\d{2}\.\d{2}$/.test(head)) { cryptoSales++; continue; }
    const date = dateValue(head);
    if (!date || !current) continue;
    const group = groups.get(current);
    if (!group) { errors.push(`Fila ${index + 1}: cuenta no admitida (${current})`); continue; }
    if (area === "current") {
      const amount = parseAmount(row[3]);
      const balance = parseAmount(row[group.currency === "EUR" ? 4 : 5]);
      if (amount == null || balance == null) { errors.push(`Fila ${index + 1}: monto o saldo inválido`); continue; }
      if (running === undefined && group.opening !== undefined && cents(group.opening + amount) !== cents(balance)) errors.push(`Fila ${index + 1}: saldo inicial no concilia`);
      if (running !== undefined && cents(running + amount) !== cents(balance)) errors.push(`Fila ${index + 1}: saldo no concilia`);
      running = balance;
      group.rows.push({ date, description: row[1]?.trim() || "Movimiento Revolut", amount, currency: group.currency,
        sourceAmountEur: group.currency === "EUR" ? amount : parseAmount(row[4]) ?? undefined, sourceCategory: row[2]?.trim() });
    } else if (area === "funds") {
      const net = parseAmount(row[group.currency === "EUR" ? 6 : 10]);
      const gross = parseAmount(row[2]);
      const fee = parseAmount(row[group.currency === "EUR" ? 5 : 8]);
      if (net == null || gross == null || fee == null || cents(gross - fee) !== cents(net)) { errors.push(`Fila ${index + 1}: rendimiento no concilia`); continue; }
      group.rows.push({ date, description: "Interés neto - Revolut Flexible Cash Funds", amount: net, currency: group.currency,
        sourceAmountEur: group.currency === "EUR" ? net : parseAmount(row[11]) ?? undefined, sourceCategory: "Rendimiento neto" });
    }
  }
  for (const group of groups.values()) {
    if (["revolut-eur", "revolut-usd", "revolut-zar", "revolut-pro", "revolut-pro-usd"].includes(group.slug) && group.rows.length && group.closing !== undefined) {
      const sum = group.rows.reduce((n, r) => n + cents(r.amount), 0);
      if (group.opening === undefined || cents(group.opening) + sum !== cents(group.closing)) errors.push(`${group.slug}: saldo final no concilia`);
    }
  }
  return { groups: [...groups.values()].filter((g) => g.rows.length), errors, cryptoSales };
}
