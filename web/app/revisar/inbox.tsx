"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { confirmAction, confirmConfidentAction, type Decision } from "@/app/actions";
import { formatMoney } from "@/lib/format";

export type InboxRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  amountUsd: number | null;
  account: string;
  kind: Decision["kind"];
  entityId: string | null;
  category: string | null;
  confidence: number | null;
  suggestedBy: string | null;
};

export type InboxEntity = { id: string; name: string; kind: string; shortcut: string | null; categories: string[] };

const CONFIDENT = 0.85;

/** "COMPRA MERCADONA 1234 VALENCIA" -> "compra mercadona" (editable before saving). */
function guessPattern(description: string) {
  return description
    .toLowerCase()
    .replace(/[^a-záéíóúñü\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .join(" ");
}

export function Inbox({ rows: initial, entities }: { rows: InboxRow[]; entities: InboxEntity[] }) {
  const [rows, setRows] = useState(initial);
  const [active, setActive] = useState(0);
  const [learn, setLearn] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const confidentCount = rows.filter((r) => (r.confidence ?? 0) >= CONFIDENT).length;

  // Take fresh server rows after a revalidation, without an effect.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial);
  }

  function update(id: string, patch: Partial<InboxRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, confidence: 1, suggestedBy: "manual" } : r)));
  }

  function setEntity(row: InboxRow, entityId: string) {
    const categories = entityById.get(entityId)?.categories ?? [];
    update(row.id, {
      kind: "normal",
      entityId,
      category: row.category && categories.includes(row.category) ? row.category : (categories[0] ?? null),
    });
    setLearn((l) => ({ ...l, [row.id]: l[row.id] ?? guessPattern(row.description) }));
  }

  function confirm(row: InboxRow) {
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    startTransition(() =>
      confirmAction([
        { id: row.id, entityId: row.entityId, category: row.category, kind: row.kind, rulePattern: learn[row.id] || undefined },
      ]),
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      const row = rows[active];
      if (e.key === "j" || e.key === "ArrowDown") setActive((i) => Math.min(i + 1, rows.length - 1));
      else if (e.key === "k" || e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
      else if (!row) return;
      else if (e.key === "Enter") confirm(row);
      else if (e.key === "t") update(row.id, { kind: "transfer", entityId: null, category: null });
      else {
        const entity = entities.find((x) => x.shortcut === e.key);
        if (entity) setEntity(row, entity.id);
        else return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (rows.length === 0) {
    return <p className="rounded-xl border border-line p-6 text-center text-muted">No hay nada para revisar.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          {rows.length} por revisar · <Kbd>j</Kbd>/<Kbd>k</Kbd> mover · letra = entidad · <Kbd>t</Kbd> transferencia ·{" "}
          <Kbd>Enter</Kbd> confirmar
        </p>
        <button
          disabled={pending || confidentCount === 0}
          onClick={() => {
            setRows((rs) => rs.filter((r) => (r.confidence ?? 0) < CONFIDENT));
            startTransition(() => confirmConfidentAction(CONFIDENT));
          }}
          className="rounded-lg bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-40"
        >
          Confirmar seguros ({confidentCount})
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {entities.map((e) => (
          <span key={e.id} className="rounded-md border border-line px-1.5 py-0.5 text-muted">
            <b className="text-fg">{e.shortcut}</b> {e.name}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {rows.map((row, i) => {
          const entity = row.entityId ? entityById.get(row.entityId) : undefined;
          const isActive = i === active;
          return (
            <li
              key={row.id}
              onClick={() => setActive(i)}
              className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-3 py-2.5 text-sm md:grid-cols-[6rem_1fr_9rem_15rem_auto] md:items-center ${isActive ? "bg-active" : ""}`}
            >
              <div className="text-xs text-muted md:text-sm">
                {row.date.slice(5)} · <span className="md:hidden">{row.account}</span>
                <span className="hidden md:block">{row.account}</span>
              </div>
              <div className={`text-right tabular-nums md:order-3 ${row.amount < 0 ? "" : "text-pos"}`}>
                {formatMoney(row.amount, row.currency)}
                {row.currency !== "USD" && row.amountUsd != null && (
                  <div className="text-xs text-muted">{formatMoney(row.amountUsd, "USD")}</div>
                )}
              </div>
              <div className="col-span-2 truncate md:order-2 md:col-span-1" title={row.description}>
                {row.description}
              </div>
              <div className="col-span-2 flex gap-1.5 md:order-4 md:col-span-1">
                <select
                  value={row.kind === "transfer" ? "transfer" : (row.entityId ?? "")}
                  onChange={(e) =>
                    e.target.value === "transfer"
                      ? update(row.id, { kind: "transfer", entityId: null, category: null })
                      : setEntity(row, e.target.value)
                  }
                  className="min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 py-1"
                >
                  <option value="">—</option>
                  <option value="transfer">↔ Transferencia</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                {row.kind !== "transfer" && entity && (
                  <select
                    value={row.category ?? ""}
                    onChange={(e) => update(row.id, { category: e.target.value || null })}
                    className="min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 py-1"
                  >
                    <option value="">Categoría</option>
                    {entity.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2 md:order-5 md:col-span-1">
                <Confidence value={row.confidence} source={row.suggestedBy} />
                <button
                  onClick={() => confirm(row)}
                  disabled={row.kind !== "transfer" && !row.entityId}
                  className="rounded-md border border-line px-2 py-1 hover:bg-accent hover:text-white disabled:opacity-30"
                >
                  ✓
                </button>
              </div>
              {isActive && learn[row.id] !== undefined && row.kind !== "transfer" && (
                <label className="col-span-2 flex items-center gap-2 text-xs text-muted md:order-6 md:col-span-5">
                  Recordar para descripciones que contengan
                  <input
                    value={learn[row.id]}
                    onChange={(e) => setLearn((l) => ({ ...l, [row.id]: e.target.value }))}
                    className="w-48 rounded-md border border-line bg-bg px-1.5 py-0.5 text-fg"
                  />
                  <span>(vacío = no crear regla)</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Confidence({ value, source }: { value: number | null; source: string | null }) {
  const v = value ?? 0;
  const color = v >= CONFIDENT ? "bg-pos" : v >= 0.6 ? "bg-warn" : "bg-neg";
  const label = { rule: "regla", transfer: "transferencia", ai: "IA", account: "cuenta", manual: "editado" }[source ?? ""] ?? "";
  return (
    <span className="flex items-center gap-1 text-xs text-muted" title={`${Math.round(v * 100)}%`}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line px-1 font-mono text-xs">{children}</kbd>;
}
