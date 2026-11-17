# Handoff – Shop Inventory ERP

Last updated: 17 Nov 2026. Read this first in the next session.

## Where things stand
- Project folder: `C:\Quantum Synergy Solutions Projects\Shop_Inventory_ERP`, git `main`, remote https://github.com/quantumsynergysols-web/shop_inventory (push as star-anonymus; this repo's git email is the GitHub noreply address). Repo is public.
- Specs: SRS v1.1 https://claude.ai/artifact/SMo2TLgcpy2wzc4m3kTwPY · Prototype v0.2 https://claude.ai/artifact/VMptQACtmP3oSBVNR8pGyW. Local copies in `docs/`.
- `packages/domain`: costing, posting/void/returns, units, matching, AI-result checks, day closing, permissions. 49 tests. Built to `dist/` with `npm run build --workspace @erp/domain` (the API imports the built files).
- `apps/api` (NestJS 11.2.8, ESM, compiled with tsc): config (zod), PrismaService, `GET /api/health`, auth (`POST /api/auth/login|refresh|logout`, `GET /api/auth/me`), global AuthGuard + `@Requires(action)` from the permission matrix, Argon2id passwords, 30-day sliding sessions, lockout after 5 wrong passwords, audit log on login/lock. 8 HTTP tests with an in-memory store (no DB needed). `src/seed.ts` creates the first shop + owner.
- `apps/api/prisma/schema.prisma`: 24 tables (added `session`), valid, client generated. **No migration run yet.**
- `npm test` = 57 tests pass; `npm run typecheck` clean.

## Machine resources (checked 17 Nov 2026)
| Need | Status | Plan |
|---|---|---|
| Node 26, npm, git, gh | present | – |
| PostgreSQL 18 (port 5432) | present; `erp_dev` user **not created yet** | user runs the setup script below |
| Redis (job queue, FR-AI-06) | not installed, no Docker | use a PostgreSQL-backed queue (pg-boss) instead; no new install |
| Object storage S3/R2 (photos, PDFs) | not available | local-disk storage adapter in dev, R2 in production |
| Vision AI key (OpenAI/Gemini, FR-AI-15) | none | build demo/manual mode first (FR-AI-08); user gets a key before real extraction tests |
| Chrome + Edge | present | PWA testing, phone emulation |
| Android phone, thermal printer | not on this PC | "Microsoft Print to PDF" for receipt layout; real phone/printer at pilot |
| 50+ real bills for pilot (SRS §8) | not available | needed from client before accuracy testing |
| RAM 16 GB (3 GB free), C: 37 GB free | enough | – |

## Blocked on the user
PostgreSQL superuser password is not known to Claude and must not be asked for. The user runs once:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -f apps/api/prisma/setup-dev-db.sql
```

(or pastes the file into pgAdmin). It creates role `erp_dev` and database `shop_erp`; the generated password is in that file and `apps/api/.env` (both git-ignored). `apps/api/.env` also holds a generated `JWT_SECRET`.

## Next steps, in order
1. Check the user ran the setup script: `GET /api/health` should say `db: up`, or `psql -U erp_dev -h localhost -d shop_erp -c "select 1"`.
2. `npm run db:migrate --workspace @erp/api -- --name init`, then `npm run build && npm run db:seed --workspace @erp/api` (owner login phone/password end up in `apps/api/.env`).
3. Raw SQL migration: `CREATE EXTENSION pg_trgm`, trigram indexes on `product.normalizedName` and `product_alias.normalized`, row-level security per `shopId` (NFR-SEC-02).
4. Users module (FR-AUTH-04): owner adds/disables users, resets passwords.
5. Products, categories, parties (FR-PRD, FR-PTY) with shop-scoped queries.
6. Documents: manual Stock IN/OUT and confirm transaction using `postDocument` with idempotency key (FR-STK-01/09, NFR-REL-02), doc numbering via `DocCounter`, receipts.
7. Scans: storage adapter, pg-boss queue, AI adapter interface + demo adapter, `checkExtraction`, `matchProduct`, review API.
8. Day closing, expenses, reports, then the React PWA (`apps/web`).

## Open decisions for the owner
- UI language: SRS v1.1 makes Urdu (Nastaliq) + English a v1 Must (matches the prototype). Needs owner confirmation.
- Permission matrix rows marked * in SRS §3.11 are proposed defaults; `packages/domain/src/permissions.ts` follows them.
- pg-boss instead of Redis for the job queue (no Redis/Docker on this PC). Changes the deployment diagram, not any requirement.
- Gap analysis against an existing build (SRS A-4): no existing build found.
