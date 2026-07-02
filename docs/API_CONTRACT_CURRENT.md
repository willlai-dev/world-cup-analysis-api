# API_CONTRACT_CURRENT

This document describes the API that is actually implemented today in `apps/api`.

- Generated from source-code scan on 2026-06-30.
- This is a read-only contract for a Next.js frontend agent.
- Do not infer hidden routes, hidden fields, or future behavior.
- If something is not stated here, assume it is not safe to use from the frontend.

## 1. Project API Overview

| Item                                    | Current implementation                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project name                            | AI World Cup Analyst - Backend (Phase 1)                                                                                                               |
| Backend framework                       | NestJS 11 on Fastify                                                                                                                                   |
| Global prefix                           | Yes. Code reads `API_GLOBAL_PREFIX`; current env and default are both `api`. All application API routes below assume `/api`.                           |
| Local base URL                          | `http://localhost:3000/api`                                                                                                                            |
| Production base URL                     | Frontend should supply this via `NEXT_PUBLIC_BACKEND_API_URL`. This repo does not hardcode a production public URL.                                    |
| Frontend credentials requirement        | Yes for any browser request that must send or receive the auth cookie. Safe default: use `credentials: "include"` for browser calls to this backend.   |
| Auth mechanism                          | JWT stored in HttpOnly cookie `access_token`. No server-side session store is implemented.                                                             |
| Cookie settings                         | `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `secure: false` in development, `secure: true` in production.                                        |
| Current frontend origin allowed by CORS | `http://localhost:3001` from current `FRONTEND_URL` env                                                                                                |
| CORS summary                            | `enableCors({ origin: config.frontendUrl, credentials: true })`. Only one configured frontend origin is allowed.                                       |
| Swagger UI                              | `/docs`                                                                                                                                                |
| OpenAPI JSON                            | `IMPLEMENTATION_UNCLEAR` - not explicitly configured in code. Nest default may expose `/docs-json`, but this should be verified at runtime before use. |

Additional auth notes:

- All non-`@Public()` routes are protected by a global JWT cookie guard.
- The cookie is HttpOnly, so frontend code cannot read it directly.
- `GET /api/auth/me` is not public.
- `POST /api/auth/logout` is not public.

## 2. Frontend Calling Rules

- Frontend may call only the product API routes listed in section 5.
- Frontend must not call NVIDIA, Qwen, football-data, GDELT, RSS, Guardian, News API, or any other third-party provider directly.
- Frontend must not store or ship any API key.
- Because auth is cookie-based, browser requests that must send or receive auth state must use `credentials: "include"`.
- If `GET /api/auth/me` returns `401`, treat the viewer as Guest.
- If login succeeds, honor `data.redirectPath`. Current backend behavior is `ADMIN -> /admin/accounts`, `USER/PREMIUM -> /matches`.
- `ADMIN` accounts must not be routed into general user product pages. The backend returns `403` on user-domain APIs guarded by `NonAdminUserGuard`.
- `USER` accounts must not call PREMIUM-only routes. The backend returns `403` with `error.code = "FORBIDDEN"` on those routes.
- Product UI must not call backend-only routes such as `/api/jobs/*`, `/api/health`, `/api/health/db`, `/docs`, and `IMPLEMENTATION_UNCLEAR: /docs-json`.
- Do not build frontend logic on `error.message`. Messages are mixed Chinese/English and should be treated as display text only. Use `error.code` for programmatic handling.
- Request validation is strict. Global `ValidationPipe` is configured with `whitelist: true`, `transform: true`, and `forbidNonWhitelisted: true`. Do not send speculative request fields.

PREMIUM-only product routes currently implemented:

- `POST /api/matches/:matchId/deep-chat`
- `POST /api/teams/:teamId/deep-chat`
- `POST /api/players/:playerId/deep-chat`
- `POST /api/news/:newsId/translate`
- `POST /api/news/:newsId/deep-chat`
- `POST /api/champion-predictions/recalculate`
- `POST /api/champion-predictions/deep-chat`

## 3. Response Envelope

Actual global success envelope:

```ts
type ApiSuccess<T> = {
  data: T;
  meta?: Record<string, unknown>;
  error: null;
};
```

Actual global error envelope:

```ts
type ApiError = {
  data: null;
  meta?: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

Pagination envelope used by paginated list endpoints:

```ts
type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type PaginatedSuccess<T> = {
  data: T;
  meta: {
    pagination: PaginationMeta;
  };
  error: null;
};
```

Current implementation details:

- Non-paginated success responses usually omit `meta` entirely.
- Error responses currently send `meta: {}`.
- A successful response can still be `{ data: null, error: null }`. This is used when an endpoint intentionally has no current result, for example a missing AI report or no champion-prediction run yet.
- Validation failures become `400 BAD_REQUEST` and may include the original validator messages array inside `error.details`.

Example success:

```json
{
  "data": {
    "user": {
      "id": "u1",
      "email": "user@example.com",
      "displayName": "User",
      "role": "USER",
      "status": "ACTIVE"
    }
  },
  "error": null
}
```

Example error:

```json
{
  "data": null,
  "meta": {},
  "error": {
    "code": "FORBIDDEN",
    "message": "此功能僅限高級會員使用。"
  }
}
```

## 4. Shared Data Shapes

These are the response shapes currently returned by the backend.

```ts
type UserRole = "USER" | "PREMIUM" | "ADMIN";
type UserStatus = "ACTIVE" | "DISABLED";

type MatchStatus =
  | "SCHEDULED"
  | "LIVE"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED";
type MatchStage =
  | "GROUP"
  | "ROUND_OF_32"
  | "ROUND_OF_16"
  | "QUARTER_FINAL"
  | "SEMI_FINAL"
  | "THIRD_PLACE"
  | "FINAL"
  | "UNKNOWN";

