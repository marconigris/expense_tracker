"use client";

import { useActionState, useState, useTransition } from "react";
import { addManualExpense, savePartnerRows, setPartnerRowsDiscarded, uploadPartnerCsv, type PartnerResult } from "./actions";
import { formatMoney } from "@/lib/format";
import { PARTNER_AREA_LABELS, PRIVATE_PARTNER_AREAS } from "@/lib/partner-areas";

const input = "block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
const areaLabels = PARTNER_AREA_LABELS;
const areaOptions = Object.entries(areaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>);

function ExpenseFields() {
  const [area, setArea] = useState("brasil");
  return <div className="space-y-3">
    <label className="block text-sm"><span className="text-muted">Categoría</span><select name="area" value={area} onChange={(e) => setArea(e.target.value)} className={input}>{areaOptions}</select></label>
    {PRIVATE_PARTNER_AREAS.includes(area) ? <><input type="hidden" name="percent" value="50" /><p className="text-xs text-muted">Solo aparece en tu vista y no cambia el balance con Marco.</p></> : <label className="block text-sm"><span className="text-muted">Reparto</span><select name="percent" defaultValue="50" className={input}><option value="50">Mitad cada uno</option><option value="100">100% Marco</option><option value="0">100% Moni</option></select></label>}
  </div>;
}

export function ManualExpense({ today, initialRequestId }: { today: string; initialRequestId: string }) {
  const [result, action, pending] = useActionState(addManualExpense, null);
  const requestId = result?.requestId ?? initialRequestId;
  return <div className="space-y-4"><div><h1 className="text-lg font-semibold">Cargar gasto</h1><p className="text-sm text-muted">Pagaste vos</p></div>
    <form key={requestId} action={action} className="space-y-3 rounded-xl border border-line bg-card p-4">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block text-sm"><span className="text-muted">Descripción</span><input name="description" maxLength={250} required className={input} placeholder="Ej. supermercado" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm"><span className="text-muted">Monto</span><input name="amount" inputMode="decimal" required className={input} placeholder="0" /></label><label className="text-sm"><span className="text-muted">Moneda</span><select name="currency" defaultValue="BRL" className={input}><option value="BRL">BRL</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="ARS">ARS</option></select></label></div>
      <label className="block text-sm"><span className="text-muted">Fecha</span><input name="date" type="date" defaultValue={today} required className={input} /></label>
      <ExpenseFields />
      <button disabled={pending} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar gasto"}</button>
      {result && <p role="status" className={`text-sm ${result.ok ? "text-pos" : "text-neg"}`}>{result.message}</p>}
    </form>
  </div>;
}


export type InboxRow = { id: string; date: string; description: string; amount: number; currency: string; source: string; discarded: boolean; suggestedArea?: string };

