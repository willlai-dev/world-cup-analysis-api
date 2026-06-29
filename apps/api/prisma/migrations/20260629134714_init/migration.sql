-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PREMIUM', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStage" AS ENUM ('GROUP', 'ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'THIRD_PLACE', 'FINAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PlayerPosition" AS ENUM ('GK', 'DF', 'MF', 'FW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RatingTier" AS ENUM ('S', 'A_PLUS', 'A', 'B_PLUS', 'B', 'C', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TeamRatingTier" AS ENUM ('S', 'A', 'B', 'C', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PlayerRole" AS ENUM ('STARTER', 'ROTATION', 'SUBSTITUTE', 'IMPACT_PLAYER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NewsTagType" AS ENUM ('TEAM', 'PLAYER', 'MATCH', 'TOPIC', 'INJURY', 'TACTIC', 'CONTROVERSY', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('MATCH', 'PLAYER', 'INJURY', 'TRANSFER', 'TEAM', 'TACTIC', 'CONTROVERSY', 'TOURNAMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('NVIDIA', 'QWEN', 'PROGRAM_RULE');

-- CreateEnum
CREATE TYPE "AiReportStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AiEntityType" AS ENUM ('MATCH', 'TEAM', 'PLAYER', 'NEWS', 'CHAMPION_PREDICTION', 'GENERAL_CHAT');

-- CreateEnum
CREATE TYPE "ChampionPredictionTriggerType" AS ENUM ('SYSTEM', 'PREMIUM_USER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SYNC_FIXTURES', 'SYNC_RESULTS', 'SYNC_TEAMS', 'SYNC_PLAYERS', 'FETCH_NEWS', 'GENERATE_NEWS_SUMMARY', 'GENERATE_MATCH_ANALYSIS', 'GENERATE_PLAYER_RATINGS', 'GENERATE_CHAMPION_PREDICTIONS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "fifaCode" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT,
    "continent" TEXT,
    "groupName" TEXT,
    "coachName" TEXT,
    "flagUrl" TEXT,
    "worldRanking" INTEGER,
    "ratingTier" "TeamRatingTier" NOT NULL DEFAULT 'UNKNOWN',
    "championScore" DOUBLE PRECISION,
    "formScore" DOUBLE PRECISION,
    "attackScore" DOUBLE PRECISION,
    "midfieldScore" DOUBLE PRECISION,
    "defenseScore" DOUBLE PRECISION,
    "statusScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "teamId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT,
    "position" "PlayerPosition" NOT NULL DEFAULT 'UNKNOWN',
    "clubName" TEXT,
    "shirtNumber" INTEGER,
    "ratingTier" "RatingTier" NOT NULL DEFAULT 'UNKNOWN',
    "overallScore" DOUBLE PRECISION,
    "attackScore" DOUBLE PRECISION,
    "creativityScore" DOUBLE PRECISION,
    "techniqueScore" DOUBLE PRECISION,
    "defenseScore" DOUBLE PRECISION,
    "physicalScore" DOUBLE PRECISION,
    "formScore" DOUBLE PRECISION,
    "role" "PlayerRole" NOT NULL DEFAULT 'UNKNOWN',
    "injuryRiskLevel" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "winnerTeamId" TEXT,
    "stage" "MatchStage" NOT NULL DEFAULT 'UNKNOWN',
    "groupName" TEXT,
    "stadium" TEXT,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "minute" INTEGER,
    "extraMinute" INTEGER,
    "eventType" TEXT NOT NULL,
    "teamId" TEXT,
    "playerId" TEXT,
    "relatedPlayerId" TEXT,
    "description" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleZh" TEXT,
    "summaryEn" TEXT,
    "summaryZh" TEXT,
    "contentSnippet" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "category" "NewsCategory",
    "language" TEXT,
    "translatedContentZh" TEXT,
    "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'NONE',
    "aiSummaryStatus" "AiReportStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NewsTagType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticleTag" (
    "id" TEXT NOT NULL,
    "newsArticleId" TEXT NOT NULL,
    "newsTagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsArticleTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteTeam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoritePlayer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoritePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReport" (
    "id" TEXT NOT NULL,
    "entityType" "AiEntityType" NOT NULL,
    "entityId" TEXT,
    "reportType" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh-TW',
    "title" TEXT,
    "content" TEXT,
    "structuredJson" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "sourceSnapshotHash" TEXT,
    "inputTokenEstimate" INTEGER,
    "outputTokenEstimate" INTEGER,
    "status" "AiReportStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT,
    "taskType" TEXT NOT NULL,
    "entityType" "AiEntityType",
    "entityId" TEXT,
    "requestStatus" "AiReportStatus" NOT NULL DEFAULT 'PENDING',
    "inputTokenEstimate" INTEGER,
    "outputTokenEstimate" INTEGER,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionPredictionRun" (
    "id" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "triggerType" "ChampionPredictionTriggerType" NOT NULL DEFAULT 'SYSTEM',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "nvidiaReportId" TEXT,
    "qwenReportId" TEXT,
    "finalReportId" TEXT,
    "dataSnapshotHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChampionPredictionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionPredictionEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "championScore" DOUBLE PRECISION NOT NULL,
    "ratingTier" "TeamRatingTier" NOT NULL DEFAULT 'UNKNOWN',
    "probabilityText" TEXT,
    "strengths" TEXT[],
    "risks" TEXT[],
    "aiComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChampionPredictionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_fifaCode_key" ON "Team"("fifaCode");

-- CreateIndex
CREATE INDEX "Team_nameEn_idx" ON "Team"("nameEn");

-- CreateIndex
CREATE INDEX "Team_nameZh_idx" ON "Team"("nameZh");

-- CreateIndex
CREATE INDEX "Team_continent_idx" ON "Team"("continent");

-- CreateIndex
CREATE INDEX "Team_groupName_idx" ON "Team"("groupName");

-- CreateIndex
CREATE INDEX "Team_ratingTier_idx" ON "Team"("ratingTier");

-- CreateIndex
CREATE INDEX "Team_championScore_idx" ON "Team"("championScore");

-- CreateIndex
CREATE INDEX "Player_teamId_idx" ON "Player"("teamId");

-- CreateIndex
CREATE INDEX "Player_nameEn_idx" ON "Player"("nameEn");

-- CreateIndex
CREATE INDEX "Player_nameZh_idx" ON "Player"("nameZh");

-- CreateIndex
CREATE INDEX "Player_position_idx" ON "Player"("position");

-- CreateIndex
CREATE INDEX "Player_ratingTier_idx" ON "Player"("ratingTier");

-- CreateIndex
CREATE INDEX "Player_overallScore_idx" ON "Player"("overallScore");

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");

-- CreateIndex
CREATE INDEX "Match_kickoffAt_idx" ON "Match"("kickoffAt");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_stage_idx" ON "Match"("stage");

-- CreateIndex
CREATE INDEX "Match_groupName_idx" ON "Match"("groupName");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_idx" ON "Match"("homeTeamId");

-- CreateIndex
CREATE INDEX "Match_awayTeamId_idx" ON "Match"("awayTeamId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_sourceUrl_key" ON "NewsArticle"("sourceUrl");

-- CreateIndex
CREATE INDEX "NewsArticle_category_idx" ON "NewsArticle"("category");

-- CreateIndex
CREATE INDEX "NewsArticle_sourceName_idx" ON "NewsArticle"("sourceName");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsTag_name_type_key" ON "NewsTag"("name", "type");

-- CreateIndex
CREATE INDEX "NewsArticleTag_newsTagId_idx" ON "NewsArticleTag"("newsTagId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticleTag_newsArticleId_newsTagId_key" ON "NewsArticleTag"("newsArticleId", "newsTagId");

-- CreateIndex
CREATE INDEX "FavoriteTeam_teamId_idx" ON "FavoriteTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteTeam_userId_teamId_key" ON "FavoriteTeam"("userId", "teamId");

-- CreateIndex
CREATE INDEX "FavoritePlayer_playerId_idx" ON "FavoritePlayer"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoritePlayer_userId_playerId_key" ON "FavoritePlayer"("userId", "playerId");

-- CreateIndex
CREATE INDEX "AiReport_entityType_entityId_idx" ON "AiReport"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AiReport_reportType_idx" ON "AiReport"("reportType");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_idx" ON "AiUsageLog"("userId");

-- CreateIndex
CREATE INDEX "AiUsageLog_taskType_idx" ON "AiUsageLog"("taskType");

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChampionPredictionRun_status_idx" ON "ChampionPredictionRun"("status");

-- CreateIndex
CREATE INDEX "ChampionPredictionRun_createdAt_idx" ON "ChampionPredictionRun"("createdAt");

-- CreateIndex
CREATE INDEX "ChampionPredictionEntry_runId_idx" ON "ChampionPredictionEntry"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionPredictionEntry_runId_teamId_key" ON "ChampionPredictionEntry"("runId", "teamId");

-- CreateIndex
CREATE INDEX "JobRun_jobType_idx" ON "JobRun"("jobType");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleTag" ADD CONSTRAINT "NewsArticleTag_newsArticleId_fkey" FOREIGN KEY ("newsArticleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleTag" ADD CONSTRAINT "NewsArticleTag_newsTagId_fkey" FOREIGN KEY ("newsTagId") REFERENCES "NewsTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteTeam" ADD CONSTRAINT "FavoriteTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteTeam" ADD CONSTRAINT "FavoriteTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePlayer" ADD CONSTRAINT "FavoritePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePlayer" ADD CONSTRAINT "FavoritePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionPredictionRun" ADD CONSTRAINT "ChampionPredictionRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionPredictionEntry" ADD CONSTRAINT "ChampionPredictionEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChampionPredictionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionPredictionEntry" ADD CONSTRAINT "ChampionPredictionEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
