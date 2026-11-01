# AGENTS.md — handoff for coding agents

Read this first. It is the source of truth for product decisions; `web/README.md` covers commands.
Talk to Marco (the owner) in Spanish (rioplatense, "vos"). Code, comments and commits in English.

## What this repo is

Personal finance app for Marco Nigris. Two apps live here:

| Path | What | Status |
|---|---|---|
| repo root (`*.py`, `pages/`, `services/`) | **v1**: Streamlit + Google Sheets. Production at chettiexpenses.streamlit.app | Legacy. Do not modify or delete; it keeps running until v2 has the data. Root has uncommitted local edits (`config/constants.py`, Private Dashboard) that belong to Marco: leave them alone. |
| `web/` | **v2**: Next.js 16 + Postgres (Drizzle) on Vercel | Active. All new work goes here. |

`.streamlit/secrets.toml` and any credentials must never be committed or printed (there was a past leak).

## Product model (decided with Marco — do not re-litigate)

**Marco is the center.** The app answers: what reaches Marco's pocket, what he consumes, where his money sits.
It does NOT measure business profitability (each business has its own accounting).

- **Account** = where money sits (Revolut EUR, Brubank ARS, Efectivo USD…).
- **Entity** = who it belongs to. Kinds:
  - `personal` — Marco.
  - `business` — Coaching, Bora Vida, Adventure Planning. Only flows between the business and Marco count.
    "What a business gave me" = money that reached Marco (cash from Bora, client payments for Coaching,
    transfers from Adventure Planning) minus business costs Marco paid (ads, monotributo).
    Coaching runs through Marco's personal accounts: every client payment is Coaching income to Marco (option A).
    Bora and Adventure Planning have their own accounts, outside the app.
  - `household` — Vida Europa / Vida Cabarete / Vida Brasil, shared 50/50 with Moni (partner). Marco's
    consumption is 50% of everything spent there, whoever paid. `paid_by` records who paid; settlement = paid − 50%.
  - `property` — La Mariposa (50% with Moni, 120k USD capital total), Marquis Panamá (33% with Marco's dad,
    157k USD capital total). Contributions are capital, not spending; distributions are income.
  - `investment` — interest and returns (Wise, Bunq, Revolut savings, Cocos, IBKR, Binance, Crypto.com).
  - `custody` — "Papá (custodia)": money Marco manages for his father. It sits in Marco's accounts but is NOT his;
    excluded from income, spending and net worth. Opening balances 2026-01-01 are seeded
    (bank USD 46,859 · cash USD 30,405 · bank EUR 25,000). Dad's own sheet says 77,274 USD total vs 77,264 here — unresolved.
