// npm run codex:pdf -- <archivo.pdf> <cuenta>   e.g. npm run codex:pdf -- ~/Downloads/brubank-oct.pdf brubank-ars
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { refineWithAi } from "../lib/classify";
import { db, t } from "../lib/db";
import { importRows } from "../lib/import/pipeline";
import { classifyWithCodex, extractStatementWithCodex } from "./codex";

async function main() {
  const [file, slug] = process.argv.slice(2);
  if (!file || !slug) {
    const accounts = await db.select({ slug: t.accounts.slug }).from(t.accounts).where(eq(t.accounts.active, true));
    console.error(`Uso: npm run codex:pdf -- <archivo.pdf> <cuenta>\nCuentas: ${accounts.map((a) => a.slug).join(", ")}`);
    process.exit(1);
  }
  const [account] = await db.select().from(t.accounts).where(eq(t.accounts.slug, slug));
  if (!account) throw new Error(`No existe la cuenta "${slug}"`);

  const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)));
  const { text } = await extractText(pdf, { mergePages: true });
  console.log(`Leyendo ${path.basename(file)} con Codex…`);
  const rows = await extractStatementWithCodex(text);

  const result = await importRows({ accountId: account.id, filename: path.basename(file), format: "pdf", rows });
  console.log(`${result.imported} nuevos · ${result.duplicates} duplicados`);
  for (const e of result.errors) console.log(`  ! ${e}`);

  if (result.classified?.fallback) {
    const updated = await refineWithAi(classifyWithCodex);
    console.log(`Codex sugirió ${updated} movimientos.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
