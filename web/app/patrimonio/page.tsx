import { Suspense } from "react";
import { VehicleForm } from "./vehicle-form";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { wealthHistory, wealthTimeline, wealthView } from "@/lib/wealth";
import { groupAccounts, type WealthBucket, type WealthLine } from "@/lib/wealth-math";
import { WealthChart } from "./wealth-chart";

export default function PatrimonioPage() {
  return <Suspense fallback={<p className="text-muted">Cargando patrimonio…</p>}><Content /></Suspense>;
}

async function Content() {
  await connection();
  await requireOwner();
  const view = await wealthView();
  const { items, otherAccounts, cash, placement, properties, totals, missing, rates, vehicles, purchases } = view;
  // Past months are rebuilt from movements; the current month is today's live figure.
  const [saved, timeline] = await Promise.all([wealthHistory(totals), wealthTimeline(view)]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const history = [...timeline.points, ...saved.filter((h) => h.month === thisMonth)];
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Patrimonio</h1><p className="text-sm text-muted">Solo tu plata: cuentas y tu parte de las propiedades</p></div>
    <div className={`grid gap-4 ${totals.eur ? "md:grid-cols-2" : ""}`}>
      <Bubble currency="USD" bucket={totals.usd} />
      {totals.eur && <Bubble currency="EUR" bucket={totals.eur} />}
    </div>
    {(missing.length > 0 || totals.missingRates.length > 0) && <p className="rounded-xl border border-warn/40 bg-card p-3 text-sm text-muted">
      {missing.length > 0 && <>Sin saldo, no suman: {missing.map((a) => a.name).join(" · ")}. </>}
      {totals.missingRates.length > 0 && <>Sin cotización, no suman: {totals.missingRates.join(", ")}.</>}
    </p>}
    <div className={`grid gap-4 ${totals.eur ? "md:grid-cols-2" : ""}`}>
      {["USD", "EUR"].map((currency) => {
        const points = history.filter((h) => h.currency === currency);
        return points.length > 0 && <WealthChart key={currency} currency={currency} points={points} />;
      })}
    </div>
    {timeline.assumed.length > 0 && <p className="-mt-2 text-xs text-muted">Meses anteriores reconstruidos desde los movimientos importados. Sin movimientos, se toman con el saldo de hoy: {timeline.assumed.join(" · ")}.</p>}
    <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="font-medium">Autos · tu parte</h2>{vehicles.length ? vehicles.map((v) => <p className="mt-2" key={v.id}>{v.name} · {Math.round(Number(v.share) * 100)}% · {Number(v.annualRate) * 100}% anual · desde {v.acquired.slice(0, 7)}</p>) : <p className="mt-2 text-muted">Todavía no hay autos cargados.</p>}</section>
    <VehicleForm purchases={purchases.map((p) => ({ id: p.id, label: `${p.date} · ${p.description} · ${formatMoney(Math.abs(Number(p.amount)), p.currency)} ${p.currency}` }))} />
    <h2 className="pt-1 font-medium">Cuentas y fondos</h2>
    {groupAccounts(items).map((group) => <details key={group.region} className="group overflow-hidden rounded-xl border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{group.region} <span className="text-sm font-normal text-muted">({group.banks.reduce((n, b) => n + b.accounts.length, 0)})</span></span>
        <span className="flex items-center gap-2 text-sm tabular-nums"><GroupTotal accounts={group.banks.flatMap((b) => b.accounts)} rates={rates} /><span className="text-muted transition-transform group-open:rotate-180">▾</span></span>
      </summary>
      {group.banks.map(({ bank, accounts }) => <div key={bank}>
        {bank !== group.region && <div className="bg-bg/40 px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{bank}</div>}
        <div className="divide-y divide-line">
          {accounts.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{item.name}</div>
              <div className="text-xs text-muted">{item.value == null ? "Falta saldo inicial o valor actual" : `${item.source === "snapshot" ? "Valor registrado" : "Calculado desde saldo inicial"} · ${item.date}`}{item.later ? " · hay movimientos posteriores" : ""}</div>
              {item.dad > 0 && <p className="mt-1 text-xs text-muted">Saldo total {formatMoney(item.gross ?? 0, item.currency)} · {formatMoney(item.dad, item.currency)} de papá en custodia</p>}
              {item.notes && <p className="mt-1 max-w-2xl text-xs text-muted">{item.notes}</p>}
            </div>
            <div className="text-right tabular-nums">{item.value == null ? "—" : <>{formatMoney(item.value, item.currency)} <span className="text-xs text-muted">{item.currency}</span></>}</div>
          </div>)}
        </div>
      </div>)}
    </details>)}
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Propiedades · tu parte</h2>
        {properties.map((p) => <div key={p.name} className="flex justify-between py-1"><span>{p.name} <span className="text-muted">({Math.round(p.share * 100)}%)</span></span><span className="tabular-nums">{formatMoney(p.stake, p.stakeCurrency)} {p.stakeCurrency}</span></div>)}
      </section>
      <section className="rounded-xl border border-line bg-card p-4 text-sm"><h2 className="mb-2 font-medium">Custodia de papá</h2>
        {placement.map((p) => <div key={p.currency} className="border-b border-line py-2 last:border-0">
          <div className="flex justify-between font-medium"><span>Banco {p.currency}</span><span className="tabular-nums">{formatMoney(p.total, p.currency)}</span></div>
          {p.held.map((h) => <div key={h.accountId} className="flex justify-between pl-3 text-xs text-muted"><span>{h.name}</span><span className="tabular-nums">{formatMoney(h.value, p.currency)}</span></div>)}
          {p.unplaced !== 0 && <div className="flex justify-between pl-3 text-xs text-warn"><span>Sin ubicar en una cuenta</span><span className="tabular-nums">{formatMoney(p.unplaced, p.currency)}</span></div>}
        </div>)}
        {cash.map((c) => <div key={c.currency} className="flex justify-between py-2"><span>Efectivo {c.currency} <span className="text-xs text-muted">· le debés, se resta arriba</span></span><span className="tabular-nums">{formatMoney(c.balance, c.currency)}</span></div>)}
        <p className="mt-2 text-xs text-muted">La plata de banco no figura en tus cuentas ni en tu patrimonio.{placement.some((p) => p.unplaced) ? " Lo que está sin ubicar se resta arriba hasta que se asigne a una cuenta." : ""}</p>
      </section>
    </div>
    {otherAccounts.length > 0 && <details className="rounded-xl border border-line bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">Otras cuentas sin saldo ({otherAccounts.length})</summary><p className="mt-2 text-muted">{otherAccounts.map((a) => a.name).join(" · ")}</p></details>}
  </div>;
}

const GROUPS = [
  { key: "cash", label: "Banco / Cash", tag: "Líquido", hint: "Bancos, money market, Cocos", tone: "bg-white" },
  { key: "stocks", label: "Stocks / Fondos / Crypto", tag: "Inversión", hint: "IBKR, Binance, Crypto.com", tone: "bg-white/55" },
  { key: "loans", label: "Préstamos a cobrar", tag: "Ilíquido", hint: "Bora Vida; se cobra cuando la empresa pague", tone: "bg-white/40" },
  { key: "properties", label: "Propiedades", tag: "Ilíquido", hint: "Tu parte del capital aportado", tone: "bg-white/25" },
  { key: "vehicles", label: "Autos", tag: "Ilíquido", hint: "Tu parte, con amortización", tone: "bg-white/20" },
] as const;

const tagClass = "rounded-full border border-white/30 px-1.5 text-[10px] font-normal uppercase tracking-wide opacity-80";

/** A bubble line that opens to show the accounts (or properties) behind its amount. */
function Line({ label, tag, hint, tone, amount, currency, lines, negative = false }: {
  label: string; tag: string; hint: string; tone?: string; amount: number; currency: string; lines: WealthLine[]; negative?: boolean;
}) {
  const sign = negative ? "−" : "";
  return <details className="group text-sm">
    <summary className={`flex items-start justify-between gap-3 [&::-webkit-details-marker]:hidden ${lines.length ? "cursor-pointer" : "pointer-events-none"} list-none`}>
      <span className="flex items-start gap-2">{tone && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} />}<span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">{label}<span className={tagClass}>{tag}</span></span>
        <span className="block text-xs opacity-70">{hint}</span>
      </span></span>
      <span className="flex items-center gap-1.5 tabular-nums">{sign}{formatMoney(amount, currency)}{lines.length > 0 && <span className="text-xs opacity-60 transition-transform group-open:rotate-180">▾</span>}</span>
    </summary>
    <ul className={`mt-2 space-y-1 rounded-lg bg-white/10 px-3 py-2 text-xs ${tone ? "ml-4" : ""}`}>
      {lines.map((l) => <li key={l.name} className="flex justify-between gap-3">
        <span className="min-w-0">{l.name}{l.original && <span className="block opacity-60">{formatMoney(l.original.amount, l.original.currency)} {l.original.currency}</span>}</span>
        <span className="tabular-nums">{sign}{formatMoney(l.amount, currency)}</span>
      </li>)}
    </ul>
  </details>;
}

