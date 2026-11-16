# Handoff – Shop Inventory ERP

Last updated: 16 Nov 2026. Read this first in the next session.

## Where things stand
- Project folder: `C:\Quantum Synergy Solutions Projects\Shop_Inventory_ERP` (git repo on `main`, pushed to https://github.com/quantumsynergysols-web/shop_inventory as star-anonymus with the GitHub noreply email).
- Specs: SRS v1.1 https://claude.ai/artifact/SMo2TLgcpy2wzc4m3kTwPY · Prototype v0.2 https://claude.ai/artifact/VMptQACtmP3oSBVNR8pGyW. Local copies: `docs/shop-erp-spec.html`, `docs/photo-scan-prototype.html`.
- `packages/domain`: costing, posting/void/returns, units, matching, AI-result checks, day closing, permissions. 49/49 tests pass, 98.75 % line coverage, `npm run typecheck` clean.
- `apps/api/prisma/schema.prisma`: 23 tables, passes `prisma validate`. **No migration run yet.**

## Blocked on the user (start here tomorrow)
PostgreSQL 18 runs locally (service `postgresql-x64-18`, port 5432). The `postgres` password saved in pgpass.conf is out of date, so Claude cannot connect as superuser and must not ask for or use that password.

The user runs the dev database setup once:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -f apps/api/prisma/setup-dev-db.sql
```

(or pastes that file into pgAdmin's Query Tool). It creates role `erp_dev` and database `shop_erp`. The generated dev password is in that file and in `apps/api/.env`; both are git-ignored.

## Next steps, in order
1. Confirm the user ran the setup script; check with `psql -U erp_dev -h localhost -d shop_erp -c "select 1"` (password comes from `apps/api/.env`).
2. `npm install-scripts approve prisma @prisma/engines`, then `npm run db:migrate --workspace @erp/api -- --name init` (needs `DATABASE_URL` from `apps/api/.env`).
3. Check the tables exist (`\dt` in psql), add the raw SQL migration for row-level security (NFR-SEC-02) and `pg_trgm` index on `product.normalizedName` / `product_alias.normalized`.
4. (done) First commit and push to GitHub.
5. Scaffold the NestJS API in `apps/api` (auth + tenancy first, then scans, confirm transaction using `postDocument`, receipts).

## Open decisions for the owner
- UI language: SRS v1.1 makes Urdu (Nastaliq) + English a v1 Must (matches the prototype). Needs owner confirmation.
- Permission matrix rows marked * in SRS §3.11 are proposed defaults; `packages/domain/src/permissions.ts` follows them.
- Gap analysis against any existing build (SRS A-4) is not done; no existing build has been found.
