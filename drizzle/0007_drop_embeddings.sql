ALTER TABLE "ingested_items" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "clusters" DROP COLUMN IF EXISTS "centroid_embedding";