function Bubble({ currency, bucket }: { currency: string; bucket: WealthBucket }) {
  // USD always shows the three groups so an empty one (e.g. IBKR without a balance) is visible.
  const groups = GROUPS.filter((g) => (currency === "USD" && g.key !== "loans") || bucket[g.key] !== 0);
  const positive = groups.reduce((sum, g) => sum + Math.max(0, bucket[g.key]), 0);
  return <section className="hero rounded-2xl p-5">
    <p className="text-sm opacity-80">Patrimonio en {currency}</p>
    <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(bucket.total, currency)}</p>
    {positive > 0 && <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/10">
      {groups.map((g) => <div key={g.key} className={g.tone} style={{ width: `${(Math.max(0, bucket[g.key]) / positive) * 100}%` }} />)}
    </div>}
    <div className="mt-3 space-y-2">
      {groups.map((g) => <Line key={g.key} label={g.label} tag={g.tag} hint={g.hint} tone={g.tone} amount={bucket[g.key]} currency={currency} lines={bucket.lines[g.key]} />)}
    </div>
    {bucket.custody !== 0 && <div className="mt-2 border-t border-white/15 pt-2">
      <Line label="Le debés a papá" tag="Deuda" hint="Efectivo que le tenés que devolver" amount={bucket.custody} currency={currency} lines={bucket.lines.custody} negative />
    </div>}
    {bucket.converted.length > 0 && <p className="mt-3 text-xs opacity-70">Los montos en otras monedas se pasan a USD a la cotización de hoy. Tocá una línea para ver el detalle.</p>}
    {bucket.converted.length === 0 && <p className="mt-3 text-xs opacity-70">Tocá una línea para ver el detalle.</p>}
  </section>;
}

/** EUR stays in EUR and every other currency is summed in USD, like the bubbles; both show when both exist. */
function GroupTotal({ accounts, rates }: { accounts: { currency: string; value: number | null }[]; rates: Record<string, number | null> }) {
  const eur = accounts.filter((a) => a.currency === "EUR").reduce((sum, a) => sum + (a.value ?? 0), 0);
  const others = accounts.filter((a) => a.currency !== "EUR" && a.value);
  const rate = (c: string) => (c === "USD" ? 1 : rates[c]);
  const usd = others.reduce((sum, a) => sum + (a.value ?? 0) * (rate(a.currency) ?? 0), 0);
  const parts = [eur ? formatMoney(eur, "EUR") : null, others.length ? formatMoney(usd, "USD") : null].filter(Boolean);
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}
