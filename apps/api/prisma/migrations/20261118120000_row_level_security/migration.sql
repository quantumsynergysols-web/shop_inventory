-- NFR-SEC-02: tenant isolation in the database itself (row-level security).
-- The API sets app.shop_id for the transaction of every authenticated request
-- (src/prisma/prisma.service.ts); rows of other shops are then invisible and cannot be written.
-- Without app.shop_id (login, token refresh, seed, migrations, tests' setup) the policies allow all rows.
-- FORCE makes the policies apply to the table owner too, which is the role the API connects as.

ALTER TABLE "shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shop" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "shop"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR id = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR id = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "app_user"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "category"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "product"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "party" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "party" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "party"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "scan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scan" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "scan"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "document"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "stock_movement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movement" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "stock_movement"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "receipt"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "payment"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "ledger_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entry" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "ledger_entry"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "day_closing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "day_closing" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "day_closing"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "expense_head" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_head" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "expense_head"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "expense"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "ai_setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_setting" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "ai_setting"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "ai_call_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_call_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "ai_call_log"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "audit_log"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "doc_counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doc_counter" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "doc_counter"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR "shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid);

ALTER TABLE "product_unit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_unit" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "product_unit"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "product_unit"."productId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "product_unit"."productId"));

ALTER TABLE "product_alias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_alias" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "product_alias"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "product_alias"."productId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "product_alias"."productId"));

ALTER TABLE "price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "price_history"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "price_history"."productId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "product" x WHERE x.id = "price_history"."productId"));

ALTER TABLE "scan_page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scan_page" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "scan_page"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "scan" x WHERE x.id = "scan_page"."scanId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "scan" x WHERE x.id = "scan_page"."scanId"));

ALTER TABLE "scan_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scan_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "scan_line"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "scan" x WHERE x.id = "scan_line"."scanId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "scan" x WHERE x.id = "scan_line"."scanId"));

ALTER TABLE "doc_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doc_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "doc_line"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "document" x WHERE x.id = "doc_line"."documentId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "document" x WHERE x.id = "doc_line"."documentId"));

ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON "session"
  USING (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "app_user" x WHERE x.id = "session"."userId"))
  WITH CHECK (NULLIF(current_setting('app.shop_id', true), '') IS NULL OR EXISTS (SELECT 1 FROM "app_user" x WHERE x.id = "session"."userId"));
