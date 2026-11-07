export type VehicleTerms = { acquired: string; priceCents: number; share: number; annualRate: number };

function monthNumber(month: string) {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error("Invalid month");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

/** Straight-line depreciation, on Marco's acquisition cost; all amounts are integer cents. */
export function vehicleValue(vehicle: VehicleTerms, month: string) {
  const elapsed = monthNumber(month) - monthNumber(vehicle.acquired);
  if (elapsed < 0) return { cost: 0, depreciation: 0, value: 0 };
  const cost = Math.round(vehicle.priceCents * vehicle.share);
  const annual = cost * vehicle.annualRate;
  const before = Math.min(cost, Math.round(annual * elapsed / 12));
  const after = Math.min(cost, Math.round(annual * (elapsed + 1) / 12));
  return { cost, depreciation: after - before, value: cost - after };
}
