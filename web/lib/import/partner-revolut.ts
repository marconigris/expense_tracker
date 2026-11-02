import Papa from "papaparse";
import { parseAmount, type ParsedRow } from "./csv";

const months: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** Read account ledgers only; summaries, investment returns and balances are not expenses. */
export function parsePartnerRevolut(text: string): { rows: ParsedRow[]; errors: string[] } | null {
  const matrix = Papa.parse<string[]>(text, { skipEmptyLines: false }).data;
  const start = matrix.findIndex((row) => row[0]?.trim() === "Current Accounts Transaction Statements");
  if (start < 0) return null;
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  let account = "";
  let currency = "";
  let ledger = false;
  for (let i = start + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const head = (row[0] ?? "").trim();
    if (/^(?:Flexible Cash Funds|Investment Services|Crypto) Transaction Statements$/.test(head)) break;
    const group = head.match(/^(.+?)\s*\(([A-Z]{3})\)$/);
    if (group && row.slice(1).every((cell) => !cell?.trim())) {
      account = group[1].trim(); currency = group[2]; ledger = false; continue;
    }
    if (head === "Date") {
      ledger = Boolean(account && row[1]?.trim() === "Description" && row[3]?.trim() === "Money in/out");
      if (!ledger) errors.push(`Fila ${i + 1}: formato de movimientos no reconocido.`);
      continue;
    }
    if (head.startsWith("---")) { account = ""; currency = ""; ledger = false; continue; }
    if (head === "Total") { ledger = false; continue; }
    const match = head.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
    if (!match) {
      if (ledger && head) errors.push(`Fila ${i + 1}: fecha no reconocida.`);
      continue;
    }
    if (!ledger || !months[match[1]]) { errors.push(`Fila ${i + 1}: cuenta o fecha no reconocida.`); continue; }
    const amount = parseAmount(row[3]);
    const description = row[1]?.trim();
    if (amount == null || !description) { errors.push(`Fila ${i + 1}: falta el monto o la descripción.`); continue; }
    rows.push({ date: `${match[3]}-${months[match[1]]}-${match[2].padStart(2, "0")}`, description: `${description} · ${account}`, amount, currency });
  }
  return { rows, errors };
}
