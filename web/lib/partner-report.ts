import type { OwnershipAllocation } from "./allocations";

export type PartnerMonthlyInput = { date: string; area: string; amount: number; amountUsd: number | null; marcoShare: number; allocations: OwnershipAllocation[] };

/** Spending belonging to Moni, regardless of who paid; absent FX remains visible as a gap. */
export function partnerMonthly(rows: PartnerMonthlyInput[]) {
  const months = new Map<string, { month: string; total: number; areas: Record<string, number>; missingFx: number }>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const item = months.get(month) ?? { month, total: 0, areas: {}, missingFx: 0 };
    months.set(month, item);
    if (row.amount === 0) continue;
    if (row.amountUsd == null) { item.missingFx++; continue; }
    let ratio = row.area === "personal" || row.area === "negocio" ? 1 : 1 - row.marcoShare;
    if (row.allocations.length) {
      const amountCents = Math.round(row.amount * 100);
      const allocationCents = row.allocations.reduce((sum, a) => sum + Math.round(Number(a.amount) * 100), 0);
      if (amountCents !== allocationCents) { item.missingFx++; continue; }
      const moni = row.allocations.filter((a) => a.owner === "moni").reduce((sum, a) => sum + Number(a.amount), 0);
      ratio = moni / row.amount;
    }
    const value = -row.amountUsd * ratio;
    if (row.area !== "negocio") item.total += value;
    item.areas[row.area] = (item.areas[row.area] ?? 0) + value;
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}
