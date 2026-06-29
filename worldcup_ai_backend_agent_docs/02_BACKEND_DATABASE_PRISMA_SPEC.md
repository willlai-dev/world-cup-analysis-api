# 02 Backend Database & Prisma Spec

## 目標

建立 Prisma schema，支援使用者、角色、國家隊、球員、賽事、新聞、收藏、AI 報告、冠軍預測、AI 使用紀錄、job run。

## 設計原則

1. 所有主要 model 有 `id`, `createdAt`, `updatedAt`。
2. 外部來源 id 用 `externalId`。
3. AI 結果統一放 `AiReport`。
4. 冠軍預測保留歷史 run，不覆蓋。
5. 收藏表要 unique，避免重複收藏。
6. 常用查詢欄位要 index。
7. structured AI output 用 Json 欄位。
8. raw external payload 可保存 Json，便於 debug。

## Required Enums

```prisma
enum UserRole { USER PREMIUM ADMIN }
enum UserStatus { ACTIVE DISABLED }
enum MatchStatus { SCHEDULED LIVE FINISHED POSTPONED CANCELLED }
enum MatchStage { GROUP ROUND_OF_32 ROUND_OF_16 QUARTER_FINAL SEMI_FINAL THIRD_PLACE FINAL UNKNOWN }
enum PlayerPosition { GK DF MF FW UNKNOWN }
enum RatingTier { S A_PLUS A B_PLUS B C UNKNOWN }
enum TeamRatingTier { S A B C UNKNOWN }
enum PlayerRole { STARTER ROTATION SUBSTITUTE IMPACT_PLAYER UNKNOWN }
enum RiskLevel { LOW MEDIUM HIGH UNKNOWN }
enum NewsTagType { TEAM PLAYER MATCH TOPIC INJURY TACTIC CONTROVERSY TRANSFER OTHER }
enum NewsCategory { MATCH PLAYER INJURY TRANSFER TEAM TACTIC CONTROVERSY TOURNAMENT OTHER }
enum TranslationStatus { NONE PENDING DONE FAILED }
enum AiProvider { NVIDIA QWEN PROGRAM_RULE }
enum AiReportStatus { PENDING DONE FAILED }
enum AiEntityType { MATCH TEAM PLAYER NEWS CHAMPION_PREDICTION GENERAL_CHAT }
enum ChampionPredictionTriggerType { SYSTEM PREMIUM_USER }
enum JobStatus { PENDING RUNNING DONE FAILED }
enum JobType { SYNC_FIXTURES SYNC_RESULTS SYNC_TEAMS SYNC_PLAYERS FETCH_NEWS GENERATE_NEWS_SUMMARY GENERATE_MATCH_ANALYSIS GENERATE_PLAYER_RATINGS GENERATE_CHAMPION_PREDICTIONS }
```

## Core Models 要求

必須建立以下 model。欄位可依實作微調，但不可刪除核心功能所需欄位。

### User

```txt
id
email unique
passwordHash
displayName
role USER/PREMIUM/ADMIN
status ACTIVE/DISABLED
profile relation
favoriteTeams relation
favoritePlayers relation
aiUsageLogs relation
createdAt
updatedAt
```

### UserProfile

```txt
id
userId unique
nickname
avatarUrl
bio
createdAt
updatedAt
```

### Team

```txt
id
externalId
fifaCode unique optional
nameEn
nameZh
continent
groupName
coachName
flagUrl
worldRanking
ratingTier
championScore
formScore
attackScore
midfieldScore
defenseScore
statusScore
createdAt
updatedAt
```

Indexes：nameEn, nameZh, continent, groupName, ratingTier, championScore。

### Player

```txt
id
externalId
teamId
nameEn
nameZh
position
clubName
shirtNumber
ratingTier
overallScore
attackScore
creativityScore
techniqueScore
defenseScore
physicalScore
formScore
role
injuryRiskLevel
createdAt
updatedAt
```

Indexes：teamId, nameEn, nameZh, position, ratingTier, overallScore。

### Match

```txt
id
externalId unique optional
homeTeamId
awayTeamId
winnerTeamId optional
stage
groupName
stadium
kickoffAt
status
homeScore
awayScore
sourceUpdatedAt
rawPayload Json
createdAt
updatedAt
```

Indexes：kickoffAt, status, stage, groupName, homeTeamId, awayTeamId。

### MatchEvent

```txt
id
matchId
minute
extraMinute
eventType
teamId
playerId
relatedPlayerId
description
rawPayload Json
createdAt
```

### NewsArticle

```txt
id
externalId
sourceName
sourceUrl unique
titleEn
titleZh
summaryEn
summaryZh
contentSnippet
publishedAt
fetchedAt
category
language
translatedContentZh
translationStatus
aiSummaryStatus
rawPayload Json
createdAt
updatedAt
```

### NewsTag / NewsArticleTag

NewsTag:

```txt
id
name
type
createdAt
updatedAt
unique(name,type)
```

NewsArticleTag:

```txt
id
newsArticleId
newsTagId
unique(newsArticleId,newsTagId)
```

### FavoriteTeam / FavoritePlayer

```txt
FavoriteTeam: id, userId, teamId, createdAt, unique(userId,teamId)
FavoritePlayer: id, userId, playerId, createdAt, unique(userId,playerId)
```

### AiReport

```txt
id
entityType
entityId optional
reportType string or enum
provider
model
language
title
content
structuredJson Json
confidenceScore
sourceSnapshotHash
inputTokenEstimate
outputTokenEstimate
status
errorMessage
createdAt
updatedAt
```

### ChampionPredictionRun

```txt
id
triggeredByUserId optional
triggerType SYSTEM/PREMIUM_USER
status
nvidiaReportId
qwenReportId
finalReportId
dataSnapshotHash
createdAt
completedAt
```

### ChampionPredictionEntry

```txt
id
runId
teamId
rank
championScore
ratingTier
probabilityText
strengths
risks
aiComment
createdAt
unique(runId,teamId)
```

### AiUsageLog

```txt
id
userId optional
provider
model
taskType
entityType
entityId
requestStatus
inputTokenEstimate
outputTokenEstimate
latencyMs
errorMessage
createdAt
```

### JobRun

```txt
id
jobType
status
startedAt
completedAt
errorMessage
metadata Json
createdAt
updatedAt
```

## Seed Data

`prisma/seed.ts` 必須建立：

1. 初始 Admin。
2. 至少 1 個 Premium user。
3. 至少 1 個一般 user。
4. 4-8 支 Team。
5. 每隊 3-5 位 Player。
6. 5-10 場 Match。
7. 5 篇 NewsArticle。
8. 1 個 ChampionPredictionRun 與 entries。
9. 幾個 AiReport mock。

## Seed Admin Env

```env
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=admin123456
SEED_ADMIN_DISPLAY_NAME=Initial Admin
```

## 驗收指令

```bash
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed
```

## DB 查詢需求

- 依日期/狀態/階段/國家查賽事。
- 依洲別/評級/搜尋查國家。
- 依國家/位置/評級/能力值排序查球員。
- 依分類/標籤/來源/日期查新聞。
- 查使用者收藏。
- 查最新冠軍預測。
- 查某 entity 最新 AiReport。
