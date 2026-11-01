// npm run codex:classify — second pass with Codex on movements only the account default could guess.
import { refineWithAi } from "../lib/classify";
import { classifyWithCodex } from "./codex";

async function main() {
  const updated = await refineWithAi(classifyWithCodex);
  console.log(updated ? `Codex sugirió ${updated} movimientos. Revisalos en /revisar.` : "No hay movimientos sin pista.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
