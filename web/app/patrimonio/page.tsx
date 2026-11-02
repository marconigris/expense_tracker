import { Suspense } from "react";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { wealthView } from "@/lib/wealth";
import type { WealthBucket } from "@/lib/wealth-math";

export default function PatrimonioPage() {
  return <Suspense fallback={<p className="text-muted">Cargando patrimonio…</p>}><Content /></Suspense>;
}

async function Content() {
  await connection();
  await requireOwner();
  const { items, otherAccounts, custody, properties, totals, missing } = await wealthView();
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Patrimonio</h1><p className="text-sm text-muted">Saldo bruto de tus cuentas y tu parte de las propiedades</p></div>
    <div className={`grid gap-4 ${totals.eur ? "md:grid-cols-2" : ""}`}>
      <Bubble currency="USD" bucket={totals.usd} />
      {totals.eur && <Bubble currency="EUR" bucket={totals.eur} />}
    </div>
    {(missing.length > 0 || totals.missingRates.length > 0) && <p className="rounded-xl border border-warn/40 bg-card p-3 text-sm text-muted">
      {missing.length > 0 && <>Sin saldo, no suman: {missing.map((a) => a.name).join(" · ")}. </>}
      {totals.missingRates.length > 0 && <>Sin cotización, no suman: {totals.missingRates.join(", ")}.</>}
    </p>}
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

const GROUPS = [
  { key: "cash", label: "Cash", tag: "Líquido", hint: "Bancos, money market, Cocos, cripto", tone: "bg-white" },
  { key: "stocks", label: "Stocks / Fondos", tag: "Inversión", hint: "IBKR", tone: "bg-white/55" },
  { key: "properties", label: "Propiedades", tag: "Ilíquido", hint: "Tu parte del capital aportado", tone: "bg-white/25" },
] as const;

function Bubble({ currency, bucket }: { currency: string; bucket: WealthBucket }) {
  // USD always shows the three groups so an empty one (e.g. IBKR without a balance) is visible.
  const groups = GROUPS.filter((g) => currency === "USD" || bucket[g.key] !== 0);
  const positive = groups.reduce((sum, g) => sum + Math.max(0, bucket[g.key]), 0);
  return <section className="hero rounded-2xl p-5">
    <p className="text-sm opacity-80">Patrimonio en {currency}</p>
    <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(bucket.total, currency)}</p>
    {positive > 0 && <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/10">
      {groups.map((g) => <div key={g.key} className={g.tone} style={{ width: `${(Math.max(0, bucket[g.key]) / positive) * 100}%` }} />)}
    </div>}
    <div className="mt-3 space-y-2">
      {groups.map((g) => <div key={g.key} className="flex items-start justify-between gap-3 text-sm">
        <span className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${g.tone}`} /><span><span className="flex items-center gap-2 font-medium">{g.label}<span className="rounded-full border border-white/30 px-1.5 text-[10px] font-normal uppercase tracking-wide opacity-80">{g.tag}</span></span><span className="block text-xs opacity-70">{g.hint}</span></span></span>
        <span className="tabular-nums">{formatMoney(bucket[g.key], currency)}</span>
      </div>)}
    </div>
    {bucket.converted.length > 0 && <p className="mt-3 text-xs opacity-70">Incluye {bucket.converted.map((c) => `${formatMoney(c.amount, c.currency)} ${c.currency}`).join(" · ")} pasados a USD a la cotización de hoy.</p>}
  </section>;
}
