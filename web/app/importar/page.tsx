import { requireOwner } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db, t } from "@/lib/db";
import { ImportForm } from "./import-form";

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Importar extracto</h1>
      <Suspense fallback={<p className="text-muted">Cargando cuentas…</p>}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await connection();
  await requireOwner();
  const accounts = await db
    .select({ id: t.accounts.id, name: t.accounts.name, institution: t.accounts.institution })
    .from(t.accounts)
    .where(eq(t.accounts.active, true))
    .orderBy(asc(t.accounts.sortOrder));
  return <ImportForm accounts={accounts} />;
}