- **Transaction**: signed amount in its original currency, plus `amount_usd` / `amount_eur` at that day's rate.
  ARS → USD uses the **MEP** rate (ArgentinaDatos "bolsa"); EUR via Frankfurter. USDT = USD.
  `kind`: `normal` | `transfer` (between Marco's own accounts; ignored in reports) | `settlement` | `opening` |
  `excluded` (kept for account history, excluded from reports) | `receivable` (advances and repayments, excluded
  from income/consumption and shown as an amount to reconcile).
  `status`: `pending` → `suggested` → `confirmed`. Reports only use confirmed.
- Reporting: overall picture in USD, plus a native EUR view (Marco lives part of the year in Europe).
  Headline = average monthly (last 12 months) income reaching Marco − his consumption.

Catalog of entities, accounts, categories and starter rules: `web/lib/catalog.ts` (seed upserts by slug).
Account hints there describe how Marco uses each account; keep them accurate, they feed the AI prompt.
Coaching expenses for Sole and Udemy use the `Trainings` category, not `Suscripciones`.

## Month-end workflow the app is built around

1. Import statements (CSV in the web app; PDFs locally via Codex).
2. Auto-classification: transfer pairing → learned rules → account default (low confidence).
3. Optional AI pass on low-confidence rows: `npm run codex:classify` (local, see below).
4. Review inbox `/revisar`: keyboard (`j`/`k`, entity letter, `t` transfer, Enter confirm). Correcting a row can save a rule.
5. Dashboard `/`.

## AI policy

Marco wants AI to run on his **ChatGPT plan via the Codex CLI**, not on any paid API (no Anthropic/OpenAI API keys).
The deployed app therefore has no AI. `web/scripts/codex.ts` shells out to `codex exec --output-schema … -o …`
(binary on PATH or `/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex`, already logged in with ChatGPT).
Scripts load `web/.env`, overridden by `web/.env.prod` if present (put the Neon `DATABASE_URL` there to work on production).

## Code map (`web/`)

- `lib/db/schema.ts` — Drizzle schema. Migrations in `drizzle/` (generate with `npm run db:generate`, never edit applied ones).
- `lib/import/csv.ts` — CSV parser (Revolut, Wise, generic; handles `1.234,56` and DD/MM/YYYY).
- `lib/import/pipeline.ts` — `importStatement` (CSV) / `importRows`: routes multi-currency rows to sibling accounts of the same institution, dedupes using transaction details and bank references when available, converts FX, then `classifyPending`.
- `lib/classify.ts` — transfer pairing, rule matching, account fallback, and `refineWithAi(ask)` (AI injected).
- `lib/fx.ts` — rate fetching/caching in `fx_rates`.
- `lib/reports.ts` — the Marco-centric math for the dashboard. Read its doc comment before changing numbers.
- `auth.ts`, `proxy.ts`, `lib/auth.ts`, `lib/password.ts` — Auth.js Credentials (email + password, scrypt). Only rows in `users` can sign in.
  `requireOwner()` guards every page/server action today; Moni (`role = partner`) can sign in but has no views yet.
  Locally sign-in is skipped unless `AUTH_IN_DEV=1`.
- `app/` — pages: `/` dashboard, `/revisar` inbox, `/importar` upload, `/login`. Server actions in `app/actions.ts`.
- `web/AGENTS.md` — Next.js note: this is Next 16 (Cache Components on, `proxy.ts` instead of middleware).
  Read `node_modules/next/dist/docs/` before using Next APIs. Data reads need `await connection()` inside a `<Suspense>`.

## Environments

- **Local**: Homebrew Postgres 16, database `finanzas` (`DATABASE_URL=postgres://marconigris@localhost:5432/finanzas`). `.claude/launch.json` has `web` (port 3100, no login) and `web-auth` (3101, login enforced).
- **Production**: Vercel project `chetti-finances` (root directory `web`, branch `master`), Neon Postgres via the Vercel integration (env var prefix `DATABASE` → `DATABASE_URL`).
  `vercel-build` runs `drizzle-kit migrate` + idempotent seed + `next build`. Required env: `DATABASE_URL`, `AUTH_SECRET`.
- Always check which database a script points at before writing (`set-password` prints the host). A past bug had staging writing to production.

## Status (2026-11-01)

Done: schema, seed, CSV import, transfer/rule/account classification, Codex scripts (tested on Marco's plan), review inbox, dashboard (USD/EUR), email+password auth, production deploy, Marco's login. Neon is connected in Vercel; `web/.env.prod` points local scripts at Neon. Moni's password is still pending; never ask for or handle either password.

Current backfill: shared Europe expenses through 2026-08-08 are already in Tricount. Shared Europe expenses from 2026-08-09 through September go to Tricount "Tarifa 2026"; other personal/business transactions from August go to v2. From October onward, all transactions, including Vida Brasil, go to v2. Brubank August–October (54 rows) is imported and confirmed in production: 16/15/23 rows by month. The nine opaque October USD "Débito en Cuenta" rows are PIX spending in Vida Brasil, category `Otros`, paid by Marco and shared 50/50 with Moni. AGILPAGOS transfers went to Cocos. Brubank CSV imports now use bank references to distinguish same-day identical debits.

Marco subsequently requested Brubank January–July too: all 113 statement rows are imported in production, 112 confirmed and one February ARS 295.96 digital-services tax still awaiting identification. Starlink February–April was already in Tricount and is `excluded` (including its reversal); a January payment from Marianela relates to 2025 and is also excluded. May–July Starlink payments were advances for Ale: Marco says they were repaid; they are `receivable`, category `Ale`, until the incoming Revolut/Wise payments can be matched. PREX transfers are excluded from income and consumption; a separate USD 12.19 Coaching/Ads expense is inferred from the net amount, dated on the May reimbursement because the actual ad date is unknown. v1 may overlap the January–March Brubank imports: prevent duplicates when migrating it.

Next, in order:
1. **Continue statement backfill** for other accounts, applying the Tricount/v2 date boundary above. Moni can set her password when she needs access; her views are not implemented yet.
2. **Migrate v1 data** from Google Sheets (prod spreadsheet; staging id `1qv2AF8aF-Cq0pBtD9igCQP76Kj7vDq4yq06tCQZgcKg` is NOT prod). v1 schema: 17 columns (`Date, Amount, Type, Category, Description, Currency Amount, Currency, User, Marco Split %, Moni Split %, Account, Scope, Source, Import Batch ID, External ID, Reconciled, Match ID`); v1 split columns mean *who paid*, not who owes. Map v1 projects: Cabarete → Vida Cabarete, Hymerlife → archived (sold), Cash USD/EUR/USDT → accounts, Coaching/Bora Vida/Adventure Planning → entities. Find where v1 data stops (last seen ~2026-03-22, unverified) — Marco must backfill from there with statements.
3. **Moni's view**: mobile-first quick entry (PWA) for household + La Mariposa expenses she pays from her own accounts (`account_id = null`, `paid_by = moni`), and a settlement view per household. She must only see `shared_with_moni` entities.
4. **Balances / net worth**: per-account opening balances (`kind = opening`) so the dashboard can show where money sits, minus custody. Yield per investment account (interest ÷ average balance).
5. Charts (monthly bars), sign-out button, editing accounts/rules from the UI, Excel import.

Open questions for Marco: business interest he pays his dad in cash — which business, and should it count against that business (proposed: yes)? Dad's 10-unit discrepancy above.

## Conventions

- Keep the v2 UI compact, Spanish copy, dark-blue gradient "hero" style (`globals.css` tokens). No explanatory filler text.
- Run `npx tsc --noEmit -p .`, `npx eslint .` and `npx next build` (with any `AUTH_SECRET`) in `web/` before committing.
- Commit only `web/` and docs unless Marco asks otherwise; never commit `.env*` (except `.env.example`).
