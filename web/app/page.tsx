import { requireOwner } from "@/lib/auth";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatMoney } from "@/lib/format";
import { custodyBalances, monthlySummary, pendingCount, propertyYields, receivableBalances, type Currency } from "@/lib/reports";

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="text-muted">Calculando…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

const MONTH = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();
  await requireOwner();
  const currency: Currency = (await searchParams).moneda === "EUR" ? "EUR" : "USD";
  const [months, custody, pending, properties, receivables] = await Promise.all([
    monthlySummary(currency),
    custodyBalances(),
    pendingCount(),
    propertyYields(),
    receivableBalances(currency),
  ]);

  const n = months.length;
  const avgIncome = months.reduce((a, m) => a + m.income, 0) / n;
  const avgSpending = months.reduce((a, m) => a + m.spending, 0) / n;
  const totals = (key: "bySource" | "bySpend") => {
    const acc: Record<string, number> = {};
    for (const m of months) for (const [k, v] of Object.entries(m[key])) acc[k] = (acc[k] ?? 0) + v;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  };
  const money = (v: number) => formatMoney(v, currency);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Últimos 12 meses</h1>
        <div className="flex overflow-hidden rounded-lg border border-line text-sm">
          {(["USD", "EUR"] as const).map((c) => (
            <Link key={c} href={c === "USD" ? "/" : "/?moneda=EUR"} className={`px-3 py-1 ${c === currency ? "bg-accent text-white" : "text-muted"}`}>
              {c}
            </Link>
          ))}
        </div>
      </div>

      <section className="hero rounded-2xl p-5">
        <p className="text-sm opacity-80">Te queda por mes, en promedio</p>
        <p className={`text-3xl font-semibold tabular-nums ${avgIncome - avgSpending < 0 ? "text-red-300" : ""}`}>
          {money(avgIncome - avgSpending)}
        </p>
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <p className="opacity-70">Entra</p>
            <p className="font-medium tabular-nums">{money(avgIncome)}/mes</p>
          </div>
          <div>
            <p className="opacity-70">Consumís</p>
            <p className="font-medium tabular-nums">{money(avgSpending)}/mes</p>
          </div>
        </div>
      </section>

      {pending > 0 && (
        <Link href="/revisar" className="block rounded-xl border border-warn/40 bg-card px-4 py-3 text-sm">
          <b>{pending}</b> movimientos sin revisar: los números de abajo todavía no los incluyen →
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="De dónde viene" rows={totals("bySource")} months={n} money={money} />
        <Breakdown title="En qué se va (tu parte)" rows={totals("bySpend")} months={n} money={money} />
      </div>

      <section className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-muted">
            <tr className="border-b border-line text-left">
              <th className="px-3 py-2 font-normal">Mes</th>
              <th className="px-3 py-2 text-right font-normal">Entra</th>
              <th className="px-3 py-2 text-right font-normal">Consumo</th>
              <th className="px-3 py-2 text-right font-normal">Queda</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">{MONTH.format(new Date(`${m.month}-01T00:00:00Z`))}</td>
                <td className="px-3 py-1.5 text-right">{money(m.income)}</td>
                <td className="px-3 py-1.5 text-right">{money(m.spending)}</td>
                <td className={`px-3 py-1.5 text-right ${m.income - m.spending < 0 ? "text-neg" : "text-pos"}`}>{money(m.income - m.spending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-card p-4 text-sm">
          <h2 className="mb-2 font-medium">Propiedades</h2>
          {properties.map((p) => (
            <div key={p.name} className="flex justify-between py-1">
              <span>
                {p.name} <span className="text-muted">({Math.round(p.share * 100)}%)</span>
              </span>
              <span className="tabular-nums">
                {formatMoney(p.stake, p.stakeCurrency)}
                <span className="text-muted"> · {p.yieldPct == null ? "—" : `${Math.round(p.yieldPct * 100)}%`} anual</span>
              </span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border border-line bg-card p-4 text-sm">
          <h2 className="mb-2 font-medium">Plata de papá que custodiás</h2>
          {custody.map((c) => (
            <div key={c.currency} className="flex justify-between py-1">
              <span className="text-muted">{c.currency}</span>
              <span className="tabular-nums">{formatMoney(Number(c.balance), c.currency)}</span>
            </div>
          ))}
        </section>
        {receivables.length > 0 && (
          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 font-medium">Adelantos por conciliar</h2>
            {receivables.map((r) => (
              <div key={r.person} className="flex justify-between py-1">
                <span className="text-muted">{r.person}</span>
                <span className="tabular-nums">≈ {formatMoney(r.balance, currency)}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Breakdown({ title, rows, months, money }: { title: string; rows: [string, number][]; months: number; money: (v: number) => string }) {
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <section className="rounded-xl border border-line bg-card p-4 text-sm">
      <h2 className="mb-2 font-medium">{title}</h2>
      {rows.length === 0 && <p className="text-muted">Sin movimientos confirmados todavía.</p>}
      {rows.map(([name, total]) => (
        <div key={name} className="py-1">
          <div className="flex justify-between">
            <span>{name}</span>
            <span className="tabular-nums">
              {money(total / months)}/mes <span className="text-muted">· {money(total)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded bg-line">
            <div className="h-1.5 rounded bg-accent" style={{ width: `${(Math.abs(total) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}
