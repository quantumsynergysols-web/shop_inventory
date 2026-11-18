-- FR-SCAN-09: keep the exact file hash in its own column; phash now holds a perceptual hash.
ALTER TABLE "scan_page" ADD COLUMN "sha256" TEXT;
UPDATE "scan_page" SET "sha256" = "phash", "phash" = NULL;
DROP INDEX IF EXISTS "scan_page_phash_idx";
CREATE INDEX "scan_page_sha256_idx" ON "scan_page"("sha256");
