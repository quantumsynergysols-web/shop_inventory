# Handoff – Shop Inventory ERP

Last updated: 17 Nov 2026 (end of phase 5). Read this first in the next session.

## Where things stand
- Project folder: `C:\Quantum Synergy Solutions Projects\Shop_Inventory_ERP`, git `main`, remote https://github.com/quantumsynergysols-web/shop_inventory (push as star-anonymus; this repo's git email is the GitHub noreply address). Repo is public.
- Specs: SRS v1.1 https://claude.ai/artifact/SMo2TLgcpy2wzc4m3kTwPY · Prototype v0.2 https://claude.ai/artifact/VMptQACtmP3oSBVNR8pGyW. Local copies in `docs/`.
- `packages/domain`: costing, posting/void/returns, units, matching, AI-result checks, day closing, permissions. 49 tests. Built to `dist/` with `npm run build --workspace @erp/domain` (the API imports the built files).
- `apps/api` (NestJS 11.2.8, ESM, compiled with tsc): config (zod), PrismaService, `GET /api/health`, auth (`POST /api/auth/login|refresh|logout`, `GET /api/auth/me`), global AuthGuard + `@Requires(action)` from the permission matrix, Argon2id passwords, 30-day sliding sessions, lockout after 5 wrong passwords, audit log on login/lock. 8 HTTP tests with an in-memory store (no DB needed). `src/seed.ts` creates the first shop + owner.
- Database `shop_erp` on local PostgreSQL 18 (user `erp_dev`): migrations `init` and `search_trgm` (pg_trgm GIN indexes on product/alias/party names, also declared in the schema so `migrate dev` sees no drift). Seeded: "Demo Shop", 1 owner, 6 categories, 7 expense heads, Walk-in customer. Owner login phone/password are in `apps/api/.env` (`SEED_OWNER_*`). Login, me and refresh verified against the real database.
- Phase 1 API (all shop-scoped, role-checked): `GET/POST/PATCH /api/products` (pg_trgm typo search, auto SKU, suggested sale price from markup, price history), `GET/POST /api/categories`, `GET/POST /api/parties` (+ balance from ledger, history), `POST /api/parties/:id/payments` (wasooli / supplier payment), `GET/POST /api/documents` (manual PURCHASE/SALE: row locks, `postDocument`, doc numbers, receipt numbers, payments, ledger, Idempotency-Key header, day lock), `POST /api/documents/:id/void` (owner; VOID document with reversed movements, ledger and payments). Domain errors map to HTTP in `common/domain-errors.filter.ts` (stock shortage = 409 with every short line).
- Phase 2 API (scan flow): `POST /api/scans` (multipart `type` + 1–10 `pages`, 15 MB each; photos kept on disk under `apps/api/storage/`, git-ignored; exact-duplicate photos flagged), extraction runs in-process in the background (`ScansService.running`), every page read in parallel by the `AiProvider` (only `DemoAiProvider` exists: recorded readings for known sample photos from `apps/api/demo-fixtures/*.json` keyed by SHA-256, otherwise empty rows = manual mode FR-AI-08), then `checkExtraction` + trigram candidates + `matchProduct`. `GET /api/scans`, `GET /api/scans/:id` (lines in review order with flags, suggestions, short stock, price diff, suggested party, `blockingCount`), `GET /api/scans/:id/pages/:n` (photo), `PUT /api/scans/:id/lines` (autosave, keeps paper order), `POST /api/scans/:id/retry|manual|discard|confirm` (confirm posts through `DocumentsService.postInTx`, learns aliases per supplier, safe to repeat). `GET /api/documents/:id/receipt?paper=58|80|a4` (printable HTML, VOID watermark, FBR disclaimer) and `GET /api/documents/:id/share` (WhatsApp text + wa.me link).
- Phase 3 API: `GET /api/dashboard` (stock value and profit only for owner/accountant), `GET /api/day?date=` (summary via `summarizeDay`; same-day voids left out, voids of earlier sales count as today's returns), `POST /api/day/close` (note above limit, blocks on unconfirmed scans unless `force`, counted cash = next opening), `POST /api/day/reopen`, `GET /api/day/month?month=YYYY-MM`, `GET/POST /api/expense-heads`, `POST /api/expenses` (salesman: cash only, up to limit), `GET /api/reports/stock-ledger|stock-valuation|party-balances?format=json|csv|xlsx`, `GET/POST/PATCH /api/users`, `POST /api/users/:id/reset-password`, `GET/PATCH /api/settings`. Scans stuck in PROCESSING for 5+ minutes are marked FAILED at startup. Shared test helpers in `apps/api/src/test-support/db-app.ts`.
- Tests: `npm test` = 49 domain + 8 API (no DB). `npm run test:db --workspace @erp/api` = 28 integration tests (10 inventory + 9 scan flow + 9 day/reports/users/isolation) on `shop_erp_test` (created automatically), incl. two sales racing for the last stock and double-tap idempotency. `npm run typecheck` clean.

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

## Phases (agreed with the user 17 Nov 2026)
| Phase | Scope | Status |
|---|---|---|
| 1 | Backend core: products, categories, parties, payments, manual purchase/sale posting, void, DB tests | done (b984639) |
| 2 | Scan flow (a16293c): photo upload + local storage, AI adapter interface + demo adapter (FR-AI-08), `checkExtraction`, `matchProduct`, review/autosave, confirm via `DocumentsService.postInTx` with alias learning (FR-REV-05), receipts | done |
| 3 | (7143e75) Dashboard, day closing + expenses (use `summarizeDay`; exclude voided sales and their voids), reports CSV/XLSX, users module (FR-AUTH-04); shop isolation tested through the API | done (row-level security moved to hardening) |
| 4 | (eda8e4b) Web app: React PWA, Urdu/English, prototype v0.2 design, all screens | done |
| H | Hardening: row-level security (NFR-SEC-02), pg-boss queue for scans, perceptual photo hash, expense receipt photo, returns/adjustments/opening-stock UI, AI settings screen (FR-SET-02) | – |
| 5 | (cc9d7b1) Video demo: `npm run demo:record` → `docs/demo/shop-erp-demo.mp4` (3:39, 1280×720, Urdu narration, git-ignored) | done |
| 6 | Real AI adapters (OpenAI/Gemini, FR-AI-14/15, NFR-ACC-01 pilot on 50+ real bills) once a key is available; then hardening (H) | next |

Phase 4 (web app, `apps/web`):
- React 19 + Vite 8, hash routes in `src/App.tsx`, screens in `src/screens/`: Login, Home (dashboard), Scan capture (compress to 2,000 px, dark-photo warning) + processing poll + Review (photo crops per row from bbox, flags, suggestions, product search/create, party picker with photo suggestion, payments, autosave, confirm with Idempotency-Key), Doc (stock before→after, receipt iframe, WhatsApp, print, owner void), Manual entry, Stock list/detail (owner edits prices), Ledger (balances, history, payments), Day closing (expenses, galla count, close, reopen), More (reports Excel/CSV, monthly view, users, settings, language, theme, logout).
- The API serves `apps/web/dist` at `/` when it exists (`WEB_DIST`), so one port runs everything: `npm run build && npm run start --workspace @erp/api` → http://localhost:3000. `.claude/launch.json` has the same as "erp".
- Checked in the browser pane at 375×812, Urdu and English: login, home, stock, day closing, scan review incl. creating a product from the review sheet, sale result + receipt, ledger, more. Screens load data slowly the first time because of Google Fonts.
- Dev database now has demo data (7 products, Al-Madina supplier, Rana Builders customer, PUR-000001, SAL-000001/2) and one purchase scan of the sample bill left half-reviewed.
- Sample bills for the demo (phase 5 work done early): `apps/api/scripts/make-demo-bills.mjs` draws `apps/api/demo-fixtures/{purchase,sale}-bill.png` with Chrome and writes the recorded demo readings (purchase reading misses row 5 and is unsure of row 6; sale bill asks 60 Tee with 45 in stock).
- Not built in the web app yet: offline upload queue (FR-SCAN-07), auto-crop/de-skew (FR-SCAN-06), bill discount field (FR-REV-13), page reordering.

Phase 5 (demo video):
- `scripts/record-demo.mjs` creates/clears database `shop_erp_demo`, seeds a sample shop (owner login 03001234567 / demo-owner-2026, demo database only), starts the API on :3100, and drives the installed Chrome (playwright-core, `channel: 'chrome'`) through 19 captioned steps in a phone frame. Frames come from Chrome's CDP screencast and the installed ffmpeg makes the MP4, so nothing extra is downloaded (Playwright's own video needs its ffmpeg download).
- Narration: 20 Urdu clips in `docs/demo/voice/step-NN.mp3` (FameSpeak voice "Asad", ur-PK, free tier; texts in `docs/demo/voice/narration.md`). Each caption starts its clip; the screen waits for it, except steps marked `overlap` where the actions play during the narration. ffmpeg mixes the clips at their caption times (checked: speech starts within ~0.5 s of the caption change).
- Story: login → home → purchase photo (demo reading misses row 5) → add the row with a new product → confirm → stock up → sale photo (Tee short: 60 vs 45) → fix → Rs 30,000 paid, rest udhaar → receipt → expense + galla count (Rs 200 short) → close day → ledger → stock → English.
- Day closing shows COGS with paisa (e.g. Rs 38,898.68) because average cost is exact; consider rounding the display.

