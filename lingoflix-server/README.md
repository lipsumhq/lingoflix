# LingoFlix server

The LingoFlix website and API at `https://lingoflix.lipsum.fun`, built with Next.js:

- **Pages:** the landing page and pricing, the welcome page opened after install, sign-in (Google or an emailed link),
  the account page, the extension hand-off (`/connect`), the uninstall page (`/goodbye`), privacy and terms.
- **Auth:** Better Auth on Postgres (Neon), through Kysely. The extension authenticates with a bearer token.
- **Schema:** every change, including Better Auth's tables, is a kysely-ctl migration in `src/db/migrations/`.

Design: `docs/superpowers/specs/2026-10-10-lingoflix-subscription-design.md`.

## Scripts

Run from the repository root with `pnpm --filter lingoflix-server <script>`, or from this folder with `pnpm <script>`.

| Script | What it does |
|---|---|
| `dev` | Development server at http://localhost:3000 |
| `test` | Unit tests (Vitest). Uses an in-process Postgres (PGlite): no database or `.env` needed |
| `compile` | Generates Next.js route types, then type-checks |
| `build` | Production build. Needs no environment variables |
| `db:make <name>` | Creates an empty migration file in `src/db/migrations/` |
| `db:migrate` | Applies pending migrations, connecting with `DATABASE_URL_UNPOOLED` from the shell or `.env` |
| `db:migrate:local` | Same, also reading `.env.local` |
| `db:list` | Shows which migrations have run |

## Local development

1. Copy `.env.example` to `.env.local` and fill in what you have. Only the database, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` and the Google values (placeholders are fine) are needed to sign in by email link.
2. Without Cloudflare credentials (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN`), sign-in links are printed to the
   terminal running `pnpm dev` instead of being emailed. This only happens outside production.
3. Point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at a local Postgres or a Neon branch, then run
   `pnpm --filter lingoflix-server db:migrate:local`.
4. `pnpm --filter lingoflix-server dev`.

## Migrations and Better Auth's schema check

Better Auth checks the live database schema and rejects every auth request while it doesn't match. A running instance
also remembers a failed check until it restarts.

- Run migrations **before** deploying code that needs them.
- After migrating a database that running instances already use, redeploy.
- New columns on Better Auth's tables (`user`, `session`, `account`, `verification`) must be nullable or have a default.
- Migrations use the direct connection (`DATABASE_URL_UNPOOLED`): Neon's pooler doesn't support the lock kysely-ctl
  takes while migrating.
- Use `sslmode=verify-full` in Neon connection strings.

## Deploying

Vercel project with Root Directory `lingoflix-server` and Node.js 24.x, Neon from the Vercel Marketplace, and the
environment variables listed in `.env.example`. Run `db:migrate` against Neon before the first deploy.
`NEXT_PUBLIC_CHROME_STORE_URL` is read at build time, so changing it takes effect after a redeploy.
