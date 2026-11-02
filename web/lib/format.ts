const SYMBOL: Record<string, string> = { USD: "$", USDT: "$", EUR: "€", ARS: "AR$" };

export function formatMoney(amount: number, currency: string) {
  const abs = Math.abs(amount);
  const n = abs.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  return `${amount < 0 && abs >= 0.5 ? "−" : ""}${SYMBOL[currency] ?? `${currency} `}${n}`;
}

/** Round explicitly labelled currency amounts embedded in explanatory text. */
export function formatMoneyInText(text: string) {
  return text.replace(/\b(USDC|USDT|USD|EUR|ARS|BRL|DOP)\s+(-?\d+[.,]\d{2})(?!\d)/gi, (_, currency: string, amount: string) => {
    const value = Number(amount.replace(",", "."));
    return `${currency} ${value < 0 ? "−" : ""}${Math.round(Math.abs(value)).toLocaleString("es-AR")}`;
  });
}
