import { MONI_SETTLEMENT_START } from "./catalog";
import type { OwnershipAllocation } from "./allocations";

export type SharedMovement = {
  date: string;
  amount: number;
  paidBy: "marco" | "moni";
  kind: "normal" | "settlement";
  accountId: string | null;
  entityKind: string;
  category: string | null;
  marcoShare: number;
  allocations: OwnershipAllocation[];
};

/** Signed cents: positive means Moni owes Marco. Null means the record needs clarification. */
export function settlementCents(m: SharedMovement): number | null {
  if (m.date < MONI_SETTLEMENT_START) return 0;
  const cents = Math.round(m.amount * 100);
  if (m.kind === "settlement") {
    // Property capital movements cannot be distinguished from a household settlement yet.
    if (!m.accountId || m.entityKind !== "household") return null;
    return -cents;
  }
  if (m.entityKind === "property" && m.category === "Aporte") return null;
  let marco: number;
  let moni: number;
  if (m.allocations.length) {
    const all = m.allocations.reduce((n, a) => n + Math.round(Number(a.amount) * 100), 0);
    if (all !== cents) return null;
    marco = m.allocations.filter((a) => a.owner === "marco").reduce((n, a) => n + Math.round(Number(a.amount) * 100), 0);
    moni = m.allocations.filter((a) => a.owner === "moni").reduce((n, a) => n + Math.round(Number(a.amount) * 100), 0);
  } else {
    marco = Math.sign(cents) * Math.round(Math.abs(cents) * m.marcoShare);
    moni = cents - marco;
  }
  return m.paidBy === "marco" ? -moni : marco;
}

export function settlementCurrency(currency: string): string {
  return currency === "USDC" || currency === "USDT" ? "USD" : currency;
}