type PlayerPosition = "GK" | "DF" | "MF" | "FW" | "UNKNOWN";
type PlayerRatingTier = "S" | "A_PLUS" | "A" | "B_PLUS" | "B" | "C" | "UNKNOWN";
type TeamRatingTier = "S" | "A" | "B" | "C" | "UNKNOWN";
type PlayerRole =
  | "STARTER"
  | "ROTATION"
  | "SUBSTITUTE"
  | "IMPACT_PLAYER"
  | "UNKNOWN";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
type NewsCategory =
  | "MATCH"
  | "PLAYER"
  | "INJURY"
  | "TRANSFER"
  | "TEAM"
  | "TACTIC"
  | "CONTROVERSY"
  | "TOURNAMENT"
  | "OTHER";
type NewsTagType =
  | "TEAM"
  | "PLAYER"
  | "MATCH"
  | "TOPIC"
  | "INJURY"
  | "TACTIC"
  | "CONTROVERSY"
  | "TRANSFER"
  | "OTHER";
type TranslationStatus = "NONE" | "PENDING" | "DONE" | "FAILED";
type AiProvider = "NVIDIA" | "QWEN" | "PROGRAM_RULE";
type AiReportStatus = "PENDING" | "DONE" | "FAILED";
type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
type JobType =
  | "SYNC_FIXTURES"
  | "SYNC_RESULTS"
  | "SYNC_TEAMS"
  | "SYNC_PLAYERS"
  | "FETCH_NEWS"
  | "GENERATE_NEWS_SUMMARY"
  | "GENERATE_MATCH_ANALYSIS"
  | "GENERATE_PLAYER_RATINGS"
  | "GENERATE_CHAMPION_PREDICTIONS";

type UserDto = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
};

type MeDto = UserDto & {
  profile: {
    nickname: string | null;
    avatarUrl: string | null;
    bio: string | null;
  } | null;
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
  worldRanking?: number | null;
  ratingTier?: TeamRatingTier;
  championScore?: number | null;
  formScore?: number | null;
  attackScore?: number | null;
  midfieldScore?: number | null;
  defenseScore?: number | null;
  statusScore?: number | null;
  isEliminated: boolean; // true once knocked out of the tournament (lost a finished knockout match)
};

type PlayerSummary = {
  id: string;
  teamId: string;
  team?: TeamSummary;
  nameEn: string;
  nameZh?: string | null;
  position: PlayerPosition;
  clubName?: string | null;
  shirtNumber?: number | null;
  ratingTier?: PlayerRatingTier;
  overallScore?: number | null;
  attackScore?: number | null;
  creativityScore?: number | null;
  techniqueScore?: number | null;
  defenseScore?: number | null;
  physicalScore?: number | null;
  formScore?: number | null;
  role?: PlayerRole;
  injuryRiskLevel?: RiskLevel;
};

type MatchSummary = {
  id: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  stage: MatchStage;
  groupName?: string | null;
  stadium?: string | null;
  kickoffAt: string;
  status: MatchStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  sourceUpdatedAt?: string | null;
  aiSummary?: string | null;
};

type MatchEventDto = {
  id: string;
  minute: number | null;
  extraMinute: number | null;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  description: string | null;
};

type MatchDetailDto = MatchSummary & {
  events: MatchEventDto[];
};

