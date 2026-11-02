import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatMoney, formatMoneyInText } from "@/lib/format";
import { sharedReport } from "@/lib/shared-report";

export default function MoniPage() {
  return <Suspense fallback={<p className="text-muted">Calculando balance…</p>}><Content /></Suspense>;
}
function balance(cents: number, currency: string) {
  return `${cents > 0 ? "Moni te debe" : cents < 0 ? "Le debés a Moni" : "Están a mano"}${cents ? ` ${formatMoney(Math.abs(cents) / 100, currency)} ${currency}` : ""}`;
}
async function Content() {
  await connection(); await requireOwner();
  const data = await sharedReport();
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Balance con Moni</h1><p className="text-sm text-muted">Desde el 01/10/2026 · incluye saldos anteriores incorporados</p></div>
    <section className="hero rounded-2xl p-5"><p className="text-sm opacity-80">Balance por moneda</p>
      {data.totals.length ? data.totals.map((v) => <p key={v.currency} className="mt-2 text-xl font-semibold tabular-nums">{balance(v.cents, v.currency)}</p>) : <p className="mt-2 text-xl font-semibold">Están a mano</p>}
      <p className="mt-2 text-xs opacity-80">Incluye solo movimientos cargados. Si faltan gastos pagados por Moni, el saldo cambiará.</p>
      <p className="mt-1 text-xs opacity-80">Euros y dólares se mantienen separados. Otras monedas se convierten a USD con la cotización registrada para cada movimiento; ARS usa dólar MEP. USDc y USDT equivalen a USD.</p>
    </section>
    {data.pendingSinceCutoff > 0 && <Link href="/revisar" className="block rounded-xl border border-warn/40 bg-card p-3 text-sm">Saldo parcial: hay {data.pendingSinceCutoff} movimientos desde octubre sin revisar que podrían modificarlo →</Link>}
    {data.needsReview > 0 && <p className="rounded-xl border border-warn/40 bg-card p-3 text-sm">Hay {data.needsReview} movimientos compartidos que necesitan aclaración y no se incluyeron en el balance.</p>}
    <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Por espacio</h2>
      {data.entities.map((e) => <div key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0"><span>{e.name}</span><span className="text-right tabular-nums">{e.balances.length ? e.balances.map((v) => <span key={v.currency} className="block">{balance(v.cents, v.currency)}</span>) : <span className="text-muted">Sin saldo pendiente</span>}</span></div>)}
    </section>
    <section className="overflow-hidden rounded-xl border border-line bg-card"><h2 className="border-b border-line px-4 py-3 font-medium">Movimientos incluidos</h2>
      {data.details.length === 0 ? <p className="p-4 text-sm text-muted">No hay movimientos con saldo pendiente.</p> : <div className="divide-y divide-line">{data.details.map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm"><div><p>{formatMoneyInText(row.description)}</p><p className="text-xs text-muted">{row.date} · {row.entity} · {row.kind === "opening" ? "Saldo anterior" : row.kind === "settlement" ? "Liquidación" : `${row.amount < 0 ? "pagó" : "cobró"} ${row.paidBy === "marco" ? "Marco" : "Moni"}`} · {formatMoney(Math.abs(row.amount), row.originalCurrency)} {row.originalCurrency}</p>{(row.entityKind === "payable" || row.kind === "opening") && row.notes && <p className="mt-1 max-w-xl text-xs text-muted">{formatMoneyInText(row.notes)}</p>}</div><span className="text-right tabular-nums">{balance(row.cents, row.currency)}</span></div>)}</div>}
    </section>
  </div>;
}
