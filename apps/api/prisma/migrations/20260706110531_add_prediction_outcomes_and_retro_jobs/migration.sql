-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'GENERATE_RETRO_ANALYSIS';
ALTER TYPE "JobType" ADD VALUE 'SCORE_PREDICTIONS';

-- CreateTable
CREATE TABLE "MatchPredictionOutcome" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "retro" BOOLEAN NOT NULL DEFAULT false,
    "predictedAt" TIMESTAMP(3) NOT NULL,
    "homeWinLean" DOUBLE PRECISION,
    "drawLean" DOUBLE PRECISION,
    "awayWinLean" DOUBLE PRECISION,
    "likelyScorelines" JSONB,
    "actualHomeScore" INTEGER NOT NULL,
    "actualAwayScore" INTEGER NOT NULL,
    "tendencyPredicted" TEXT,
    "tendencyActual" TEXT NOT NULL,
    "tendencyHit" BOOLEAN NOT NULL,
    "exactScoreHit" BOOLEAN NOT NULL,
    "top3ScoreHit" BOOLEAN NOT NULL,
    "brierScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchPredictionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchPredictionOutcome_matchId_key" ON "MatchPredictionOutcome"("matchId");

-- CreateIndex
CREATE INDEX "MatchPredictionOutcome_retro_idx" ON "MatchPredictionOutcome"("retro");

-- CreateIndex
CREATE INDEX "MatchPredictionOutcome_predictedAt_idx" ON "MatchPredictionOutcome"("predictedAt");

-- AddForeignKey
ALTER TABLE "MatchPredictionOutcome" ADD CONSTRAINT "MatchPredictionOutcome_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
