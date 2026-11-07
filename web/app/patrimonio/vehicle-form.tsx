"use client";

import { useActionState } from "react";
import { addVehicle } from "./vehicle-actions";

export function VehicleForm({ purchases }: { purchases: { id: string; label: string }[] }) {
  const [result, action, pending] = useActionState(addVehicle, null);
  const input = "block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
  return <details className="rounded-xl border border-line bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">Agregar auto</summary>
    <form action={action} className="mt-4 space-y-3">
      <label className="block">Nombre<input name="name" required maxLength={100} className={input} placeholder="Ej. Auto Cabarete" /></label>
      <label className="block">Pago de compra ya cargado<select name="transaction" required defaultValue="" className={input}><option value="" disabled>Elegí el movimiento</option>{purchases.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="block">Precio total en la moneda del pago<input name="price" inputMode="decimal" required className={input} placeholder="Ej. 3500" /></label>
      <div className="grid grid-cols-2 gap-3"><label>Tu parte (%)<input type="number" name="share" defaultValue="50" min="0.01" max="100" step="0.01" required className={input} /></label><label>Amortización anual (%)<input type="number" name="annualRate" defaultValue="15" min="0" max="100" step="0.01" required className={input} /></label></div>
      <label className="block">Fecha de compra<input type="date" name="acquired" required className={input} /></label>
      <p className="text-xs text-muted">La compra deja de contarse como gasto; el pago sigue en la cuenta. La amortización se calcula desde el mes de compra.</p>
      <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar auto"}</button>
      {result && <p role="status" className={result.ok ? "text-pos" : "text-neg"}>{result.message}</p>}
    </form>
  </details>;
}
