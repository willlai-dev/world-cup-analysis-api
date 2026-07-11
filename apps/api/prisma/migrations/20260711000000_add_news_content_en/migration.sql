-- Full plain-text article body (Guardian only) so translation can cover the
-- whole article instead of the trail-text snippet.
ALTER TABLE "NewsArticle" ADD COLUMN "contentEn" TEXT;