Notes for later phases:
- Scan extraction is in-process; a restart while PROCESSING leaves the scan stuck. Phase 3/5: pg-boss queue, or on startup move PROCESSING scans to FAILED so the user can retry.
- No real image checks yet (blur, size, de-skew FR-SCAN-04..06 are client-side, phase 4); the server trusts the declared image type.
- The demo-fixtures folder is empty until phase 5 creates the sample bill photos.
- Returns (FR-STK-06), stock adjustment (FR-STK-07), opening stock import (FR-STK-08) and unit conversions UI are not built yet; `postDocument` already supports SALES_RETURN, PURCHASE_RETURN, ADJUST_IN/OUT, OPENING.
- Bill-level discount is not allocated to purchase cost yet (purchase unit cost = line amount ÷ qty).
- Row-level security needs design first: `erp_dev` owns the tables, so policies need `FORCE ROW LEVEL SECURITY` and a per-transaction `set_config('app.shop_id', ...)`; login and seed run outside it.

## Open decisions for the owner
- UI language: SRS v1.1 makes Urdu (Nastaliq) + English a v1 Must (matches the prototype). Needs owner confirmation.
- Permission matrix rows marked * in SRS §3.11 are proposed defaults; `packages/domain/src/permissions.ts` follows them.
- pg-boss instead of Redis for the job queue (no Redis/Docker on this PC). Changes the deployment diagram, not any requirement.
- Gap analysis against an existing build (SRS A-4): no existing build found.
