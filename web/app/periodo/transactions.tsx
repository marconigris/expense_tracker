"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatMoneyInText } from "@/lib/format";

type Row = {
  id: string; date: string; description: string; amount: number; currency: string; amountUsd: number | null;
  account: string; entity: string | null; entityKind: string | null; sharedWithMoni: boolean; marcoShare: number | null;
  category: string | null; kind: string; status: string; paidBy: string; notes: string | null;
  allocations: { owner: string; amount: number }[];
};

const kindLabels: Record<string, string> = { normal: "Movimiento", transfer: "Transferencia", settlement: "Liquidación", opening: "Saldo inicial", excluded: "Excluido", receivable: "Adelanto o reembolso" };
const statusLabels: Record<string, string> = { confirmed: "Confirmado", pending: "Sin revisar", suggested: "Sugerido" };
const ownerLabels: Record<string, string> = { marco: "Marco", moni: "Moni", papa: "Papá", other: "Otra persona" };

export function PeriodTransactions({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState("all");
  const [account, setAccount] = useState("all");
  const [query, setQuery] = useState("");
  const accounts = useMemo(() => [...new Set(rows.map((r) => r.account))].sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const visible = useMemo(() => rows.filter((r) => {
    if (account !== "all" && r.account !== account) return false;
    if (filter === "personal" && r.entityKind !== "personal") return false;
    if (filter === "shared" && !r.sharedWithMoni && !r.allocations.some((a) => a.owner === "moni")) return false;
    if (filter === "pending" && r.status === "confirmed") return false;
    if (filter === "transfers" && r.kind !== "transfer") return false;
    const text = [r.description, r.account, r.entity, r.category, r.currency, r.notes, r.date].join(" ").toLocaleLowerCase("es");
    return text.includes(query.trim().toLocaleLowerCase("es"));
  }), [rows, account, filter, query]);
  const input = "rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg";
  return <div className="space-y-5">
    <div><h1 className="text-lg font-semibold">Todos los movimientos</h1><p className="text-sm text-muted">Del 10/08 al 30/09/2026 · todas las cuentas cargadas</p></div>
    <section className="hero rounded-2xl p-5"><p className="font-medium">Revisión con Moni</p><p className="mt-1 text-sm opacity-80">Incluye gastos, ingresos, transferencias y movimientos excluidos. Buscá los que puedan corresponderle a Moni.</p></section>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="grid gap-1 text-xs text-muted">Buscar<input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Comercio, fecha o nota" /></label>
      <label className="grid gap-1 text-xs text-muted">Mostrar<select className={input} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos</option><option value="personal">Personal</option><option value="shared">Compartidos o con Moni</option><option value="pending">Sin confirmar</option><option value="transfers">Transferencias</option></select></label>
      <label className="grid gap-1 text-xs text-muted">Cuenta<select className={input} value={account} onChange={(e) => setAccount(e.target.value)}><option value="all">Todas</option>{accounts.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    <section className="overflow-hidden rounded-xl border border-line bg-card"><h2 className="border-b border-line px-4 py-3 font-medium">{visible.length} de {rows.length} movimientos</h2>
      {visible.length === 0 ? <p className="p-4 text-sm text-muted">No hay movimientos para esos filtros.</p> : <div className="divide-y divide-line">{visible.map((r) => <details key={r.id} className="group px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none flex-wrap justify-between gap-2"><span className="min-w-0"><span className="block font-medium">{formatMoneyInText(r.description)}</span><span className="text-xs text-muted">{r.date} · {r.account} · {r.entity ?? "Sin entidad"} · {statusLabels[r.status] ?? r.status}</span></span><span className="text-right tabular-nums">{formatMoney(r.amount, r.currency)} {r.currency}<span className="block text-xs text-muted">Ver detalle</span></span></summary>
        <div className="mt-3 space-y-1 text-xs text-muted"><p>{kindLabels[r.kind] ?? r.kind} · {r.category ?? "Sin categoría"} · {r.amount < 0 ? "Pagó" : "Cobró"} {r.paidBy === "moni" ? "Moni" : "Marco"}</p>
          {r.allocations.length > 0 ? <p>Reparto: {r.allocations.map((a) => `${ownerLabels[a.owner] ?? a.owner} ${formatMoney(Math.abs(a.amount), r.currency)}`).join(" · ")}</p> : r.entityKind === "household" && r.marcoShare != null ? <p>Reparto: Marco {Math.round(r.marcoShare * 100)}% · Moni {Math.round((1 - r.marcoShare) * 100)}%</p> : null}
          {r.amountUsd != null && r.currency !== "USD" && <p>Equivalente: {formatMoney(r.amountUsd, "USD")} USD</p>}{r.notes && <p>{formatMoneyInText(r.notes)}</p>}
        </div>
      </details>)}</div>}
    </section>
  </div>;
}
