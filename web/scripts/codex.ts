// Runs prompts through the Codex CLI so they use Marco's ChatGPT plan instead of a paid API.
// Uses the `codex` on PATH or the one bundled with Codex.app, already logged in with ChatGPT.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiContext, AiItem, AiSuggestion } from "../lib/classify";

const APP_BUNDLED = "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex";

function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  try {
    execFileSync("which", ["codex"], { stdio: "ignore" });
    return "codex";
  } catch {
    return existsSync(APP_BUNDLED) ? APP_BUNDLED : "codex";
  }
}

const CODEX = findCodex();

/** Sends `prompt` to `codex exec` and returns its final message parsed against `schema`. */
export async function askCodex<T>(prompt: string, schema: object): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "finanzas-codex-"));
  try {
    const schemaFile = path.join(dir, "schema.json");
    const outFile = path.join(dir, "out.json");
    await writeFile(schemaFile, JSON.stringify(schema));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        CODEX,
        ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-C", dir, "--output-schema", schemaFile, "-o", outFile, "-"],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let log = "";
      child.stderr.on("data", (chunk) => (log += chunk));
      child.on("error", (err) => reject(new Error(`No pude correr "${CODEX}": ${err.message}. ¿Instalaste Codex (npm i -g @openai/codex)?`)));
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`codex exec terminó con código ${code}\n${log.slice(-2000)}`))));
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(outFile, "utf8")) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "entity", "category", "transfer", "confidence"],
        properties: {
          id: { type: "string" },
          entity: { type: "string", description: "Entity slug" },
          category: { type: "string" },
          transfer: { type: "boolean", description: "True when money just moves between Marco's own accounts" },
          confidence: { type: "number", description: "0 to 1" },
        },
      },
    },
  },
};

const CLASSIFY_INSTRUCTIONS = `You classify Marco's bank movements. Do not run any commands; answer only from the data below.
Marco is the center of this ledger: for every movement decide who the money belongs to.

Entity kinds:
- personal: Marco's own spending and income.
- business: a business. Money from it reaching Marco is income (client payments for Coaching, withdrawals from Bora or Adventure Planning); business costs Marco pays (ads, monotributo, software) are outflows of that business.
- household: living costs shared 50/50 with his partner Moni, one per place they live (Europe, Cabarete in the Dominican Republic, Brazil). Pick it from the merchant's location.
- property: joint real-estate investments; capital contributions out, distributions in.
- investment: interest and returns on Marco's financial accounts.
- custody: money Marco manages for his father; interest earned on it and payments to him.

Each account carries a hint about how it is usually used; treat it as a prior, not a rule. Prefer the confirmed examples when a description matches.
Use a category from the chosen entity's list. Set confidence below 0.6 whenever you are guessing. Return one item per movement id.`;

export async function classifyWithCodex(items: AiItem[], ctx: AiContext): Promise<AiSuggestion[]> {
  const prompt = `${CLASSIFY_INSTRUCTIONS}\n\n${JSON.stringify({ entities: ctx.entities, confirmed_examples: ctx.examples, movements: items })}`;
  const { items: out } = await askCodex<{ items: AiSuggestion[] }>(prompt, CLASSIFY_SCHEMA);
  return out;
}

const STATEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "description", "amount", "currency"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          description: { type: "string" },
          amount: { type: "number", description: "Signed: negative when money leaves the account" },
          currency: { type: "string", description: "ISO code, e.g. ARS, USD, EUR" },
        },
      },
    },
  },
};

export async function extractStatementWithCodex(text: string) {
  const prompt =
    "Below is the text of a bank statement. Do not run any commands. Extract every movement: the date it happened, " +
    "the description as printed, the signed amount (debits negative, credits positive) and its currency. " +
    "Skip balances, subtotals and headers.\n\n" +
    text;
  const { rows } = await askCodex<{ rows: { date: string; description: string; amount: number; currency: string }[] }>(prompt, STATEMENT_SCHEMA);
  return rows;
}
