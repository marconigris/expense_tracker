import { createHash } from "node:crypto";

export const PARTNER_CURRENCIES = ["EUR", "USD", "ARS", "BRL"] as const;
export const PARTNER_AREAS = { brasil: "hogar-brasil", cabarete: "hogar-cabarete", europa: "hogar-europa", personal: null, negocio: null } as const;
export type PartnerArea = keyof typeof PARTNER_AREAS;
export type PartnerCurrency = (typeof PARTNER_CURRENCIES)[number];
export type PartnerExpense = { date: string; description: string; amount: number; currency: PartnerCurrency; reference?: string; occurrence: number };

export function isPartnerExpenseSpace(entity: { active: boolean; sharedWithMoni: boolean; kind: string }) {
  return entity.active && entity.sharedWithMoni && ["household", "property"].includes(entity.kind);
}

export function partnerArea(value: string): PartnerArea {
  if (!Object.hasOwn(PARTNER_AREAS, value)) throw new Error("Elegí una categoría válida.");
  return value as PartnerArea;
}

export function validIsoDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === date && date >= "2000-01-01" && date <= "2100-12-31";
}

export function validatePartnerExpense(raw: { date: string; description: string; amount: number; currency: string; reference?: string; occurrence?: number }): PartnerExpense {
  const description = raw.description.trim();
  const currency = raw.currency.toUpperCase();
  const occurrence = raw.occurrence ?? 0;
  if (!validIsoDate(raw.date) || !description || description.length > 250 || !Number.isFinite(raw.amount) || raw.amount <= 0 || raw.amount > 1_000_000_000 || Math.abs(raw.amount * 100 - Math.round(raw.amount * 100)) > 0.000001 || !PARTNER_CURRENCIES.includes(currency as PartnerCurrency) || !Number.isInteger(occurrence) || occurrence < 0 || occurrence > 500 || (raw.reference?.length ?? 0) > 250) throw new Error("Revisá la fecha, descripción, monto o moneda.");
  return { date: raw.date, description, amount: raw.amount, currency: currency as PartnerCurrency, reference: raw.reference?.trim() || undefined, occurrence };
}

/** The same source and bank reference, or same occurrence when there is no reference, are idempotent. */
export function partnerCsvKey(userId: string, source: string, row: PartnerExpense) {
  const parts = ["moni-csv-v1", userId, source.trim().toLocaleLowerCase("es"), row.date, row.description.toLocaleLowerCase("es"), row.amount.toFixed(2), row.currency, row.reference || `occurrence:${row.occurrence}`];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function partnerSplit(amount: number, marcoPercent: number) {
  if (![0, 50, 100].includes(marcoPercent)) throw new Error("Elegí un reparto válido.");
  const total = Math.round(amount * 100);
  const marco = Math.round(total * marcoPercent / 100);
  return { marco: (-marco / 100).toFixed(2), moni: (-(total - marco) / 100).toFixed(2) };
}
