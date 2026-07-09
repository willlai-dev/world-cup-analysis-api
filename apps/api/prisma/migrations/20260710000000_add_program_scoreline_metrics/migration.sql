-- AlterTable
ALTER TABLE "MatchPredictionOutcome" ADD COLUMN     "programScorelines" JSONB,
ADD COLUMN     "programExactScoreHit" BOOLEAN,
ADD COLUMN     "programTop3ScoreHit" BOOLEAN;
