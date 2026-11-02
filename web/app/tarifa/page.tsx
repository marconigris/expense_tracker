import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { tarifaReport } from "@/lib/tarifa-report";

export default function TarifaPage() {
  return <Suspense fallback={<p className="text-muted">Cargando gastos…</p>}><Content /></Suspense>;
}
async function Content() {
  await connection(); await requireOwner();
  const { rows, pending, totals } = await tarifaReport();
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Tarifa 2026</h1><p className="text-sm text-muted">Gastos de Europa · 10/08 al 30/09</p></div>
    <section className="hero rounded-2xl p-5"><p className="text-sm opacity-80">Gastos confirmados para Tricount</p>
      {totals.length ? totals.map((t) => <div key={`${t.paidBy}-${t.currency}`} className="mt-2"><p className="text-xl font-semibold tabular-nums">{formatMoney(t.cents / 100, t.currency)} {t.currency}</p><p className="text-xs opacity-80">Pagó {t.paidBy === "marco" ? "Marco" : "Moni"}</p></div>) : <p className="mt-2">Todavía no hay gastos confirmados.</p>}
      <p className="mt-3 text-xs opacity-80">Cargá cada gasto con su pagador y reparto. El saldo final depende también de los pagos de Moni y del redondeo de Tricount.</p>
    </section>
    {pending > 0 && <Link href="/revisar" className="block rounded-xl border border-warn/40 bg-card p-3 text-sm">Lista parcial: hay {pending} movimientos del período sin revisar; no todos necesariamente son compartidos →</Link>}
    <section className="overflow-hidden rounded-xl border border-line bg-card"><h2 className="border-b border-line px-4 py-3 font-medium">Detalle · {rows.length} movimientos</h2>
      <div className="divide-y divide-line">{rows.map((r) => <div key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm"><div><p>{r.description}</p><p className="text-xs text-muted">{r.date} · {r.category ?? "Otros"} · pagó {r.paidBy === "marco" ? "Marco" : "Moni"}{r.account ? ` · ${r.account}` : ""}</p><p className="text-xs text-muted">{r.shares.length ? r.shares.map((s) => `${s.owner === "moni" ? "Moni" : s.owner === "marco" ? "Marco" : "Otro"}: ${formatMoney(Math.abs(Number(s.amount)), r.currency)}`).join(" · ") : `Reparto: Marco ${Math.round(Number(r.marcoShare) * 100)}% / Moni ${Math.round((1 - Number(r.marcoShare)) * 100)}%`}</p></div><span className="text-right tabular-nums">{formatMoney(-Number(r.amount), r.currency)} {r.currency}</span></div>)}</div>
    </section>
  </div>;
}
