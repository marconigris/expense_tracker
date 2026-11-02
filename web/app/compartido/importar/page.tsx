import { Suspense } from "react";
import { connection } from "next/server";
import { requirePartner } from "@/lib/auth";
import { CsvImport } from "../components";

export default function PartnerImportPage() {
  return <Suspense fallback={<p className="text-muted">Cargando…</p>}><Content /></Suspense>;
}
async function Content() {
  await connection(); await requirePartner();
  return <CsvImport />;
}
