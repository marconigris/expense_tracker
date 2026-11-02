import { Suspense } from "react";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { wealthView } from "@/lib/wealth";

export default function PatrimonioPage() {
  return <Suspense fallback={<p className="text-muted">Cargando patrimonio…</p>}><Content /></Suspense>;
}

async function Content() {
  await connection();
  await requireOwner();
  const { items, otherAccounts, custody, properties } = await wealthView();
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Patrimonio</h1><p className="text-sm text-muted">Saldos brutos registrados por cuenta</p></div>
    <section className="hero rounded-2xl p-5">
      <p className="font-semibold">Todavía falta completar saldos</p>
      <p className="mt-1 text-sm opacity-80">Las cuentas pueden incluir dinero de tu papá u otras personas. Para calcular tu patrimonio neto falta conciliar saldos y titularidad.</p>
    </section>
    <section className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3 font-medium">Cuentas y fondos</div>
      <div className="divide-y divide-line">
        {items.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
          <div className="min-w-0"><div className="font-medium">{item.name}</div>
            <div className="text-xs text-muted">{item.value == null ? "Falta saldo inicial o valor actual" : `${item.source === "snapshot" ? "Valor registrado" : "Calculado desde saldo inicial"} · ${item.date}`}{item.later ? " · hay movimientos posteriores" : ""}</div>
            {item.notes && <p className="mt-1 max-w-2xl text-xs text-muted">{item.notes}</p>}
          </div>
          <div className="text-right tabular-nums">{item.value == null ? "—" : <>{formatMoney(item.value, item.currency)} <span className="text-xs text-muted">{item.currency}</span></>}</div>
        </div>)}
      </div>
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Propiedades · tu parte</h2>
        {properties.map((p) => <div key={p.name} className="flex justify-between py-1"><span>{p.name} <span className="text-muted">({Math.round(p.share * 100)}%)</span></span><span className="tabular-nums">{formatMoney(p.stake, p.stakeCurrency)} {p.stakeCurrency}</span></div>)}
      </section>
      <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Plata de papá que administrás</h2>
        {custody.map((c) => <div key={c.currency} className="flex justify-between py-1"><span>{c.currency}</span><span className="tabular-nums">{formatMoney(Number(c.balance), c.currency)}</span></div>)}
        <p className="mt-2 text-xs text-muted">Es su dinero y no forma parte de tu patrimonio. El reparto por cuenta todavía está incompleto.</p>
      </section>
    </div>
    {otherAccounts.length > 0 && <details className="rounded-xl border border-line bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">Otras cuentas sin saldo ({otherAccounts.length})</summary><p className="mt-2 text-muted">{otherAccounts.map((a) => a.name).join(" · ")}</p></details>}
  </div>;
}
