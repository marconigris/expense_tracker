const SYMBOL: Record<string, string> = { USD: "$", USDT: "$", EUR: "€", ARS: "AR$" };

export function formatMoney(amount: number, currency: string, opts: { compact?: boolean } = {}) {
  const abs = Math.abs(amount);
  const digits = opts.compact && abs >= 1000 ? 0 : 2;
  const n = abs.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${amount < 0 ? "−" : ""}${SYMBOL[currency] ?? `${currency} `}${n}`;
}
