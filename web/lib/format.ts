const SYMBOL: Record<string, string> = { USD: "$", USDT: "$", EUR: "€", ARS: "AR$" };

export function formatMoney(amount: number, currency: string) {
  const abs = Math.abs(amount);
  const n = abs.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  return `${amount < 0 && abs >= 0.5 ? "−" : ""}${SYMBOL[currency] ?? `${currency} `}${n}`;
}
