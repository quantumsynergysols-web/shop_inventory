-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'SALESMAN', 'STOREKEEPER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'BOTH');

-- CreateEnum
CREATE TYPE "PriceLevel" AS ENUM ('RETAIL', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('DRAFT', 'QUEUED', 'UPLOADING', 'PROCESSING', 'NEEDS_REVIEW', 'FAILED', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "DocKind" AS ENUM ('PURCHASE', 'SALE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUST_IN', 'ADJUST_OUT', 'OPENING', 'VOID');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('POSTED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('UNPAID', 'PART_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PayMode" AS ENUM ('CASH', 'BANK', 'JAZZCASH', 'EASYPAISA');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "MoveType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('OPEN', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "shop" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "ntn" TEXT,
    "logoKey" TEXT,
    "receiptFooter" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "aiConsentAt" TIMESTAMP(3),
    "photoRetentionDays" INTEGER NOT NULL DEFAULT 1825,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "categoryId" UUID,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL DEFAULT 'pcs',
    "purchasePricePaisa" BIGINT NOT NULL DEFAULT 0,
    "salePricePaisa" BIGINT NOT NULL DEFAULT 0,
    "wholesalePricePaisa" BIGINT,
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockValuePaisa" BIGINT NOT NULL DEFAULT 0,
    "lastUnitCostPaisa" BIGINT NOT NULL DEFAULT 0,
    "minLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit" (
    "productId" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "factorToBase" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "product_unit_pkey" PRIMARY KEY ("productId","unit")
);

-- CreateTable
CREATE TABLE "product_alias" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "partyId" UUID,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "documentId" UUID,
    "type" "PriceType" NOT NULL,
    "oldPricePaisa" BIGINT NOT NULL,
    "newPricePaisa" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "type" "PartyType" NOT NULL,
    "priceLevel" "PriceLevel" NOT NULL DEFAULT 'RETAIL',
    "openingBalancePaisa" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ScanType" NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "readTotalPaisa" BIGINT,
    "partyNameRead" TEXT,
    "billNoRead" TEXT,
    "billDateRead" DATE,
    "checkFlags" TEXT[],
    "missingSerials" INTEGER[],
    "failureReason" TEXT,
    "documentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_page" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "imageKey" TEXT NOT NULL,
    "originalKey" TEXT,
    "phash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_line" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "serialNo" INTEGER,
    "page" INTEGER NOT NULL,
    "rawName" TEXT NOT NULL,
    "qty" DECIMAL(14,3),
    "unit" TEXT,
    "ratePaisa" BIGINT,
    "lineTotalPaisa" BIGINT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "bbox" JSONB,
    "productId" UUID,
    "matchScore" DOUBLE PRECISION,
    "matchStatus" TEXT,
    "flags" TEXT[],
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "scan_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "kind" "DocKind" NOT NULL,
    "docNo" TEXT NOT NULL,
    "docDate" DATE NOT NULL,
    "partyId" UUID,
    "createdById" UUID NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'POSTED',
    "payStatus" "PayStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotalPaisa" BIGINT NOT NULL,
    "discountPaisa" BIGINT NOT NULL DEFAULT 0,
    "taxPaisa" BIGINT NOT NULL DEFAULT 0,
    "totalPaisa" BIGINT NOT NULL,
    "paidPaisa" BIGINT NOT NULL DEFAULT 0,
    "cogsPaisa" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT,
    "voidsDocId" UUID,
    "returnOfDocId" UUID,
    "idempotencyKey" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_line" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "ratePaisa" BIGINT NOT NULL,
    "discountPaisa" BIGINT NOT NULL DEFAULT 0,
    "amountPaisa" BIGINT NOT NULL,

    CONSTRAINT "doc_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "docLineId" UUID NOT NULL,
    "type" "MoveType" NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "valuePaisa" BIGINT NOT NULL,
    "unitCostPaisa" BIGINT NOT NULL,
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "documentId" UUID,
    "direction" "PaymentDirection" NOT NULL,
    "amountPaisa" BIGINT NOT NULL,
    "mode" "PayMode" NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "documentId" UUID,
    "paymentId" UUID,
    "partyId" UUID,
    "account" TEXT NOT NULL,
    "debitPaisa" BIGINT NOT NULL DEFAULT 0,
    "creditPaisa" BIGINT NOT NULL DEFAULT 0,
    "entryDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closing" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'OPEN',
    "openingCashPaisa" BIGINT NOT NULL DEFAULT 0,
    "billCount" INTEGER NOT NULL DEFAULT 0,
    "salesTotalPaisa" BIGINT NOT NULL DEFAULT 0,
    "salesCashPaisa" BIGINT NOT NULL DEFAULT 0,
    "salesBankPaisa" BIGINT NOT NULL DEFAULT 0,
    "salesCreditPaisa" BIGINT NOT NULL DEFAULT 0,
    "cogsPaisa" BIGINT NOT NULL DEFAULT 0,
    "grossProfitPaisa" BIGINT NOT NULL DEFAULT 0,
    "expensesTotalPaisa" BIGINT NOT NULL DEFAULT 0,
    "netProfitPaisa" BIGINT NOT NULL DEFAULT 0,
    "purchasesTotalPaisa" BIGINT NOT NULL DEFAULT 0,
    "wasooliCashPaisa" BIGINT NOT NULL DEFAULT 0,
    "wasooliBankPaisa" BIGINT NOT NULL DEFAULT 0,
    "supplierPaidCashPaisa" BIGINT NOT NULL DEFAULT 0,
    "supplierPaidBankPaisa" BIGINT NOT NULL DEFAULT 0,
    "cashRefundsPaisa" BIGINT NOT NULL DEFAULT 0,
    "expectedCashPaisa" BIGINT NOT NULL DEFAULT 0,
    "countedCashPaisa" BIGINT,
    "differencePaisa" BIGINT,
    "note" TEXT,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),
    "reopenReason" TEXT,

    CONSTRAINT "day_closing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_head" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "headId" UUID NOT NULL,
    "amountPaisa" BIGINT NOT NULL,
    "paidFrom" "PayMode" NOT NULL,
    "note" TEXT,
    "photoKey" TEXT,
    "userId" UUID NOT NULL,
    "dayClosingId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_setting" (
    "shopId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'hosted',
    "model" TEXT,
    "apiKeyEnc" BYTEA,
    "apiKeyLast4" TEXT,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "monthlyScanQuota" INTEGER,

    CONSTRAINT "ai_setting_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "ai_call_log" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "pageNo" INTEGER,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costMicroUsd" BIGINT NOT NULL,
    "ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_counter" (
    "shopId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "doc_counter_pkey" PRIMARY KEY ("shopId","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_shopId_idx" ON "app_user"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokenHash_key" ON "session"("tokenHash");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "category_shopId_name_key" ON "category"("shopId", "name");

-- CreateIndex
CREATE INDEX "product_shopId_normalizedName_idx" ON "product"("shopId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "product_shopId_sku_key" ON "product"("shopId", "sku");

-- CreateIndex
CREATE INDEX "product_alias_normalized_idx" ON "product_alias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "product_alias_productId_normalized_partyId_key" ON "product_alias"("productId", "normalized", "partyId");

-- CreateIndex
CREATE INDEX "price_history_productId_at_idx" ON "price_history"("productId", "at");

-- CreateIndex
CREATE INDEX "party_shopId_normalizedName_idx" ON "party"("shopId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "scan_documentId_key" ON "scan"("documentId");

-- CreateIndex
CREATE INDEX "scan_shopId_status_idx" ON "scan"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scan_shopId_clientId_key" ON "scan"("shopId", "clientId");

-- CreateIndex
CREATE INDEX "scan_page_phash_idx" ON "scan_page"("phash");

-- CreateIndex
CREATE UNIQUE INDEX "scan_page_scanId_pageNo_key" ON "scan_page"("scanId", "pageNo");

-- CreateIndex
CREATE INDEX "scan_line_scanId_idx" ON "scan_line"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "document_voidsDocId_key" ON "document"("voidsDocId");

-- CreateIndex
CREATE INDEX "document_shopId_docDate_idx" ON "document"("shopId", "docDate");

-- CreateIndex
CREATE UNIQUE INDEX "document_shopId_kind_docNo_key" ON "document"("shopId", "kind", "docNo");

-- CreateIndex
CREATE UNIQUE INDEX "document_shopId_idempotencyKey_key" ON "document"("shopId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "doc_line_documentId_lineNo_key" ON "doc_line"("documentId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_docLineId_key" ON "stock_movement"("docLineId");

-- CreateIndex
CREATE INDEX "stock_movement_productId_at_idx" ON "stock_movement"("productId", "at");

-- CreateIndex
CREATE INDEX "stock_movement_shopId_at_idx" ON "stock_movement"("shopId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_documentId_key" ON "receipt"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_shopId_receiptNo_key" ON "receipt"("shopId", "receiptNo");

-- CreateIndex
CREATE INDEX "payment_shopId_paidOn_idx" ON "payment"("shopId", "paidOn");

-- CreateIndex
CREATE INDEX "payment_partyId_idx" ON "payment"("partyId");

-- CreateIndex
CREATE INDEX "ledger_entry_shopId_account_entryDate_idx" ON "ledger_entry"("shopId", "account", "entryDate");

-- CreateIndex
CREATE INDEX "ledger_entry_partyId_idx" ON "ledger_entry"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "day_closing_shopId_businessDate_key" ON "day_closing"("shopId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "expense_head_shopId_name_key" ON "expense_head"("shopId", "name");

-- CreateIndex
CREATE INDEX "expense_shopId_businessDate_idx" ON "expense"("shopId", "businessDate");

-- CreateIndex
CREATE INDEX "ai_call_log_shopId_createdAt_idx" ON "ai_call_log"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_shopId_at_idx" ON "audit_log"("shopId", "at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit" ADD CONSTRAINT "product_unit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party" ADD CONSTRAINT "party_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan" ADD CONSTRAINT "scan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan" ADD CONSTRAINT "scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan" ADD CONSTRAINT "scan_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_page" ADD CONSTRAINT "scan_page_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_line" ADD CONSTRAINT "scan_line_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_line" ADD CONSTRAINT "scan_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_voidsDocId_fkey" FOREIGN KEY ("voidsDocId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_returnOfDocId_fkey" FOREIGN KEY ("returnOfDocId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_line" ADD CONSTRAINT "doc_line_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_line" ADD CONSTRAINT "doc_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_docLineId_fkey" FOREIGN KEY ("docLineId") REFERENCES "doc_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closing" ADD CONSTRAINT "day_closing_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closing" ADD CONSTRAINT "day_closing_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_head" ADD CONSTRAINT "expense_head_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_headId_fkey" FOREIGN KEY ("headId") REFERENCES "expense_head"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_dayClosingId_fkey" FOREIGN KEY ("dayClosingId") REFERENCES "day_closing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_setting" ADD CONSTRAINT "ai_setting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_counter" ADD CONSTRAINT "doc_counter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
