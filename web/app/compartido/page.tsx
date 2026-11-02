import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { requirePartner } from "@/lib/auth";
import type { OwnershipAllocation } from "@/lib/allocations";
import { MONI_SETTLEMENT_START } from "@/lib/catalog";
import { db, t } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { partnerMonthly } from "@/lib/partner-report";
import { sharedReport } from "@/lib/shared-report";
import { deleteOwnExpense } from "./actions";

const LABELS: Record<string, string> = { brasil: "Brasil", cabarete: "Cabarete", europa: "Europa", personal: "Personal", negocio: "Negocio" };
const SLUGS: Record<string, string> = { "hogar-brasil": "brasil", "hogar-cabarete": "cabarete", "hogar-europa": "europa", "la-mariposa": "cabarete" };
const MONTH = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

export default function PartnerHome() {
  return <Suspense fallback={<p className="text-muted">Cargando balance…</p>}><Content /></Suspense>;
}
function balance(cents: number, currency: string) {
  return `${cents > 0 ? "Le debés a Marco" : cents < 0 ? "Marco te debe" : "Están a mano"}${cents ? ` ${formatMoney(Math.abs(cents) / 100, currency)} ${currency}` : ""}`;
}
async function Content() {
  await connection(); const user = await requirePartner();
  const [data, own, privateRows, shared] = await Promise.all([
    sharedReport(),
    db.select().from(t.partnerExpenses).where(eq(t.partnerExpenses.userId, user.id)).orderBy(desc(t.partnerExpenses.date), desc(t.partnerExpenses.createdAt)).limit(100),
    db.select().from(t.partnerExpenses).where(and(eq(t.partnerExpenses.userId, user.id), inArray(t.partnerExpenses.area, ["personal", "negocio"]), isNull(t.partnerExpenses.transactionId))),
    db.select({ id: t.transactions.id, date: t.transactions.date, amount: t.transactions.amount, amountUsd: t.transactions.amountUsd,
      slug: t.entities.slug, marcoShare: t.entities.marcoShare }).from(t.transactions).innerJoin(t.entities, eq(t.transactions.entityId, t.entities.id))
      .where(and(eq(t.transactions.status, "confirmed"), eq(t.transactions.kind, "normal"),
        eq(t.entities.sharedWithMoni, true), inArray(t.entities.slug, Object.keys(SLUGS)), gte(t.transactions.date, MONI_SETTLEMENT_START),
        or(eq(t.entities.kind, "household"), and(eq(t.entities.slug, "la-mariposa"), lt(t.transactions.amount, "0"), inArray(t.transactions.category, ["Mantenimiento", "Impuestos", "Otros"]))))),
  ]);
  const allocs = shared.length ? await db.select().from(t.transactionAllocations).where(inArray(t.transactionAllocations.transactionId, shared.map((r) => r.id))) : [];
  const allocationMap = new Map<string, OwnershipAllocation[]>();
  for (const a of allocs) allocationMap.set(a.transactionId, [...(allocationMap.get(a.transactionId) ?? []), { owner: a.owner, amount: a.amount }]);
  const months = partnerMonthly([
    ...privateRows.map((r) => ({ date: r.date, area: r.area, amount: Number(r.amount), amountUsd: Number(r.amountUsd), marcoShare: 0, allocations: [] })),
    ...shared.map((r) => ({ date: r.date, area: SLUGS[r.slug], amount: Number(r.amount), amountUsd: r.amountUsd == null ? null : Number(r.amountUsd),
      marcoShare: Number(r.marcoShare), allocations: allocationMap.get(r.id) ?? [] })),
  ]);
  return <div className="space-y-5"><div><h1 className="text-lg font-semibold">Hola, Moni</h1><p className="text-sm text-muted">Tus gastos y tu balance con Marco</p></div>
    <section className="hero rounded-2xl p-5"><p className="text-sm opacity-80">Balance con Marco</p>{data.totals.length ? data.totals.map((v) => <p key={v.currency} className="mt-2 text-xl font-semibold tabular-nums">{balance(v.cents, v.currency)}</p>) : <p className="mt-2 text-xl font-semibold">Están a mano</p>}<p className="mt-2 text-xs opacity-80">Desde octubre de 2026, con los saldos anteriores incorporados.</p></section>
    {data.needsReview > 0 && <p className="rounded-xl border border-warn/40 bg-card p-3 text-sm">Hay movimientos compartidos que necesitan revisión antes de incluirse.</p>}
    <div className="grid grid-cols-2 gap-3"><Link href="/compartido/cargar" className="rounded-xl bg-accent p-4 text-center text-sm font-medium text-white">Cargar gasto</Link><Link href="/compartido/importar" className="rounded-xl border border-line bg-card p-4 text-center text-sm font-medium">Importar CSV</Link></div>
    <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="font-medium">Tus gastos por mes</h2><p className="mt-1 text-xs text-muted">En USD · personales y tu parte de los compartidos desde octubre. Negocio se muestra aparte.</p>{months.length ? months.map((m) => <div key={m.month} className="border-b border-line py-3 last:border-0"><div className="flex justify-between gap-2"><span className="capitalize">{MONTH.format(new Date(`${m.month}-01T00:00:00Z`))}</span><span className="font-medium tabular-nums">{formatMoney(m.total, "USD")}</span></div><p className="mt-1 text-xs text-muted">{Object.entries(m.areas).filter(([, v]) => v !== 0).map(([area, value]) => `${LABELS[area] ?? area}: ${formatMoney(value, "USD")}`).join(" · ")}</p>{m.missingFx > 0 && <p className="mt-1 text-xs text-neg">Hay movimientos sin cotización o con reparto pendiente.</p>}</div>) : <p className="mt-3 text-muted">Todavía no hay gastos.</p>}</section>
    <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Balance por espacio</h2>{data.entities.map((e) => <div key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0"><span>{e.name}</span><span className="text-right tabular-nums">{e.balances.length ? e.balances.map((v) => <span key={v.currency} className="block">{balance(v.cents, v.currency)}</span>) : <span className="text-muted">Sin saldo pendiente</span>}</span></div>)}</section>
    <details className="rounded-xl border border-line bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">Ver movimientos del balance</summary><div className="mt-3 divide-y divide-line">{data.details.map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 py-3"><span><span className="block">{row.description}</span><span className="text-xs text-muted">{row.date} · {row.entity}</span></span><span className="text-right tabular-nums">{balance(row.cents, row.currency)}</span></div>)}</div></details>
    <section className="overflow-hidden rounded-xl border border-line bg-card"><h2 className="border-b border-line px-4 py-3 font-medium">Tus últimos gastos cargados</h2>{own.length ? <div className="divide-y divide-line">{own.map((row) => <div key={row.id} className="flex items-start justify-between gap-3 p-4 text-sm"><div><p>{row.description}</p><p className="text-xs text-muted">{row.date} · {LABELS[row.area] ?? row.area}</p></div><div className="text-right"><p className="tabular-nums">{formatMoney(Math.abs(Number(row.amount)), row.currency)} {row.currency}</p><form action={deleteOwnExpense}><input type="hidden" name="id" value={row.id} /><button className="mt-1 text-xs text-neg">Eliminar</button></form></div></div>)}</div> : <p className="p-4 text-sm text-muted">Todavía no cargaste gastos.</p>}</section>
  </div>;
}
