# Handoff – Shop Inventory ERP

Last updated: 17 Nov 2026. Read this first in the next session.

## Where things stand
- Project folder: `C:\Quantum Synergy Solutions Projects\Shop_Inventory_ERP`, git `main`, remote https://github.com/quantumsynergysols-web/shop_inventory (push as star-anonymus; this repo's git email is the GitHub noreply address). Repo is public.
- Specs: SRS v1.1 https://claude.ai/artifact/SMo2TLgcpy2wzc4m3kTwPY · Prototype v0.2 https://claude.ai/artifact/VMptQACtmP3oSBVNR8pGyW. Local copies in `docs/`.
- `packages/domain`: costing, posting/void/returns, units, matching, AI-result checks, day closing, permissions. 49 tests. Built to `dist/` with `npm run build --workspace @erp/domain` (the API imports the built files).
- `apps/api` (NestJS 11.2.8, ESM, compiled with tsc): config (zod), PrismaService, `GET /api/health`, auth (`POST /api/auth/login|refresh|logout`, `GET /api/auth/me`), global AuthGuard + `@Requires(action)` from the permission matrix, Argon2id passwords, 30-day sliding sessions, lockout after 5 wrong passwords, audit log on login/lock. 8 HTTP tests with an in-memory store (no DB needed). `src/seed.ts` creates the first shop + owner.
- Database `shop_erp` on local PostgreSQL 18 (user `erp_dev`): migrations `init` and `search_trgm` (pg_trgm GIN indexes on product/alias/party names, also declared in the schema so `migrate dev` sees no drift). Seeded: "Demo Shop", 1 owner, 6 categories, 7 expense heads, Walk-in customer. Owner login phone/password are in `apps/api/.env` (`SEED_OWNER_*`). Login, me and refresh verified against the real database.
- `npm test` = 57 tests pass; `npm run typecheck` clean.

## Machine resources (checked 17 Nov 2026)
| Need | Status | Plan |
|---|---|---|
| Node 26, npm, git, gh | present | – |
| PostgreSQL 18 (port 5432) | present; `erp_dev` + `shop_erp` created 17 Nov | – |
| Redis (job queue, FR-AI-06) | not installed, no Docker | use a PostgreSQL-backed queue (pg-boss) instead; no new install |
| Object storage S3/R2 (photos, PDFs) | not available | local-disk storage adapter in dev, R2 in production |
| Vision AI key (OpenAI/Gemini, FR-AI-15) | none | build demo/manual mode first (FR-AI-08); user gets a key before real extraction tests |
| Chrome + Edge | present | PWA testing, phone emulation |
| Android phone, thermal printer | not on this PC | "Microsoft Print to PDF" for receipt layout; real phone/printer at pilot |
| 50+ real bills for pilot (SRS §8) | not available | needed from client before accuracy testing |
| RAM 16 GB (3 GB free), C: 37 GB free | enough | – |

## Database notes
- Claude does not know the `postgres` superuser password and must not ask for it. Anything needing superuser goes in a script the user runs (as with `apps/api/prisma/setup-dev-db.sql`, git-ignored).
- In PowerShell, run executables with `&`: `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" ...`.
- `prisma migrate dev` waits for an answer when the database and schema differ, which hangs a non-interactive shell. Check first with `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (run from `apps/api` with `node --env-file=.env ../../node_modules/prisma/build/index.js ...`).

## Next steps, in order
1. Row-level security per `shopId` (NFR-SEC-02). Needs design first: `erp_dev` owns the tables, so policies need `FORCE ROW LEVEL SECURITY` and a per-transaction `set_config('app.shop_id', ...)` from the API; login and seed must run outside it.
2. Users module (FR-AUTH-04): owner adds/disables users, resets passwords.
3. Products, categories, parties (FR-PRD, FR-PTY) with shop-scoped queries.
4. Documents: manual Stock IN/OUT and confirm transaction using `postDocument` with idempotency key (FR-STK-01/09, NFR-REL-02), doc numbering via `DocCounter`, receipts.
5. Scans: storage adapter, pg-boss queue, AI adapter interface + demo adapter, `checkExtraction`, `matchProduct`, review API.
6. Day closing, expenses, reports, then the React PWA (`apps/web`).

## Open decisions for the owner
- UI language: SRS v1.1 makes Urdu (Nastaliq) + English a v1 Must (matches the prototype). Needs owner confirmation.
- Permission matrix rows marked * in SRS §3.11 are proposed defaults; `packages/domain/src/permissions.ts` follows them.
- pg-boss instead of Redis for the job queue (no Redis/Docker on this PC). Changes the deployment diagram, not any requirement.
- Gap analysis against an existing build (SRS A-4): no existing build found.
