-- Fuzzy product search with typo tolerance (FR-PRD-02, FR-REV-04, UML diagram 08).
-- pg_trgm is a trusted extension, so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "product_normalizedName_trgm_idx" ON "product" USING GIN ("normalizedName" gin_trgm_ops);
CREATE INDEX "product_alias_normalized_trgm_idx" ON "product_alias" USING GIN ("normalized" gin_trgm_ops);
CREATE INDEX "party_normalizedName_trgm_idx" ON "party" USING GIN ("normalizedName" gin_trgm_ops);
