"use client";

import { useActionState, useState } from "react";
import { addManualExpense, importPartnerCsv, previewPartnerCsv, type PreviewResult } from "./actions";
import { formatMoney } from "@/lib/format";

const input = "block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";

function ExpenseFields() {
  const [area, setArea] = useState("brasil");
  return <div className="space-y-3">
    <label className="block text-sm"><span className="text-muted">Categoría</span><select name="area" value={area} onChange={(e) => setArea(e.target.value)} className={input}><option value="brasil">Brasil</option><option value="cabarete">Cabarete</option><option value="europa">Europa</option><option value="personal">Personal</option></select></label>
    {area === "personal" ? <><input type="hidden" name="percent" value="50" /><p className="text-xs text-muted">Gasto personal: solo aparece en tu vista.</p></> : <label className="block text-sm"><span className="text-muted">Reparto</span><select name="percent" defaultValue="50" className={input}><option value="50">Mitad cada uno</option><option value="100">100% Marco</option><option value="0">100% Moni</option></select></label>}
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

function Preview({ preview }: { preview: PreviewResult }) {
  const [result, action, pending] = useActionState(importPartnerCsv, null);
  return <form key={result?.requestId ?? "preview"} action={action} className="space-y-3 rounded-xl border border-line bg-card p-4">
    <input type="hidden" name="source" value={preview.source} />
    <p className="text-sm font-medium">Elegí los gastos para esta categoría</p><p className="text-xs text-muted">Solo se guardan los que marques. No selecciones transferencias ni gastos del negocio. Revisá también si ya los cargaste a mano.{preview.skipped ? ` Se omitieron ${preview.skipped} filas que no son gastos compatibles.` : ""}</p>
    <ExpenseFields />
    <div className="max-h-[32rem] space-y-1 overflow-y-auto rounded-lg border border-line">{preview.rows?.map((row, i) => <label key={i} className="flex items-start gap-3 border-b border-line p-3 text-sm last:border-0"><input name="row" type="checkbox" value={JSON.stringify(row)} className="mt-1" /><span className="min-w-0 flex-1"><span className="block break-words">{row.description}</span><span className="text-xs text-muted">{row.date}</span></span><span className="whitespace-nowrap tabular-nums">{formatMoney(row.amount, row.currency)} {row.currency}</span></label>)}</div>
    <button disabled={pending} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar seleccionados"}</button>
    {result && <p role="status" className={`text-sm ${result.ok ? "text-pos" : "text-neg"}`}>{result.message}</p>}
  </form>;
}

export function CsvImport() {
  const [preview, action, pending] = useActionState(previewPartnerCsv, null);
  const [fileName, setFileName] = useState("");
  return <div className="space-y-4"><div><h1 className="text-lg font-semibold">Importar CSV</h1><p className="text-sm text-muted">Pagaste vos</p></div>
    <form action={action} className="space-y-3 rounded-xl border border-line bg-card p-4">
      <label className="block text-sm"><span className="text-muted">Banco o tarjeta</span><input name="source" maxLength={100} required className={input} placeholder="Ej. Revolut" /></label>
      <label className="block text-sm"><span className="text-muted">Moneda si no figura en el archivo</span><select name="currency" defaultValue="BRL" className={input}><option value="BRL">BRL</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="ARS">ARS</option></select></label>
      <div className="text-sm"><span className="text-muted">Archivo CSV</span>
        <label className="relative mt-1 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg border border-accent px-4 py-3 font-medium text-accent focus-within:ring-2 focus-within:ring-accent">
          Elegir archivo CSV
          <input name="file" type="file" required aria-label="Elegir archivo CSV" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <p className="mt-1 break-all text-xs text-muted" aria-live="polite">{fileName || "Ningún archivo seleccionado"}</p>
      </div>
      <button disabled={pending} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Leyendo…" : "Ver movimientos"}</button>
      <p className="text-xs text-muted">Los PDF se procesan con Codex desde la Mac.</p>
    </form>
    {preview && !preview.ok && <p role="alert" className="text-sm text-neg">{preview.message}</p>}
    {preview?.ok && <Preview key={`${preview.source}:${preview.rows?.map((r) => `${r.date}:${r.amount}`).join("|")}`} preview={preview} />}
  </div>;
}
