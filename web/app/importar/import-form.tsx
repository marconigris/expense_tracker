"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importAction } from "@/app/actions";

type AccountOption = { id: string; name: string; institution: string };

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const [result, action, pending] = useActionState(importAction, null);
  const institutions = [...new Set(accounts.map((a) => a.institution))];

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3 rounded-xl border border-line bg-card p-4">
        <label className="block text-sm">
          <span className="text-muted">Cuenta de origen</span>
          <select name="accountId" required className="mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5">
            {institutions.map((inst) => (
              <optgroup key={inst} label={inst}>
                {accounts
                  .filter((a) => a.institution === inst)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Extracto CSV</span>
          <input name="file" type="file" accept=".csv,.txt" required className="mt-1 block w-full text-sm" />
        </label>
        <p className="text-xs text-muted">
          Si el archivo trae varias monedas (Revolut, Wise), cada movimiento va a la cuenta de esa moneda. Los PDF se
          importan desde la Mac con Codex.
        </p>
        <button disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Importando…" : "Importar"}
        </button>
      </form>

      {result && (
        <div className="rounded-xl border border-line bg-card p-4 text-sm">
          <p>
            <b>{result.imported}</b> movimientos nuevos · {result.duplicates} duplicados omitidos
            {result.format && <span className="text-muted"> · formato {result.format}</span>}
          </p>
          {result.classified && (
            <p className="mt-1 text-muted">
              {result.classified.transfers} transferencias · {result.classified.rules} por regla ·{" "}
              {result.classified.fallback} sin pista
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-neg">
              {result.errors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {result.imported > 0 && (
            <Link href="/revisar" className="mt-2 inline-block font-medium text-accent">
              Revisar ahora →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
