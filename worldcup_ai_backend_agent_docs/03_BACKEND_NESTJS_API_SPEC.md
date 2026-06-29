# 03 Backend NestJS API Spec

## 技術要求

- NestJS。
- Fastify Adapter。
- Prisma。
- PostgreSQL。
- TypeScript strict。
- Swagger/OpenAPI。
- DTO validation。
- bcrypt 或 argon2。
- Jest + Supertest。

## main.ts 要求

- 使用 FastifyAdapter。
- CORS 只允許 `FRONTEND_URL`。
- credentials true。
- ValidationPipe：whitelist, transform, forbidNonWhitelisted。
- Global exception filter。
- Response envelope interceptor。
- Swagger docs。
- **必須設定 global prefix `/api`**，前端 `NEXT_PUBLIC_BACKEND_API_URL` 預設為 `http://localhost:3000/api`。不要做成可選。

## Backend Modules

```txt
ConfigModule
PrismaModule
AuthModule
UsersModule
AdminModule
MatchesModule
TeamsModule
PlayersModule
FavoritesModule
ChampionPredictionModule
NewsModule
HomeModule
AiModule
JobsModule
SourcesModule
HealthModule
```

## Common API Contract

All application endpoints are served under `/api`.

Example frontend base URL:

```env
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3000/api
```

All successful responses must use this envelope:

```ts
export type ApiSuccess<T> = {
  data: T;
  meta?: Record<string, unknown>;
  error: null;
};
```

All error responses must use this envelope:

```ts
export type ApiError = {
  data: null;
  meta?: Record<string, unknown>;
  error: { code: string; message: string; details?: unknown };
};
```

Paginated list endpoints must return the array in `data` and pagination in `meta.pagination`:

```ts
type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
```

Example:

```json
{
  "data": [],
  "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } },
  "error": null
}
```


## Home API

Public. Used by `/`.

```txt
GET /home/highlights
```

Response `data` shape:

```ts
type HomeHighlightsResponse = {
  featuredMatches: MatchSummary[];
  championSummary: ChampionPredictionEntrySummary[];
  featuredTeams: TeamSummary[];
  featuredPlayers: PlayerSummary[];
  newsHighlights: NewsSummary[];
};
```

If there is no data yet, return empty arrays rather than 404.

## Auth API

### POST /auth/register

Request:

```json
{ "email": "user@example.com", "password": "password123", "displayName": "User" }
```

Rules:

- 建立 USER。
- 不接受 role input。
- email unique。
- password hash。

### POST /auth/login

Request:

```json
{ "email": "user@example.com", "password": "password123" }
```

Response:

```json
{
  "data": {
    "user": { "id": "...", "email": "...", "displayName": "...", "role": "USER", "status": "ACTIVE" },
    "redirectPath": "/matches"
  },
  "error": null
}
```

Admin redirectPath = `/admin/accounts`。

### POST /auth/logout

清除 cookie/session。

### GET /auth/me

回目前登入使用者，不回 passwordHash。

## Admin API

All ADMIN only。

```txt
GET    /admin/users
POST   /admin/users
PATCH  /admin/users/:userId/role
DELETE /admin/users/:userId
POST   /admin/register-admin
```

`GET /admin/users` query：page, pageSize, search, role, status。

`POST /admin/users` 可建立 USER/PREMIUM/ADMIN。

建議保護：避免刪除最後一個 Admin；避免 Admin 刪除自己。

## Users API

USER/PREMIUM only，ADMIN forbidden。

```txt
GET   /users/me
PATCH /users/me
GET   /users/me/favorites
```

PATCH 只能改 displayName、nickname、avatarUrl、bio，不可改 role。

## Matches API

USER/PREMIUM only，ADMIN forbidden。

```txt
GET /matches
GET /matches/today
GET /matches/:matchId
GET /matches/:matchId/analysis
GET /matches/:matchId/prediction
GET /matches/:matchId/post-match-report
POST /matches/:matchId/deep-chat    # PREMIUM only
```

`GET /matches` query：page, pageSize, status, stage, dateFrom, dateTo, teamId, groupName。

## Teams API

```txt
GET /teams
GET /teams/:teamId
GET /teams/:teamId/players
GET /teams/:teamId/matches
GET /teams/:teamId/analysis
POST /teams/:teamId/deep-chat       # PREMIUM only
```

Query：page, pageSize, search, continent, ratingTier, sortBy, sortOrder。

## Players API

```txt
GET /players
GET /players/:playerId
GET /players/:playerId/rating
GET /players/:playerId/analysis
POST /players/:playerId/deep-chat   # PREMIUM only
```

Query：page, pageSize, search, teamId, position, ratingTier, sortBy, sortOrder。

## Favorites API

USER/PREMIUM only，ADMIN forbidden。

```txt
GET    /users/me/favorites
POST   /favorites/teams/:teamId
DELETE /favorites/teams/:teamId
POST   /favorites/players/:playerId
DELETE /favorites/players/:playerId
```

Rules：

- 重複收藏 idempotent。
- 取消不存在收藏可回 success，但需一致。

## Champion Prediction API

```txt
GET  /champion-predictions
GET  /champion-predictions/latest
POST /champion-predictions/recalculate   # PREMIUM only
POST /champion-predictions/deep-chat     # PREMIUM only
```

`recalculate` 建議回 runId 與 RUNNING/DONE status。

## News API

```txt
GET  /news
GET  /news/:newsId
POST /news/:newsId/translate       # PREMIUM only
POST /news/:newsId/deep-chat       # PREMIUM only
```

