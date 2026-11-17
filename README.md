# Shop Inventory ERP – Photo Scan

QSSols. Built to the SRS v1.1 (https://claude.ai/artifact/SMo2TLgcpy2wzc4m3kTwPY) and prototype v0.2 (https://claude.ai/artifact/VMptQACtmP3oSBVNR8pGyW).

## Layout

| Path | What it is |
|---|---|
| `packages/domain` | Business rules with no I/O: money, units, costing, stock posting, product matching, AI-result checks, day closing, permissions |
| `apps/api/prisma/schema.prisma` | PostgreSQL schema (SRS §6, ERD) |
| `apps/api` | API server (NestJS): health, auth, permission guard. See `HANDOFF.md` for what is next |
| `apps/web` | React PWA (Urdu/English), served by the API at `/` after a build |
| `scripts/record-demo.mjs` | Records the demo video on a separate `_demo` database |

## Commands

Needs Node 22.18 or newer (TypeScript runs directly, no build step for tests).

```bash
npm install
npm test              # domain tests
npm run typecheck
npm run build         # domain, Prisma client and API
npm run db:validate   # needs DATABASE_URL, see apps/api/.env.example
npm run build:all     # domain, API and web app
npm run start --workspace @erp/api   # app on http://localhost:3000
npm run demo:record   # docs/demo/shop-erp-demo.mp4 (needs Chrome and ffmpeg)
```

## Rules worth knowing before changing code

- Money is whole paisa (`Paisa`), quantities are whole thousandths of the base unit (`QtyMilli`). Never use floats for either (C-4).
- Product keeps `onHand` and `stockValuePaisa`; average cost is value ÷ qty. Selling the last unit takes the exact remaining value, so rounding never piles up (BR-2, BR-3).
- `postDocument` is all-or-nothing and never changes its input. The API must write its movements and the new stock in one transaction (FR-STK-01).
- Stock movements are append-only. Corrections are void (`reverseMovements`), return or adjustment documents (C-5, BR-6).
- AI output always goes through `checkExtraction` before review: row gaps, totals and qty × rate are checked so a dropped row is never silent (FR-AI-04/13).

## SRS coverage so far

| Module | Status |
|---|---|
| Costing, posting, void, returns, adjustments (§3.5) | Domain logic done and tested |
| Unit normalisation and conversion (FR-AI-05, FR-STK-10) | Domain logic done and tested |
| Product matching (FR-REV-04/05, FR-PRD-08) | Domain logic done and tested |
| AI result checks (FR-AI-04/12/13, FR-REV-14) | Domain logic done and tested |
| Day closing, expenses, profit (§3.10a) | Domain logic done and tested |
| Permission matrix (§3.11) | Domain logic done and tested; * rows await owner confirmation |
| Database schema | Written, passes `prisma validate`; no migration run yet |
| Auth: login, sessions, lockout, permission guard (FR-AUTH-01/02, NFR-SEC-01/04) | Done and tested without DB |
| Products, parties, stock posting, scans (demo AI), receipts, day closing, reports, users (phases 1–3) | Done; 28 database tests |
| Web app, all screens (phase 4) | Done; checked in the browser |
| Demo video (phase 5) | `npm run demo:record` |
| Real AI providers, row-level security, offline queue, returns/adjustments UI | Not started (see `HANDOFF.md`) |
