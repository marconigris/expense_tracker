type Movement = { date: string; amount: string; kind: string; status: string; batchId: string | null };
type Snapshot = { date: string; value: string; notes: string | null };

/** A snapshot is never silently rolled forward: some assets lack transaction detail. */
export function recordedBalance(movements: Movement[], snapshots: Snapshot[]) {
  const snapshot = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (snapshot) return { value: Number(snapshot.value), date: snapshot.date, source: "snapshot" as const,
    notes: snapshot.notes, later: movements.some((m) => m.date > snapshot.date && m.batchId != null) };
  const openings = movements.filter((m) => m.kind === "opening" && m.status === "confirmed");
  if (!openings.length) return { value: null, date: null, source: "unknown" as const, notes: null, later: false };
  const from = openings.map((m) => m.date).sort()[0];
  const relevant = movements.filter((m) => m.date >= from && (m.batchId != null || m.status === "confirmed"));
  return { value: relevant.reduce((sum, m) => sum + Math.round(Number(m.amount) * 100), 0) / 100,
    date: relevant.map((m) => m.date).sort().at(-1) ?? from, source: "opening" as const, notes: null, later: false };
}