Query：page, pageSize, category, tag, teamId, playerId, sourceName, dateFrom, dateTo。

## AI Chat API

USER/PREMIUM only，ADMIN forbidden。

```txt
POST /ai/chat
```

Request：

```json
{ "question": "目前冠軍預測前三名是誰？" }
```

Response：

```json
{
  "data": {
    "answer": "...",
    "provider": "NVIDIA",
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "sourceUpdatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

## Jobs API

所有 `/jobs/*` 需要 header：

```txt
x-cron-secret: <CRON_SECRET>
```

Endpoints：

```txt
POST /jobs/sync-fixtures
POST /jobs/sync-results
POST /jobs/sync-teams
POST /jobs/sync-players
POST /jobs/fetch-news
POST /jobs/generate-news-summary
POST /jobs/generate-match-analysis
POST /jobs/generate-player-ratings
POST /jobs/generate-champion-predictions
```

## Health API

```txt
GET /health
GET /health/db
```

`/health` public。


## Required Response DTO Shapes

Backend may include extra fields, but must not remove these fields because frontend pages depend on them.

```ts
type UserDto = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'PREMIUM' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
};

type TeamSummary = {
  id: string;
  nameEn: string;
  nameZh?: string | null;
  fifaCode?: string | null;
  continent?: string | null;
  groupName?: string | null;
  coachName?: string | null;
  flagUrl?: string | null;
  ratingTier?: 'S' | 'A' | 'B' | 'C' | 'UNKNOWN';
  championScore?: number | null;
  formScore?: number | null;
  attackScore?: number | null;
  midfieldScore?: number | null;
  defenseScore?: number | null;
  statusScore?: number | null;
};

type PlayerSummary = {
  id: string;
  teamId: string;
  team?: TeamSummary;
  nameEn: string;
  nameZh?: string | null;
  position: 'GK' | 'DF' | 'MF' | 'FW' | 'UNKNOWN';
  clubName?: string | null;
  shirtNumber?: number | null;
  ratingTier?: 'S' | 'A_PLUS' | 'A' | 'B_PLUS' | 'B' | 'C' | 'UNKNOWN';
  overallScore?: number | null;
  attackScore?: number | null;
  creativityScore?: number | null;
  techniqueScore?: number | null;
  defenseScore?: number | null;
  physicalScore?: number | null;
  formScore?: number | null;
  role?: 'STARTER' | 'ROTATION' | 'SUBSTITUTE' | 'IMPACT_PLAYER' | 'UNKNOWN';
  injuryRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
};

type MatchSummary = {
  id: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  stage: string;
  groupName?: string | null;
  stadium?: string | null;
  kickoffAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  homeScore?: number | null;
  awayScore?: number | null;
  sourceUpdatedAt?: string | null;
  aiSummary?: string | null;
};

type AiReportDto = {
  id: string;
  entityType: string;
  entityId?: string | null;
  reportType: string;
  provider: 'NVIDIA' | 'QWEN' | 'PROGRAM_RULE';
  model?: string | null;
  language: string;
  title?: string | null;
  content?: string | null;
  structuredJson?: unknown;
  confidenceScore?: number | null;
  status: 'PENDING' | 'DONE' | 'FAILED';
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

type MatchPredictionDto = {
  matchId: string;
  homeWinProbability?: number | null;
  drawProbability?: number | null;
  awayWinProbability?: number | null;
  keyFactors: string[];
  riskNotes: string[];
  report?: AiReportDto | null;
  sourceUpdatedAt?: string | null;
};

type NewsSummary = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  titleEn: string;
  titleZh?: string | null;
  summaryEn?: string | null;
  summaryZh?: string | null;
  publishedAt?: string | null;
  category?: string | null;
  tags?: { id: string; name: string; type: string }[];
  translationStatus?: 'NONE' | 'PENDING' | 'DONE' | 'FAILED';
};

type ChampionPredictionEntrySummary = {
  id: string;
  team: TeamSummary;
  rank: number;
  championScore: number;
  ratingTier?: 'S' | 'A' | 'B' | 'C' | 'UNKNOWN';
  probabilityText?: string | null;
  strengths: string[];
  risks: string[];
  aiComment?: string | null;
};

type ChampionPredictionResponse = {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  createdAt: string;
  completedAt?: string | null;
  entries: ChampionPredictionEntrySummary[];
  finalReport?: AiReportDto | null;
  nvidiaReport?: AiReportDto | null;
  qwenReport?: AiReportDto | null;
};

type ChatAnswerDto = {
  answer: string;
  provider: 'NVIDIA' | 'QWEN' | 'PROGRAM_RULE';
  model?: string | null;
  sourceUpdatedAt?: string | null;
};
```

## Guard 要求

- JwtAuthGuard。
- RolesGuard。
- AdminOnlyGuard。
- PremiumOnlyGuard。
- NonAdminUserGuard。
- CronSecretGuard。

## 測試要求

E2E 必含：

1. Guest `/matches` -> 401。
2. USER `/matches` -> 200。
3. ADMIN `/matches` -> 403。
4. USER `/admin/users` -> 403。
5. ADMIN `/admin/users` -> 200。
6. USER `/news/:id/translate` -> 403。
7. PREMIUM `/news/:id/translate` -> 200/mock。
8. ADMIN `/ai/chat` -> 403。
9. cron secret 錯誤 -> 401。
10. favorite duplicate 不產生重複。
