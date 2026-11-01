# Finanzas v2

Ledger centered on Marco: what reaches his pocket, what he consumes and where his money sits.
Replaces the Streamlit app in the repo root (kept untouched until this one is live).

## Model

- **Account**: where money sits (Revolut EUR, Brubank ARS, Efectivo USD…). Seeded from `lib/catalog.ts`.
- **Entity**: who it belongs to: personal, businesses, households with Moni (50/50), properties, investments, dad's custody.
- **Transaction**: signed amount in its own currency plus USD and EUR at the day's rate (ARS uses MEP).
  `kind = transfer` between own accounts never counts as income or spending.

Classification order for imported rows: internal-transfer pairing → learned rules → account default.
Confirming a row in `/revisar` can save a rule, so the next import needs less review.

## AI with Codex (runs on the Mac, uses the ChatGPT plan)

The deployed app has no AI. Two local commands call `codex exec` (Codex.app's CLI, logged in with ChatGPT):

```bash
npm run codex:classify                              # suggest entity/category for rows nothing else could guess
npm run codex:pdf -- ~/Downloads/brubank.pdf brubank-ars   # read a PDF statement and import it
```

They use `.env`, overridden by `.env.prod` when it exists: put the Neon `DATABASE_URL` there to work on production data.

## Local setup

```bash
cp .env.example .env              # DATABASE_URL to a local Postgres
createdb finanzas
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

## Access

Google sign-in (Auth.js). Only emails in the `users` table get in; Moni sees nothing yet (owner-only pages).
Locally, leaving `AUTH_GOOGLE_ID` empty skips sign-in.

## Deploy (Vercel)

Root directory `web`. `vercel-build` runs migrations and the idempotent seed before `next build`.
Env vars: `DATABASE_URL` (Neon integration), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
