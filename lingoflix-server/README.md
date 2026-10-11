# LingoFlix server

The LingoFlix website at `https://lingoflix.lipsum.fun`, built with Next.js. LingoFlix is free, so the site has no
sign-in, accounts or payments:

- **Pages:** the landing page (`/`), the welcome page the extension opens after install (`/welcome`), the uninstall
  page (`/goodbye`), privacy (`/privacy`) and terms (`/terms`).
- **API:** `POST /api/goodbye` stores the uninstall page's optional answer (a reason, a comment and the time), at most
  100 answers an hour in total.
- **Database:** Postgres (Neon) through Kysely, only for those answers (`uninstall_feedback`). Every schema change is a
  kysely-ctl migration in `src/db/migrations/`.

Design: `docs/superpowers/specs/2026-10-11-lingoflix-free-own-key-design.md` (§5).

## Scripts

Run from the repository root with `pnpm --filter lingoflix-server <script>`, or from this folder with `pnpm <script>`.

| Script | What it does |
|---|---|
| `dev` | Development server at http://localhost:3000 |
| `test` | Unit tests (Vitest). Uses an in-process Postgres (PGlite): no database or `.env` needed |
| `compile` | Generates Next.js route types, then type-checks |
| `build` | Production build. Needs no environment variables |
| `lint` | ESLint |
| `db:make <name>` | Creates an empty migration file in `src/db/migrations/` |
| `db:migrate` | Applies pending migrations, connecting with `DATABASE_URL_UNPOOLED` from the shell or `.env` |
| `db:migrate:local` | Same, also reading `.env.local` |
| `db:list` | Shows which migrations have run |

## Environment variables

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The pooled Postgres connection string the app uses to store goodbye answers |
| `DATABASE_URL_UNPOOLED` | The direct connection string migrations use |
| `NEXT_PUBLIC_CHROME_STORE_URL` | The Chrome Web Store listing. Empty until the extension is published: the pages then say it's coming soon |

Tests and builds need none of them. `.env.example` lists them with local placeholders.

## Local development

1. Copy `.env.example` to `.env.local` and point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at a local Postgres or a
   Neon branch.
2. `pnpm --filter lingoflix-server db:migrate:local`.
3. `pnpm --filter lingoflix-server dev`.

Every page but the goodbye answer works without a database.

## Migrations

- Run a migration that adds something **before** deploying the code that needs it, and one that removes something
  (such as `drop_sign_in`, which drops the old sign-in tables) **after** deploying the code that stops using it.
- Migrations use the direct connection (`DATABASE_URL_UNPOOLED`): Neon's pooler doesn't support the lock kysely-ctl
  takes while migrating.
- Use `sslmode=verify-full` in Neon connection strings.
- Never edit a migration that has run: add a new one. `better_auth` stays as history; `drop_sign_in` undoes it.

## Deploying

Vercel project with Root Directory `lingoflix-server` and Node.js 24.x, Neon from the Vercel Marketplace, and the three
environment variables above. `NEXT_PUBLIC_CHROME_STORE_URL` is read at build time, so changing it takes effect after a
redeploy.
