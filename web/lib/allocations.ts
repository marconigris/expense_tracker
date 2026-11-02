import { MONI_SETTLEMENT_START } from "./catalog";

export type OwnershipAllocation = {
  owner: "marco" | "moni" | "papa" | "other";
  amount: string | number;
};

function validateAllocations(original: number, allocations: OwnershipAllocation[]) {
  if (allocations.length === 0) return;
  const allocatedCents = allocations.reduce((sum, a) => sum + Math.round(Number(a.amount) * 100), 0);
  if (allocatedCents !== Math.round(original * 100)) throw new Error("Ownership allocations do not add up to the transaction");
}

/** Convert Marco's allocated share at the same rate as the original movement. */
export function marcoAmount(original: number, converted: number, allocations: OwnershipAllocation[]): number {
  if (allocations.length === 0) return converted;
  validateAllocations(original, allocations);
  if (original === 0) return 0;
  const share = allocations.filter((a) => a.owner === "marco").reduce((sum, a) => sum + Number(a.amount), 0);
  return converted === original ? share : converted * share / original;
}

/** Shared households and properties use their default share unless a movement is split explicitly. */
export function marcoReportedAmount(
  original: number,
  converted: number,
  allocations: OwnershipAllocation[],
  entityKind: string,
  defaultShare: number,
): number {
  const amount = marcoAmount(original, converted, allocations);
  return allocations.length === 0 && (entityKind === "household" || entityKind === "property")
    ? amount * defaultShare
    : amount;
}

/** A split identifies dad's portion; without a split, custody entities belong to him. */
export function custodyAmount(original: number, isCustody: boolean, allocations: OwnershipAllocation[]): number {
  if (allocations.length === 0) return isCustody ? original : 0;
  validateAllocations(original, allocations);
  return allocations.filter((a) => a.owner === "papa").reduce((sum, a) => sum + Number(a.amount), 0);
}

/** Historical shared movements before this date do not create a Moni settlement. */
export function isMoniSettlementDate(date: string): boolean {
  return date >= MONI_SETTLEMENT_START;
}