export function ImportInbox({ rows }: { rows: InboxRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Row id -> the state it had when acted on; it reappears once the server returns it in a new state.
  const [hidden, setHidden] = useState<Map<string, boolean>>(() => new Map());
  const [area, setArea] = useState("brasil");
  const [percent, setPercent] = useState(50);
  const [result, setResult] = useState<PartnerResult | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = rows.filter((r) => hidden.get(r.id) !== r.discarded);
  const open = visible.filter((r) => !r.discarded);
  const discarded = visible.filter((r) => r.discarded);
  const chosen = open.filter((r) => selected.has(r.id)).map((r) => r.id);

  // Rows leave the list right away; the server refresh confirms it, or the error brings them back.
  function run(ids: string[], action: () => Promise<PartnerResult>) {
    const states = new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.discarded]));
    setHidden((h) => new Map([...h, ...states]));
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    startTransition(async () => {
      const res = await action();
      setResult(res);
      if (!res.ok) setHidden((h) => new Map([...h].filter(([id]) => !ids.includes(id))));
    });
  }
  function toggle(id: string) {
    setSelected((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next; });
  }

  if (!open.length && !discarded.length) return result ? <p role="status" className={`text-sm ${result.ok ? "text-pos" : "text-neg"}`}>{result.message}</p> : null;

  return <section className="space-y-3">
    <div className="flex items-end justify-between gap-3">
      <div><h1 className="text-lg font-semibold">Por revisar ({open.length})</h1><p className="text-sm text-muted">Marcá los que son de la misma categoría y guardalos. Lo que no marques queda acá para después.</p></div>
      {open.length > 0 && <button type="button" onClick={() => setSelected(chosen.length === open.length ? new Set() : new Set(open.map((r) => r.id)))} className="shrink-0 text-sm text-accent">{chosen.length === open.length ? "Ninguno" : "Todos"}</button>}
    </div>
    {result && <p role="status" className={`text-sm ${result.ok ? "text-pos" : "text-neg"}`}>{result.message}</p>}
    {open.length > 0 && <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
      {open.map((row) => <li key={row.id} className={`flex items-start gap-3 p-3 text-sm ${selected.has(row.id) ? "bg-active" : ""}`}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
          <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="mt-1 h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block break-words">{row.description}</span>
            <span className="text-xs text-muted">{row.date} · {row.source}{row.suggestedArea && areaLabels[row.suggestedArea] ? ` · Antes: ${areaLabels[row.suggestedArea]}` : ""}</span>
          </span>
        </label>
        <div className="shrink-0 text-right">
          <p className="whitespace-nowrap tabular-nums">{formatMoney(row.amount, row.currency)} {row.currency}</p>
          <button type="button" onClick={() => run([row.id], () => setPartnerRowsDiscarded([row.id], true))} className="mt-1 py-1 text-xs text-muted" aria-label={`Descartar ${row.description}`}>Descartar</button>
        </div>
      </li>)}
    </ul>}
    {discarded.length > 0 && <details className="rounded-xl border border-line bg-card p-3 text-sm">
      <summary className="cursor-pointer text-muted">Descartados ({discarded.length})</summary>
      <ul className="mt-2 divide-y divide-line">{discarded.map((row) => <li key={row.id} className="flex items-start justify-between gap-3 py-2">
        <span className="min-w-0"><span className="block break-words">{row.description}</span><span className="text-xs text-muted">{row.date} · {formatMoney(row.amount, row.currency)} {row.currency}</span></span>
        <button type="button" onClick={() => run([row.id], () => setPartnerRowsDiscarded([row.id], false))} className="shrink-0 py-1 text-xs text-accent">Recuperar</button>
      </li>)}</ul>
    </details>}
    {open.length > 0 && <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="Categoría" value={area} onChange={(e) => setArea(e.target.value)} className={input}>{areaOptions}</select>
        {PRIVATE_PARTNER_AREAS.includes(area) ? <p className="self-center text-xs text-muted">Solo en tu vista</p> : <select aria-label="Reparto" value={percent} onChange={(e) => setPercent(Number(e.target.value))} className={input}><option value={50}>Mitad cada uno</option><option value={100}>100% Marco</option><option value={0}>100% Moni</option></select>}
      </div>
      <button type="button" disabled={pending || !chosen.length} onClick={() => run(chosen, () => savePartnerRows({ ids: chosen, area, percent: PRIVATE_PARTNER_AREAS.includes(area) ? 50 : percent }))} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {chosen.length ? `Guardar ${chosen.length} en ${areaLabels[area]}` : "Marcá gastos para guardar"}
      </button>
    </div>}
  </section>;
}

export function CsvImport({ hasPending }: { hasPending: boolean }) {
  const [result, action, pending] = useActionState(uploadPartnerCsv, null);
  const [fileName, setFileName] = useState("");
  const form = <form key={result?.requestId ?? "upload"} action={action} className="space-y-3 rounded-xl border border-line bg-card p-4">
    <label className="block text-sm"><span className="text-muted">Banco o tarjeta</span><input name="source" maxLength={100} required className={input} placeholder="Ej. Revolut" /></label>
    <label className="block text-sm"><span className="text-muted">Moneda si no figura en el archivo</span><select name="currency" defaultValue="BRL" className={input}><option value="BRL">BRL</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="ARS">ARS</option></select></label>
    <div className="text-sm"><span className="text-muted">Archivo CSV</span>
      <label className="relative mt-1 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg border border-accent px-4 py-3 font-medium text-accent focus-within:ring-2 focus-within:ring-accent">
        Elegir archivo CSV
        <input name="file" type="file" required aria-label="Elegir archivo CSV" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      <p className="mt-1 break-all text-xs text-muted" aria-live="polite">{fileName || "Ningún archivo seleccionado"}</p>
    </div>
    <button disabled={pending} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Leyendo…" : "Importar movimientos"}</button>
    <p className="text-xs text-muted">Si volvés a subir el mismo archivo, no se duplica nada.</p>
  </form>;
  const status = result && <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-pos" : "text-neg"}`}>{result.message}</p>;
  if (hasPending) return <div className="space-y-3">{status}<details className="rounded-xl border border-line bg-card p-3 text-sm"><summary className="cursor-pointer font-medium">Importar otro CSV</summary><div className="mt-3">{form}</div></details></div>;
  return <div className="space-y-4"><div><h1 className="text-lg font-semibold">Importar CSV</h1><p className="text-sm text-muted">Pagaste vos</p></div>{status}{form}</div>;
}
