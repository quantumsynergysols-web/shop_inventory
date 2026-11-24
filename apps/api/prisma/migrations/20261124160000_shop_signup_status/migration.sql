-- Online sign-up with approval: a shop is ACTIVE (existing shops, desktop setup), PENDING (waiting
-- for QSSols) or REJECTED.
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'PENDING', 'REJECTED');
ALTER TABLE "shop" ADD COLUMN "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "shop" ADD COLUMN "signup" JSONB;