type AiReportDto = {
  id: string;
  entityType: string;
  entityId?: string | null;
  reportType: string;
  provider: AiProvider;
  model?: string | null;
  language: string;
  title?: string | null;
  content?: string | null;
  structuredJson?: unknown;
  confidenceScore?: number | null;
  status: AiReportStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScoreLinePredictionDto = {
  score: string; // "home-away", e.g. "2-1"
  probability?: number | null; // 0-100
};

type MatchPredictionDto = {
  matchId: string;
  homeWinProbability?: number | null;
  drawProbability?: number | null;
  awayWinProbability?: number | null;
  likelyScorelines: ScoreLinePredictionDto[]; // up to 3 most-likely scorelines (desc probability)
  keyFactors: string[];
  riskNotes: string[];
  report?: AiReportDto | null;
  sourceUpdatedAt?: string | null;
};

type NewsTagDto = {
  id: string;
  name: string;
  type: NewsTagType;
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
  category?: NewsCategory | null;
  tags?: NewsTagDto[];
  translationStatus?: TranslationStatus;
};

type NewsDetailDto = NewsSummary & {
  contentSnippet: string | null;
  translatedContentZh: string | null;
  language: string | null;
  fetchedAt: string | null;
};

type ChampionPredictionEntrySummary = {
  id: string;
  team: TeamSummary;
  rank: number;
  championScore: number;
  ratingTier?: TeamRatingTier;
  probabilityText?: string | null;
  strengths: string[];
  risks: string[];
  aiComment?: string | null;
};

type ChampionDivergenceTeamDelta = {
  teamName: string;
  nvidiaRank?: number | null;
  qwenRank?: number | null;
  rankDelta?: number | null; // |nvidiaRank - qwenRank| when both ranked the team
};

type ChampionDivergence = {
  computable: boolean; // false for legacy/mock runs without structured A/B ranks
  summary: string; // zh-TW human-readable comparison
  teamDeltas: ChampionDivergenceTeamDelta[];
};

type ChampionPredictionResponse = {
  runId: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string | null;
  entries: ChampionPredictionEntrySummary[];
  finalReport?: AiReportDto | null;
  nvidiaReport?: AiReportDto | null;
  qwenReport?: AiReportDto | null;
  polishedReport?: AiReportDto | null; // FINAL_REPORT_POLISH zh markdown; null for mock/legacy runs
  divergence?: ChampionDivergence;
};

type ChatAnswerDto = {
  answer: string;
  provider: AiProvider;
  model?: string | null;
  sourceUpdatedAt?: string | null;
};

type HomeHighlightsResponse = {
  featuredMatches: MatchSummary[];
  championSummary: ChampionPredictionEntrySummary[];
  featuredTeams: TeamSummary[];
  featuredPlayers: PlayerSummary[];
  newsHighlights: NewsSummary[];
};

type FavoritesResponse = {
  teams: TeamSummary[];
  players: PlayerSummary[];
};

type JobResult = {
  jobRunId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
};
```

Current shape notes:

- `PlayerSummary.team` is optional in the actual contract. It is present on `/api/players`, `/api/players/:playerId`, `/api/users/me/favorites`, and `GET /api/home/highlights.featuredPlayers`. It is currently absent on `GET /api/teams/:teamId/players` because that query does not include team relation data.
- `MatchEventDto.eventType` is a plain string from the database, not a documented enum.
- `AiReportDto.reportType` is important. Some endpoints with narrow names can still return a broader report type. See section 7.

## 5. Product API Endpoints

All routes in this section already include the current `/api` prefix.

### 5.1 Public Product Endpoint

| Method | Path                   | Status | Access | Success `data`           |
| ------ | ---------------------- | ------ | ------ | ------------------------ |
| GET    | `/api/home/highlights` | 200    | Public | `HomeHighlightsResponse` |

Notes:

- `featuredMatches` are the next 5 matches ordered by `kickoffAt ASC`.
- `championSummary` is the top 5 entries from the latest champion-prediction run, or `[]` if no run exists.
- `featuredTeams` returns up to 6 teams ordered by `championScore DESC`.
- `featuredPlayers` returns up to 6 players ordered by `overallScore DESC`.
- `newsHighlights` returns up to 5 news items ordered by `publishedAt DESC`.

### 5.2 Auth

| Method | Path                 | Status | Access              | Request                            | Success `data`                            |
| ------ | -------------------- | ------ | ------------------- | ---------------------------------- | ----------------------------------------- |
| POST   | `/api/auth/register` | 201    | Public              | `{ email, password, displayName }` | `{ user: UserDto }`                       |
| POST   | `/api/auth/login`    | 200    | Public              | `{ email, password }`              | `{ user: UserDto, redirectPath: string }` |
| POST   | `/api/auth/logout`   | 200    | JWT cookie required | none                               | `{ success: true }`                       |
| GET    | `/api/auth/me`       | 200    | JWT cookie required | none                               | `UserDto`                                 |

Validation and behavior:

- `POST /api/auth/register`
  - `email` must be a valid email.
  - `password` length must be `8..100`.
  - `displayName` length must be `1..60`.
  - Always creates a `USER` account. There is no role input.
  - Duplicate email returns `409 EMAIL_TAKEN`.
- `POST /api/auth/login`
  - `email` must be a valid email.
  - `password` length must be at least `1`.
  - Sets HttpOnly cookie `access_token`.
  - `redirectPath` is `/admin/accounts` for `ADMIN`, `/matches` for `USER` and `PREMIUM`.
  - Invalid credentials return `401 INVALID_CREDENTIALS`.
  - Disabled accounts return `403 ACCOUNT_DISABLED`.
- `POST /api/auth/logout`
  - Clears the auth cookie.
  - This route is protected. A Guest request is blocked before controller logic and returns `401 UNAUTHORIZED`.
- `GET /api/auth/me`
  - Returns only `UserDto`.
  - It does not include user profile fields. Use `GET /api/users/me` for profile data.

### 5.3 Users

| Method | Path                      | Status | Access                   | Request                                         | Success `data`      |
| ------ | ------------------------- | ------ | ------------------------ | ----------------------------------------------- | ------------------- |
| GET    | `/api/users/me`           | 200    | `USER` or `PREMIUM` only | none                                            | `MeDto`             |
| PATCH  | `/api/users/me`           | 200    | `USER` or `PREMIUM` only | `{ displayName?, nickname?, avatarUrl?, bio? }` | `MeDto`             |
| GET    | `/api/users/me/favorites` | 200    | `USER` or `PREMIUM` only | none                                            | `FavoritesResponse` |

Validation and behavior:

- `PATCH /api/users/me`
  - `displayName` max length `60`
  - `nickname` max length `60`
  - `avatarUrl` max length `500`
  - `bio` max length `1000`
  - No other writable fields are implemented.
  - `email`, `password`, `role`, and `status` cannot be updated here.
- `ADMIN` receives `403 FORBIDDEN` on all `/api/users/*` routes.

### 5.4 Admin

| Method | Path                            | Status | Access       | Request                                                    | Success `data`                     |
| ------ | ------------------------------- | ------ | ------------ | ---------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/admin/users`              | 200    | `ADMIN` only | Query: `page?`, `pageSize?`, `search?`, `role?`, `status?` | `UserDto[]` with pagination meta   |
| POST   | `/api/admin/users`              | 201    | `ADMIN` only | `{ email, password, displayName, role }`                   | `UserDto`                          |
| PATCH  | `/api/admin/users/:userId/role` | 200    | `ADMIN` only | `{ role }`                                                 | `UserDto`                          |
| DELETE | `/api/admin/users/:userId`      | 200    | `ADMIN` only | none                                                       | `{ success: true, user: UserDto }` |
| POST   | `/api/admin/register-admin`     | 201    | `ADMIN` only | `{ email, password, displayName }`                         | `UserDto`                          |
| GET    | `/api/admin/ai-usage`           | 200    | `ADMIN` only | Query: `from?`, `to?` (ISO 8601), `taskType?`              | `AiUsageStatsDto`                  |

Validation and behavior:

- All paginated admin list endpoints use defaults `page = 1`, `pageSize = 20`, maximum `pageSize = 100`.
- `search` matches `email` and `displayName` with case-insensitive `contains`.
- `role` values: `USER | PREMIUM | ADMIN`.
- `status` values: `ACTIVE | DISABLED`.
- `POST /api/admin/users`
  - `password` length must be `8..100`.
  - `displayName` length must be `1..60`.
  - Duplicate email returns `409 EMAIL_TAKEN`.
- `PATCH /api/admin/users/:userId/role`
  - Prevents demoting the last active admin.
  - Conflict returns `409 LAST_ADMIN_PROTECTED`.
- `DELETE /api/admin/users/:userId`
  - Soft delete only. It sets `status = DISABLED` and does not remove the row.
  - Deleting an already disabled user is idempotent and still returns success.
  - Self-disable is blocked with `409 CANNOT_DISABLE_SELF`.
  - Disabling the last active admin is blocked with `409 LAST_ADMIN_PROTECTED`.
- `GET /api/admin/ai-usage` (Phase 3): aggregates `AiUsageLog` over the window (default = last 7 days).
  Every row is one provider attempt; mock-mode rows have `provider = "PROGRAM_RULE"`, `model = "mock"`.
  ```ts
  type AiUsageStatsDto = {
    from: string; to: string;
    totals: { calls: number; done: number; failed: number; inputTokens: number; outputTokens: number };
    byTaskType: { taskType: string; calls: number }[];
    byProvider: { provider: string; calls: number }[];
    byStatus: { status: string; calls: number }[];
    byDay: { day: string; calls: number }[]; // day = ISO midnight UTC buckets (date_trunc)
    topUsers: { userId: string; email: string | null; displayName: string | null; calls: number }[]; // top 10
  };
  ```

### 5.5 Matches

| Method | Path                                      | Status | Access                   | Success `data`                        |
| ------ | ----------------------------------------- | ------ | ------------------------ | ------------------------------------- | ----- |
| GET    | `/api/matches`                            | 200    | `USER` or `PREMIUM` only | `MatchSummary[]` with pagination meta |
| GET    | `/api/matches/today`                      | 200    | `USER` or `PREMIUM` only | `MatchSummary[]`                      |
| GET    | `/api/matches/:matchId`                   | 200    | `USER` or `PREMIUM` only | `MatchDetailDto`                      |
| GET    | `/api/matches/:matchId/analysis`          | 200    | `USER` or `PREMIUM` only | `AiReportDto                          | null` |
| GET    | `/api/matches/:matchId/prediction`        | 200    | `USER` or `PREMIUM` only | `MatchPredictionDto`                  |
| GET    | `/api/matches/:matchId/post-match-report` | 200    | `USER` or `PREMIUM` only | `AiReportDto                          | null` |
| POST   | `/api/matches/:matchId/deep-chat`         | 201    | `PREMIUM` only           | `ChatAnswerDto`                       |

Query and body contract:

- `GET /api/matches` query
  - `page?`, `pageSize?`
  - `status?`: `SCHEDULED | LIVE | FINISHED | POSTPONED | CANCELLED`
  - `stage?`: `GROUP | ROUND_OF_32 | ROUND_OF_16 | QUARTER_FINAL | SEMI_FINAL | THIRD_PLACE | FINAL | UNKNOWN`
  - `dateFrom?`: ISO date string
  - `dateTo?`: ISO date string
  - `teamId?`: string
  - `groupName?`: string
- `POST /api/matches/:matchId/deep-chat` body
  - `{ question: string }`
  - `question` length must be `1..1000`

Behavior notes:

- `GET /api/matches` returns records ordered by `kickoffAt ASC`.
- `GET /api/matches/today` returns matches whose `kickoffAt` falls within the current local day range in server time.
- `GET /api/matches/:matchId` returns timeline events ordered by `minute ASC`, then `id ASC`.
- `GET /api/matches/:matchId/prediction`
  - Reads `structuredJson.prediction.homeWinLean`, `drawLean`, `awayWinLean` if present.
  - If no structured prediction exists, the probabilities are `null` and `keyFactors` / `riskNotes` are empty arrays.
- `POST /api/matches/:matchId/deep-chat` routes through the AI router. When `AI_MOCK_MODE=false` it returns a real grounded answer (`provider` `NVIDIA`/`QWEN`); under `AI_MOCK_MODE=true` it returns the deterministic `PROGRAM_RULE` / `model = "mock"` answer. On total provider failure it degrades gracefully to a `PROGRAM_RULE` notice (still `200`/`201`).

### 5.6 Teams

| Method | Path                           | Status | Access                   | Success `data`                       |
| ------ | ------------------------------ | ------ | ------------------------ | ------------------------------------ | ----- |
| GET    | `/api/teams`                   | 200    | `USER` or `PREMIUM` only | `TeamSummary[]` with pagination meta |
| GET    | `/api/teams/:teamId`           | 200    | `USER` or `PREMIUM` only | `TeamSummary`                        |
| GET    | `/api/teams/:teamId/players`   | 200    | `USER` or `PREMIUM` only | `PlayerSummary[]`                    |
| GET    | `/api/teams/:teamId/matches`   | 200    | `USER` or `PREMIUM` only | `MatchSummary[]`                     |
| GET    | `/api/teams/:teamId/analysis`  | 200    | `USER` or `PREMIUM` only | `AiReportDto                         | null` |
| POST   | `/api/teams/:teamId/deep-chat` | 201    | `PREMIUM` only           | `ChatAnswerDto`                      |

Query and body contract:

- `GET /api/teams` query
  - `page?`, `pageSize?`
  - `search?`: string
  - `continent?`: string
  - `ratingTier?`: `S | A | B | C | UNKNOWN`
  - `eliminated?`: boolean (`true`/`false`) — filter by knockout elimination status
  - `sortBy?`: actual service whitelist is `championScore | formScore | worldRanking | nameEn | ratingTier | createdAt`
  - `sortOrder?`: `asc | desc`
- `POST /api/teams/:teamId/deep-chat` body
  - `{ question: string }`
  - `question` length must be `1..1000`

Behavior notes:

- `GET /api/teams` defaults to sorting by `championScore DESC` when `sortBy` is omitted or unsupported.
- `GET /api/teams/:teamId/players` returns players ordered by `overallScore DESC`, then `nameEn ASC`.
- `GET /api/teams/:teamId/players` currently does not include nested `team` objects inside each `PlayerSummary` item.
- `GET /api/teams/:teamId/matches` returns matches ordered by `kickoffAt ASC`.
- `GET /api/teams/:teamId/analysis` returns the latest DONE team AI report; the code does not constrain `reportType` beyond `entityType = TEAM`.
- `POST /api/teams/:teamId/deep-chat` routes through the AI router. When `AI_MOCK_MODE=false` it returns a real grounded answer (`provider` `NVIDIA`/`QWEN`); under `AI_MOCK_MODE=true` it returns the deterministic `PROGRAM_RULE` / `model = "mock"` answer. On total provider failure it degrades gracefully to a `PROGRAM_RULE` notice (still `200`/`201`).

### 5.7 Players

| Method | Path                               | Status | Access                   | Success `data`                         |
| ------ | ---------------------------------- | ------ | ------------------------ | -------------------------------------- | ----- |
| GET    | `/api/players`                     | 200    | `USER` or `PREMIUM` only | `PlayerSummary[]` with pagination meta |
| GET    | `/api/players/:playerId`           | 200    | `USER` or `PREMIUM` only | `PlayerSummary`                        |
| GET    | `/api/players/:playerId/rating`    | 200    | `USER` or `PREMIUM` only | `AiReportDto                           | null` |
| GET    | `/api/players/:playerId/analysis`  | 200    | `USER` or `PREMIUM` only | `AiReportDto                           | null` |
| POST   | `/api/players/:playerId/deep-chat` | 201    | `PREMIUM` only           | `ChatAnswerDto`                        |

Query and body contract:

- `GET /api/players` query
  - `page?`, `pageSize?`
  - `search?`: string
  - `teamId?`: string
  - `position?`: `GK | DF | MF | FW | UNKNOWN`
  - `ratingTier?`: `S | A_PLUS | A | B_PLUS | B | C | UNKNOWN`
  - `eliminated?`: boolean (`true`/`false`) — filter by the player's national team knockout elimination status (`team.isEliminated`)
  - `sortBy?`: actual service whitelist is `overallScore | attackScore | creativityScore | techniqueScore | defenseScore | physicalScore | formScore | nameEn | createdAt`
  - `sortOrder?`: `asc | desc`
- `POST /api/players/:playerId/deep-chat` body
  - `{ question: string }`
  - `question` length must be `1..1000`

Behavior notes:

- `GET /api/players` defaults to sorting by `overallScore DESC` when `sortBy` is omitted or unsupported.
- `GET /api/players` and `GET /api/players/:playerId` include nested `team` inside each `PlayerSummary`.
- `POST /api/players/:playerId/deep-chat` routes through the AI router. When `AI_MOCK_MODE=false` it returns a real grounded answer (`provider` `NVIDIA`/`QWEN`); under `AI_MOCK_MODE=true` it returns the deterministic `PROGRAM_RULE` / `model = "mock"` answer. On total provider failure it degrades gracefully to a `PROGRAM_RULE` notice (still `200`/`201`).

### 5.8 Favorites

| Method | Path                               | Status | Access                   | Success `data`      |
| ------ | ---------------------------------- | ------ | ------------------------ | ------------------- |
| POST   | `/api/favorites/teams/:teamId`     | 201    | `USER` or `PREMIUM` only | `{ success: true }` |
| DELETE | `/api/favorites/teams/:teamId`     | 200    | `USER` or `PREMIUM` only | `{ success: true }` |
| POST   | `/api/favorites/players/:playerId` | 201    | `USER` or `PREMIUM` only | `{ success: true }` |
| DELETE | `/api/favorites/players/:playerId` | 200    | `USER` or `PREMIUM` only | `{ success: true }` |

Behavior notes:

- `POST` add routes verify that the target team or player exists. Missing target returns `404 NOT_FOUND`.
- Add routes are idempotent. Re-adding the same favorite does not create duplicates.
- Remove routes are idempotent. Removing a non-existent favorite still returns success.

### 5.9 News

| Method | Path                          | Status | Access                   | Success `data`                       |
| ------ | ----------------------------- | ------ | ------------------------ | ------------------------------------ |
| GET    | `/api/news`                   | 200    | `USER` or `PREMIUM` only | `NewsSummary[]` with pagination meta |
| GET    | `/api/news/:newsId`           | 200    | `USER` or `PREMIUM` only | `NewsDetailDto`                      |
| GET    | `/api/news/:newsId/analysis`  | 200    | `USER` or `PREMIUM` only | `AiReportDto \| null`                |
| POST   | `/api/news/:newsId/translate` | 200    | `PREMIUM` only           | `NewsDetailDto`                      |
| POST   | `/api/news/:newsId/deep-chat` | 201    | `PREMIUM` only           | `ChatAnswerDto`                      |

Query and body contract:

- `GET /api/news` query
  - `page?`, `pageSize?`
  - `category?`: `MATCH | PLAYER | INJURY | TRANSFER | TEAM | TACTIC | CONTROVERSY | TOURNAMENT | OTHER`
  - `tag?`: tag name string
  - `teamId?`: string
  - `playerId?`: string
  - `sourceName?`: string
  - `dateFrom?`: ISO date string
  - `dateTo?`: ISO date string
- `POST /api/news/:newsId/deep-chat` body
  - `{ question: string }`
  - `question` length must be `1..1000`

Behavior notes:

- `GET /api/news` returns records ordered by `publishedAt DESC`.
- `teamId` and `playerId` filters are not direct relations. The service resolves the referenced team/player English and Chinese names, then filters by matching tag names.
- If `teamId` or `playerId` cannot be resolved, the service does not throw `404`; it simply does not add extra tag names for that filter.
- `POST /api/news/:newsId/translate`
  - Routes through the AI router `NEWS_TRANSLATION` (Qwen Flash → Flash fallback).
  - If `titleZh` is absent, it becomes `【譯】${titleEn}`.
  - On success sets `translationStatus = DONE` and stores the translated text in `translatedContentZh`.
    Under `AI_MOCK_MODE=true` the text is the deterministic mock prefixed with `【AI_MOCK_MODE 翻譯】`.
  - On provider failure sets `translationStatus = FAILED` and leaves any previous `translatedContentZh` untouched.
- `POST /api/news/:newsId/deep-chat` routes through the AI router. When `AI_MOCK_MODE=false` it returns a real grounded answer (`provider` `NVIDIA`/`QWEN`); under `AI_MOCK_MODE=true` it returns the deterministic `PROGRAM_RULE` / `model = "mock"` answer. On total provider failure it degrades gracefully to a `PROGRAM_RULE` notice (still `200`/`201`).
- **News impact analysis (Phase 3):** `GET /api/news/:newsId/analysis` returns the latest DONE
  `NEWS_IMPACT` `AiReportDto` (or `null` when not generated yet — frontend must handle `null`).
  Reports are generated by the `generate-news-impact` job for recent (`NEWS_IMPACT_LOOKBACK_DAYS`,
  default 7d) summarized articles carrying TEAM/PLAYER tags. `structuredJson` shape:
  `{ impactSummaryZh, affectedTeams: [{ name, impact, direction: POSITIVE|NEGATIVE|NEUTRAL|UNKNOWN }],
  affectedPlayers: [same], confidenceScore, dataLimitations[] }` — cautious tone, all impact
  statements are inference-flagged (推論). `404 NOT_FOUND` when the article does not exist.

### 5.10 Champion Predictions

| Method | Path                                    | Status | Access                   | Success `data`               |
| ------ | --------------------------------------- | ------ | ------------------------ | ---------------------------- | ----- |
| GET    | `/api/champion-predictions`             | 200    | `USER` or `PREMIUM` only | `ChampionPredictionResponse  | null` |
| GET    | `/api/champion-predictions/latest`      | 200    | `USER` or `PREMIUM` only | `ChampionPredictionResponse  | null` |
| POST   | `/api/champion-predictions/recalculate` | 200    | `PREMIUM` only           | `ChampionPredictionResponse` |
| POST   | `/api/champion-predictions/deep-chat`   | 201    | `PREMIUM` only           | `ChatAnswerDto`              |

Behavior notes:

- `GET /api/champion-predictions` and `GET /api/champion-predictions/latest` currently call the same service method and return the same resource.
- If no champion-prediction run exists yet, success response is `{ data: null, error: null }`.
- `POST /api/champion-predictions/recalculate`
  - Selects the top 8 teams by `championScore DESC` as the run's team set.
  - Under `AI_MOCK_MODE=true`: deterministic ranking with mock `entries[*].aiComment`; the three reports stay `null`.
  - Under `AI_MOCK_MODE=false`: runs `CHAMPION_PREDICTION_A` (NVIDIA), `_B` (Qwen), and `_FINAL`
    (Qwen → NVIDIA fallback), persists an `AiReport` per leg, and links `nvidiaReport` / `qwenReport` /
    `finalReport`. Entries are built from the validated final output.
  - If the final model fails or returns schema-invalid output, the run degrades to the `championScore`
    ranking (so `entries` is always populated) and the failed legs are linked as `FAILED` reports.
- **Final report polish (Phase 3):** after a successful real-mode final leg, a `FINAL_REPORT_POLISH`
  step (Qwen Plus → NVIDIA Ultra) rewrites the consensus into fluent zh-TW markdown, persisted as an
  `AiReport` bound to the run (`entityId = runId`) and returned as `polishedReport`. Env-gated by
  `CHAMPION_POLISH_ENABLED` (default true); `null` for mock runs, legacy runs, disabled polish, or a
  failed polish attempt (the run itself is unaffected). Frontend should fall back to
  `finalReport`/`entries` when `polishedReport` is `null`.
- **Model divergence (Phase 3):** every `ChampionPredictionResponse` includes `divergence`, computed
  program-side from the A/B legs' `structuredJson` rankings (`{ analysis, entries[{teamName, rank,
  probabilityText, keyReason}], dataLimitations }`). For runs created before this change, mock runs
  (no A/B reports), or legs whose structured output is missing, `divergence.computable` is `false`
  and `teamDeltas` is empty — frontend can then fall back to showing the two raw reports side by side.
- `POST /api/champion-predictions/deep-chat` routes through the AI router. When `AI_MOCK_MODE=false` it returns a real grounded answer (`provider` `NVIDIA`/`QWEN`); under `AI_MOCK_MODE=true` it returns the deterministic `PROGRAM_RULE` / `model = "mock"` answer. On total provider failure it degrades gracefully to a `PROGRAM_RULE` notice (still `200`/`201`).

### 5.11 AI Chat

| Method | Path           | Status | Access                   | Request                 | Success `data`  |
| ------ | -------------- | ------ | ------------------------ | ----------------------- | --------------- |
| POST   | `/api/ai/chat` | 201    | `USER` or `PREMIUM` only | `{ question, history? }` | `ChatAnswerDto` |

Behavior notes:

- `question` length must be `1..1000`.
- `history?`: optional array of prior conversation turns, oldest→newest, each `{ role: "user" | "assistant", content: string }` (`content` ≤ 2000 chars, array ≤ 20 items). The backend uses only the **last 3 Q&A pairs (6 turns)**; extra turns are trimmed server-side. Frontend keeps and sends the visible chat log — the backend stores no conversation state.
- `ADMIN` receives `403 FORBIDDEN` here.
- Routes through the AI router `GENERAL_CHAT` (NVIDIA Super → Qwen Plus) with AI usage logging.
- Under `AI_MOCK_MODE=false` the answer is **grounded in a DB context** built from the question: intent is classified (match / team / player / news / champion / mixed / unknown), referenced teams/players are matched (recent user turns help resolve references like「他」), and only the relevant tables are queried. When nothing relevant is found the strict Global Skill answers「目前資料不足」. Prior turns are sent to the model with the current question flagged `【本次提問】`.
- **Entity fixtures bundling:** when a team or player is named, the snapshot also includes that team's fixtures (recent results + upcoming) — so「接下來法國對陣誰 / Mbappe 下一場」are answerable even without a fixture keyword. For general fixture questions (no team named) the snapshot includes recent finished + live + a multi-day list of upcoming `SCHEDULED` matches plus a `now` timestamp, so「未開始 / 今天 / 明天 / 某月某日」can be answered from the snapshot.
- Under `AI_MOCK_MODE=true` the response is the deterministic `provider = "PROGRAM_RULE"`, `model = "mock"` mock (history is accepted but ignored; scope stays `一般問答`).
  Under `AI_MOCK_MODE=false` `provider` is `NVIDIA`/`QWEN`; on total provider failure it degrades to a `PROGRAM_RULE` notice.

### 5.12 AI Quota (Phase 3)

Per-user quota is enforced on every AI-consuming endpoint. Exceeding a bucket returns
`429` with `error.code = "AI_QUOTA_EXCEEDED"` and
`error.details = { quotaKey, limit, used, resetAt }` (`resetAt` = ISO start of the next window).

| Quota bucket (`quotaKey`) | Endpoints | Limit (default) | Window |
|---|---|---|---|
| `GENERAL_CHAT` | `POST /api/ai/chat` | USER 20 / PREMIUM 100 | per day (server-local calendar day) |
| `DEEP_CHAT` | all five `*/deep-chat` routes combined | PREMIUM 50 | per day |
| `NEWS_TRANSLATION` | `POST /api/news/:newsId/translate` | PREMIUM 30 | per day |
| `CHAMPION_RECALCULATE` | `POST /api/champion-predictions/recalculate` | PREMIUM 3 | per ISO week (Mon 00:00 server-local) |

Notes:

- Limits are env-overridable (`AI_QUOTA_*`, see `apps/api/src/config/env.validation.ts`).
- Only **successful** calls consume quota (chat/deep-chat/translate count `DONE` rows in
  `AiUsageLog`; recalculate counts `PREMIUM_USER` rows in `ChampionPredictionRun`). A call that
  fails on every provider does not consume quota. Mock-mode calls do consume quota.
- `POST /api/matches/:matchId/refresh` calls no AI and has **no quota** (cooldown only).

## 6. Backend-only Endpoints

These routes exist, but product UI should not call them.

### 6.1 Health

| Method | Path             | Status | Access | Success `data`                        |
| ------ | ---------------- | ------ | ------ | ------------------------------------- |
| GET    | `/api/health`    | 200    | Public | `{ status: 'ok', timestamp: string }` |
| GET    | `/api/health/db` | 200    | Public | `{ status: 'ok', db: 'up' }`          |

Failure note:

- `GET /api/health/db` returns `503` with `error.code = "DB_UNAVAILABLE"` if the database query fails.

### 6.2 Jobs

All `/api/jobs/*` routes are `@Public()` but protected by `CronSecretGuard`.

- Required header: `x-cron-secret: <CRON_SECRET>`
- No JWT cookie is used for these routes.
- All job routes return `JobResult` and wrap the work in a `JobRun` (`RUNNING → DONE`, or `FAILED`
  with `metadata.error` on an unhandled error — still HTTP `200`).
- **Real (data fetch):** `sync-teams`, `sync-players`, `sync-fixtures`, `sync-results` (football-data.org)
  and `fetch-news` (Guardian + NewsAPI). Each **skips to `DONE`** with `metadata.skipped=true` when its
  data-source API key is not configured (no external call), so they are safe without keys. Sync counts
  (`fetched/created/updated/failed`) are recorded in `JobRun.metadata`. `sync-players` is throttled and
  best-effort (squad availability depends on the football-data tier). News stores title/summary/snippet/
  source URL only and dedupes by `sourceUrl` (existing rows, incl. translations, are left untouched).
- **Real (AI generation, via AiRouter):** `generate-news-summary` (摘要/分類/標籤 → `NewsArticle` + tags,
  另把 `relatedTeamNames`/`relatedPlayerNames` 併入 TEAM/PLAYER 標籤),
  `generate-news-impact` (Phase 3：對近 7 天已摘要且帶 TEAM/PLAYER 標籤的新聞產生謹慎語氣影響分析 → `AiReport(NEWS/NEWS_IMPACT)`),
  `generate-player-ratings` (六邊形評分 → `AiReport`，真實模式另寫回 `Player` 分數),
  `generate-player-status` (Phase 3：對在賽隊伍每隊前 `PLAYER_STATUS_TOP_N`(15) 名球員,依近 7 天標籤新聞 + 該隊近 5 場結果產生近況/傷病摘要 → `AiReport(PLAYER/PLAYER_STATUS_SUMMARY)`，真實模式寫回 `injuryRiskLevel`/`formScore`),
  `generate-match-analysis` (賽前分析 → `AiReport`，供 `/analysis` 與 `/prediction`；**僅產生未開賽 `SCHEDULED` 的比賽**，含三種最可能比分),
  `generate-champion-predictions` (SYSTEM 觸發的 A/B/final run)。各任務以 `AiReport.sourceSnapshotHash`
  判斷「資料未變則跳過」,單次最多處理 200 筆(`metadata` 含 `scanned/generated/skipped/failed`),
  其餘留待下次重跑;在 `AI_MOCK_MODE=true` 下產生 `PROGRAM_RULE` 示範報告(不呼叫外部)。
  真實模式下生成迴圈間有 `AI_GENERATION_DELAY_MS`(預設 500ms)節流以緩解 NVIDIA 503。

Current implemented routes:

- `POST /api/jobs/sync-fixtures`
- `POST /api/jobs/sync-results`
- `POST /api/jobs/sync-teams`
- `POST /api/jobs/sync-players`
- `POST /api/jobs/fetch-news`
- `POST /api/jobs/generate-news-summary`
- `POST /api/jobs/generate-news-impact`
- `POST /api/jobs/generate-match-analysis`
- `POST /api/jobs/generate-player-ratings`
- `POST /api/jobs/generate-player-status`
- `POST /api/jobs/generate-champion-predictions`

Failure note:

- Missing or wrong `x-cron-secret` returns `401 UNAUTHORIZED` with message `Invalid or missing cron secret`.

### 6.3 API Documentation Routes

- Swagger UI is configured at `/docs`.
- Raw OpenAPI JSON route is `IMPLEMENTATION_UNCLEAR` because it is not explicitly configured in code.
- There is no implemented `/swagger` route in the current source code.

## 7. Markers: IMPLEMENTATION_UNCLEAR, NOT_IMPLEMENTED, SPEC_MISMATCH

### IMPLEMENTATION_UNCLEAR

- OpenAPI JSON path is not explicitly configured. Swagger UI definitely exists at `/docs`, but raw JSON should be runtime-verified before any tooling depends on it.
- `MatchEventDto.eventType` is a free-form string from the database. No exhaustive enum or frontend-safe value list is implemented in code.
- `GET /api/teams/:teamId/analysis` returns the latest DONE TEAM report without constraining `reportType`. Frontend should inspect `data.reportType` instead of assuming a single stable report subtype.

### NOT_IMPLEMENTED

- Route-level check: no product endpoint listed in `worldcup_ai_backend_agent_docs/07_BACKEND_READONLY_FRONTEND_CONTRACT.md` is missing. The current backend implements every route from that list.
- Phase 2 (done): real NVIDIA/Qwen routing is wired for `POST /api/ai/chat`, all `*/deep-chat` routes, `POST /api/news/:newsId/translate`, and `POST /api/champion-predictions/recalculate` via the `AiRouterService`. Behavior depends on `AI_MOCK_MODE` (mock short-circuit) and degrades gracefully on provider failure.
- Phase 3 (done): AI quota enforcement (`429 AI_QUOTA_EXCEEDED`) is live on all AI-consuming endpoints — see §5.12. Every provider call is still recorded in `AiUsageLog`.
- Data-fetch jobs are implemented: `sync-teams` / `sync-players` / `sync-fixtures` / `sync-results`
  (football-data.org) and `fetch-news` (Guardian + NewsAPI), each with a no-key skip.
- AI-generation jobs are implemented: `generate-news-summary` / `generate-news-impact` /
  `generate-player-ratings` / `generate-player-status` / `generate-match-analysis` /
  `generate-champion-predictions` (via AiRouter; skip-if-unchanged via `sourceSnapshotHash`;
  bounded at 200/run; `PROGRAM_RULE` reports under `AI_MOCK_MODE`; real-mode inter-call throttle).
- Scheduler is implemented (`@nestjs/schedule`, `jobs/jobs.scheduler.ts`): **04:00 full pipeline**
  (all sync + all generate, incl. news impact), **06:00 player-status pass** (staggered so the day's
  news is tagged first and NVIDIA isn't hammered concurrently), and **12:00 midday refresh**
  (fixtures/results/news + news-impact/match/champion generation, no team/player sync or player
  ratings) — slots are staggered because source data can lag. Manual `/api/jobs/*` still works.
- Team `nameZh` is now populated for synced teams via `sources/football-data/country-names.ts`
  (fifaCode → 繁中); frontend can display Chinese names.
- Not yet implemented: group-stage (non-knockout) elimination derivation.

### SPEC_MISMATCH

- `MatchSummary.aiSummary` exists in the response shape, but the current code never populates it in any existing call site. Frontend should treat it as effectively `null` today.
- `GET /api/matches/:matchId/prediction` can attach `data.report` whose `reportType` is either `MATCH_PREDICTION` or `MATCH_ANALYSIS`. The route name is narrower than the actual implementation.
- `GET /api/matches/:matchId/post-match-report` can return a `MATCH_ANALYSIS` report when a `POST_MATCH_REPORT` does not exist.
- `GET /api/players/:playerId/rating` can return the newest report among `PLAYER_RATING` and `PLAYER_HEXAGON_ANALYSIS`, not strictly one fixed report type.
- `GET /api/players/:playerId/analysis` can return the newest report among `PLAYER_STATUS_SUMMARY` and `PLAYER_HEXAGON_ANALYSIS`, not strictly one fixed report type.
- Auth cookie behavior is implemented as `SameSite=Lax` in both development and production. If production frontend and backend are cross-site rather than same-site, cookie auth may not behave like a typical cross-origin SPA setup.

## 8. Common Error Codes Seen in Current Code

These are the concrete `error.code` values currently thrown in application code.

- `BAD_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `ACCOUNT_DISABLED`
- `INVALID_CREDENTIALS`
- `EMAIL_TAKEN`
- `NOT_FOUND`
- `CANNOT_DISABLE_SELF`
- `LAST_ADMIN_PROTECTED`
- `DB_UNAVAILABLE`
- `AI_QUOTA_EXCEEDED`

Frontend handling guidance:

- Treat `401 UNAUTHORIZED` from protected product APIs as unauthenticated or expired session.
- Treat `403 ACCOUNT_DISABLED` as authenticated but blocked account.
- Treat `403 FORBIDDEN` as role mismatch.
- Treat `404 NOT_FOUND` as missing resource.
- Treat `409` conflicts by `error.code`, especially `EMAIL_TAKEN`, `CANNOT_DISABLE_SELF`, and `LAST_ADMIN_PROTECTED`.
- Treat `429 AI_QUOTA_EXCEEDED` as quota exhaustion: show `error.message` and use `error.details.resetAt` for a "try again after" hint (see §5.12).
- When validation errors contain multiple messages, current backend joins them into a single `error.message` string separated by `; ` and also places the array into `error.details`.
