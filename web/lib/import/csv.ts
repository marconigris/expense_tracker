import Papa from "papaparse";

export type ParsedRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed, negative = money out
  currency?: string; // when the file mixes currencies (Revolut, Wise)
  product?: string; // Revolut "Current" / "Savings" / "Deposit"
  reference?: string; // bank transaction identifier, when available
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const COLUMNS = {
  date: ["completed date", "fecha", "date", "fecha operacion", "started date", "fecha de operacion", "fechaejecucion"],
  description: ["description", "descripcion", "concepto", "detalle", "merchant", "payee", "tipooperacion"],
  amount: ["amount", "importe", "monto", "valor", "total"],
  debit: ["debit", "debito", "egreso", "paid out", "cargo"],
  credit: ["credit", "credito", "ingreso", "paid in", "abono"],
  fee: ["fee", "comision"],
  currency: ["currency", "moneda"],
  product: ["product"],
  reference: ["reference", "transaction id", "transferwise id", "external id", "nroticket"],
  state: ["state", "estado"],
  counterpartyName: ["name"],
  instrument: ["instrumento"],
  settlementDate: ["fechaliquidacion"],
};

function findColumn(headers: string[], names: string[]) {
  for (const name of names) {
    const i = headers.findIndex((h) => norm(h) === name);
    if (i >= 0) return i;
  }
  return -1;
}

/** Parses "1.234,56", "1,234.56", "-12.5", "(30.00)" and "$ 1.000". */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d,.\-()]/g, "");
  if (!s) return null;
  const negative = s.startsWith("-") || s.startsWith("(");
  s = s.replace(/[-()]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/** Cocos uses dots as thousands separators and commas as decimal separators. */
function parseCocosAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  return parseAmount(raw.replace(/\./g, "").replace(",", "."));
}

/** Accepts ISO dates (with time), DD/MM/YYYY and DD-MM-YYYY. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export function parseCsv(text: string): { rows: ParsedRow[]; format: string; errors: string[] } {
  const { data } = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const headerIndex = data.findIndex((r) => findColumn(r, COLUMNS.date) >= 0);
  if (headerIndex < 0) return { rows: [], format: "unknown", errors: ["No encontré una columna de fecha"] };

  const headers = data[headerIndex];
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, findColumn(headers, names)]),
  ) as Record<keyof typeof COLUMNS, number>;
  const isCocos = headers.some((h) => norm(h) === "nroticket") && headers.some((h) => norm(h) === "tipooperacion") && headers.some((h) => norm(h) === "total");
  const isBunq = headers.some((h) => norm(h) === "interest date") && headers.some((h) => norm(h) === "counterparty");
  const format = isCocos ? "cocos" : isBunq ? "bunq" : col.product >= 0 && col.state >= 0 ? "revolut" : headers.some((h) => norm(h) === "transferwise id") ? "wise" : "csv";

  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  for (const [i, r] of data.slice(headerIndex + 1).entries()) {
    // Revolut lists declined and reverted card payments too.
    if (col.state >= 0 && !["completed", "completado"].includes(norm(r[col.state] ?? ""))) continue;
    const date = parseDate(isCocos && col.settlementDate >= 0 ? r[col.settlementDate] : r[col.date]);
    let amount = col.amount >= 0 ? (isCocos ? parseCocosAmount(r[col.amount]) : parseAmount(r[col.amount])) : null;
    if (amount == null && (col.debit >= 0 || col.credit >= 0)) {
      const debit = parseAmount(r[col.debit]) ?? 0;
      const credit = parseAmount(r[col.credit]) ?? 0;
      amount = credit - Math.abs(debit);
    }
    if (!date || amount == null) {
      errors.push(`Fila ${headerIndex + i + 2}: no pude leer fecha o monto`);
      continue;
    }
    // Cocos total is already net of fees and taxes.
    const fee = !isCocos && col.fee >= 0 ? (parseAmount(r[col.fee]) ?? 0) : 0;
    const description = (r[col.description] ?? "").trim();
    const counterparty = isBunq ? (r[col.counterpartyName] ?? "").trim() : "";
    const instrument = isCocos ? (r[col.instrument] ?? "").trim() : "";
    rows.push({
      date,
      description: [counterparty, description, instrument].filter(Boolean).join(" — "),
      amount: amount - Math.abs(fee),
      currency: col.currency >= 0 ? r[col.currency]?.trim().toUpperCase() || undefined : undefined,
      product: col.product >= 0 ? r[col.product]?.trim() : undefined,
      reference: col.reference >= 0 ? r[col.reference]?.trim() || undefined : undefined,
    });
  }
  return { rows, format, errors };
}
