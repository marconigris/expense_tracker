import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { connection } from "next/server";
import { requirePartner } from "@/lib/auth";
import { ManualExpense } from "../components";

export default function PartnerManualPage() {
  return <Suspense fallback={<p className="text-muted">Cargando…</p>}><Content /></Suspense>;
}
async function Content() {
  await connection(); await requirePartner();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <ManualExpense today={today} initialRequestId={randomUUID()} />;
}
