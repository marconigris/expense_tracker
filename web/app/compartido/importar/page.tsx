import { Suspense } from "react";
import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requirePartner } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { PARTNER_AREAS } from "@/lib/partner-input";
import { CsvImport, ImportInbox, type InboxRow } from "../components";

export default function PartnerImportPage() {
  return <Suspense fallback={<p className="text-muted">Cargando…</p>}><Content /></Suspense>;
}
async function Content() {
  await connection(); const user = await requirePartner();
  const [rows, previous] = await Promise.all([
    db.select().from(t.partnerImportRows).where(eq(t.partnerImportRows.userId, user.id))
      .orderBy(asc(t.partnerImportRows.date), asc(t.partnerImportRows.description), asc(t.partnerImportRows.occurrence)),
    db.select({ description: t.partnerExpenses.description, area: t.partnerExpenses.area }).from(t.partnerExpenses)
      .where(eq(t.partnerExpenses.userId, user.id)),
  ]);
  // Suggest an area only when every earlier expense with the same description went to the same one.
  const areas = new Map<string, Set<string>>();
  for (const item of previous) {
    if (!Object.hasOwn(PARTNER_AREAS, item.area)) continue;
    const key = item.description.trim().toLocaleLowerCase("es");
    areas.set(key, (areas.get(key) ?? new Set<string>()).add(item.area));
  }
  const inbox: InboxRow[] = rows.map((r) => {
    const known = areas.get(r.description.trim().toLocaleLowerCase("es"));
    return { id: r.id, date: r.date, description: r.description, amount: Number(r.amount), currency: r.currency, source: r.source,
      discarded: r.status === "discarded", suggestedArea: known?.size === 1 ? [...known][0] : undefined };
  });
  return <div className="space-y-5">
    <ImportInbox rows={inbox} />
    <CsvImport hasPending={inbox.some((r) => !r.discarded)} />
  </div>;
}
