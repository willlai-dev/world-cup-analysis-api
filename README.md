# AI 世界盃分析師 — 後端

> AI World Cup Analyst — Backend

為 AI 世界盃分析平台打造的後端，技術棧為 NestJS + Fastify + Prisma + PostgreSQL。
提供帳號與權限、賽事／球隊／球員／新聞／冠軍預測的資料 API、以 NVIDIA 與 Qwen
多模型路由驅動的 AI 對話與分析生成，以及資料同步排程任務。

<sub>NestJS + Fastify + Prisma + PostgreSQL backend for the AI World Cup Analyst platform: accounts &
RBAC, read APIs for matches / teams / players / news / champion predictions, AI chat & analysis
powered by a NVIDIA + Qwen multi-model router, and scheduled data-sync jobs.</sub>

## 主要功能 | Features

- **帳號與權限（Accounts & RBAC）**：Email／密碼註冊登入、以 HttpOnly cookie 承載的簽章 JWT、
  USER / PREMIUM / ADMIN 三種角色；ADMIN 為功能超級使用者，通行所有使用者領域 API。
- **資料瀏覽 API（Read APIs）**：賽事、球隊、球員、新聞、冠軍預測的列表／詳情／分析／預測等唯讀端點，
  統一分頁與回應封套。
- **收藏（Favorites）**：球隊與球員的加入／移除（冪等）。
- **AI 對話（AI chat）**：`/ai/chat` 一般問答（以資料庫內容 grounding），以及各頁面的 PREMIUM
  深度對話 `deep-chat`。
- **AI 分析生成（AI analysis）**：賽前分析與比分預測、球員六邊形評分、球隊實力評分、球員近況／傷病、
  新聞摘要／分類／影響分析、冠軍雙模型交叉分析與潤稿。
- **多模型路由（Multi-model router）**：`AiRouterService` 依任務型別在 NVIDIA 與 Qwen 間分流，
  任一供應商失敗時自動降級（graceful degradation）。
- **使用額度（AI quota）**：每位使用者的 AI 額度限制，超過回 `429 AI_QUOTA_EXCEEDED`，
  所有呼叫皆記錄於 `AiUsageLog`。
- **資料同步任務（Data-sync jobs）**：從 football-data.org、Guardian、NewsAPI 抓取
  球隊／球員／賽程／賽果／新聞。
- **排程與後台觸發（Scheduler & admin triggers）**：內建排程器定時執行，Admin 可從後台
  手動觸發整條或分領域的 pipeline。

## 技術棧 | Stack

- **NestJS 11** 搭配 **Fastify** adapter，TypeScript `strict` 模式
- **Prisma 6** + **PostgreSQL**
- 身分驗證：以 **HttpOnly cookie 承載的簽章 JWT** + `GET /auth/me`
- AI：**NVIDIA** 與 **DashScope／Qwen** 供應商，經 `AiRouterService` 路由
- 資料來源：**football-data.org**、**The Guardian**、**NewsAPI**
- 排程：`@nestjs/schedule`
- Swagger / OpenAPI 文件位於 `/docs`
- 測試：**Jest**（單元）+ **Supertest**（e2e）

## 專案結構 | Repository layout（pnpm monorepo）

```
world-cup-analysis-api/
├── apps/
│   └── api/            # NestJS 後端（本應用）
├── packages/           # （保留給未來 apps/web 的共用型別）
├── docker-compose.yml  # 選用的本地端 Postgres（設定對齊 .env）
├── pnpm-workspace.yaml
└── package.json        # 根目錄腳本代理至 apps/api
```

## 前置需求 | Prerequisites

- Node.js ≥ 20（已在 v22 測試）、pnpm 10
- 一個可連線的 PostgreSQL，兩種方式擇一：
  - **沿用你現有的本地 Postgres**（預設設定 — 詳見 `apps/api/.env`），或
  - 執行 `docker compose up -d` 啟動一個。**請勿在 port 5432 上同時執行兩者。**

## 本地啟動 | Local setup

```bash
# 1. 安裝（於根目錄）— 同時會產生並修補 Prisma client
pnpm install

# 2. 設定環境變數：apps/api/.env 已內含可用的預設值。
#    全新環境請複製 apps/api/.env.example。

# 3. 資料庫（於 apps/api 目錄下執行）
cd apps/api
pnpm prisma:generate     # prisma generate + CJK 路徑修補（見下方說明）
pnpm prisma:migrate      # prisma migrate dev + 再次修補
pnpm prisma:seed         # 冪等 seed（admin/premium/user + 範例資料）

# 4. 執行
pnpm start:dev           # http://localhost:3000/api （Swagger：/docs）
```

根目錄的捷徑指令同樣可用：`pnpm dev`、`pnpm build`、`pnpm test`、`pnpm test:e2e`、
`pnpm prisma:migrate`、`pnpm prisma:seed`、`pnpm db:up`。

## 預設種子帳號 | Seeded accounts

| 角色 Role | 電子郵件 Email | 密碼 Password |
|---|---|---|
| ADMIN | `admin@example.com` | `admin123456` |
| PREMIUM | `premium@example.com` | `premium123456` |
| USER | `user@example.com` | `user123456` |

## 測試 | Tests

```bash
cd apps/api
pnpm test        # 單元測試（services、guards）
pnpm test:e2e    # e2e：自動建立/遷移/seed footy_predict_test，執行必要的 RBAC 案例
```

e2e 測試流程使用**獨立的資料庫**（`footy_predict_test`），會在
`test/setup/global-setup.ts` 中自動建立（設定的角色具備 CREATEDB 權限）。
它會被遷移並以冪等 fixtures seed，因此重複執行是安全的。

完整、以原始碼掃描為準的 API 契約請見
[docs/API_CONTRACT_CURRENT.md](docs/API_CONTRACT_CURRENT.md)（前端請以該文件為準）。

## API 端點總覽 | API surface（皆位於 `/api` 底下）

- **Public（公開）**：`GET /health`、`GET /health/db`、`GET /home/highlights`、
  `POST /auth/register`、`POST /auth/login`
- **Auth（驗證）**：`POST /auth/logout`、`GET /auth/me`
- **Users（USER/PREMIUM/ADMIN）**：`GET/PATCH /users/me`、`GET /users/me/favorites`
- **Admin（僅限 ADMIN）**：`GET/POST /admin/users`、`PATCH /admin/users/:id/role`、
  `DELETE /admin/users/:id`（軟刪除）、`POST /admin/register-admin`、
  `GET /admin/ai-usage`（AI 使用統計）、`POST /admin/jobs/run`、
  `POST /admin/jobs/run-team/:teamId`、`GET /admin/jobs/teams`、`GET /admin/jobs/runs`
- **Reads（USER/PREMIUM）**：`matches`、`teams`、`players`、`news`、`champion-predictions`
  （另含 detail / analysis / prediction / rating / post-match-report 路由）
- **Favorites（USER/PREMIUM）**：`POST/DELETE /favorites/teams|players/:id`
- **AI chat（USER/PREMIUM/ADMIN）**：`POST /ai/chat`
- **PREMIUM 專屬（PREMIUM 或 ADMIN）**：`*/deep-chat`（matches／teams／players／news／champion）、
  `news/:id/translate`、`champion-predictions/recalculate`
- **Jobs（受 cron 保護）**：`POST /jobs/*` 需帶 header `x-cron-secret`

每個回應皆使用統一封套 `{ data, meta?, error }`。

## RBAC 權限摘要 | RBAC summary

- 全域 `JwtAuthGuard`（cookie JWT）。以 `@Public()` 讓路由退出保護。
- `AdminOnlyGuard` → 僅限 ADMIN（admin controller）。
- `NonAdminUserGuard` → 任何已驗證帳號（USER/PREMIUM/**ADMIN**）皆可存取使用者領域 API。
  Admin 為功能超級使用者，繼承所有一般能力。
- `PremiumOnlyGuard` → PREMIUM **或 ADMIN**（translate / recalculate / deep-chat）；USER 回傳 403。
- `CronSecretGuard` → jobs 需帶 `x-cron-secret`。
- DISABLED 帳號無法登入，且在受保護路由上會被拒絕（403）。

### 帳號刪除 = 軟刪除 | Account deletion = soft delete

`DELETE /admin/users/:id` 永遠不會移除資料列，而是將其設為 `status = DISABLED`
（保留個人檔案、收藏、AI 紀錄、預測執行）。最後一個**有效（active）**的 admin
不可被停用或降級（回傳 409 `LAST_ADMIN_PROTECTED`），且 admin 不可停用自己的帳號。

## AI 功能與模式 | AI features & modes

- **多模型路由**：`AiRouterService` 依任務型別選擇供應商並在失敗時 fallback，例如
  一般問答（NVIDIA → Qwen）、新聞翻譯（Qwen）、冠軍預測 A/B/final（NVIDIA／Qwen 交叉分析）。
  所有供應商皆失敗時，會優雅降級為 `PROGRAM_RULE` 的規則式回覆（HTTP 仍為 200/201）。
- **資料 grounding**：`/ai/chat` 與各頁面 `deep-chat` 會依問題判讀意圖、比對相關球隊／球員／賽事，
  只查詢相關資料表後餵給模型；查無相關資料時回覆「目前資料不足」。
- **使用額度**：每位使用者的每日／每週額度（一般問答、深度對話、新聞翻譯、冠軍重算各自獨立），
  超過回 `429 AI_QUOTA_EXCEEDED`，額度上限可由 `AI_QUOTA_*` 環境變數調整。
- **Mock 模式**：`AI_MOCK_MODE=true` 讓所有觸及 AI 的端點在**沒有外部金鑰**的情況下正常運作，
  回傳確定性（deterministic）的示範內容；設為 `false` 才會實際呼叫 NVIDIA／Qwen。

## 資料同步與排程任務 | Data sync & scheduled jobs

- **資料抓取（Data fetch）**：`sync-teams`／`sync-players`／`sync-fixtures`／`sync-results`
  （football-data.org）與 `fetch-news`（Guardian + NewsAPI）。當對應的 API 金鑰未設定時，
  任務會**跳過並標記為 DONE**（不呼叫外部服務），因此沒有金鑰也能安全執行。
- **AI 生成（AI generation）**：`generate-news-summary`／`generate-news-impact`／
  `generate-team-ratings`／`generate-player-ratings`／`generate-player-status`／
  `generate-match-analysis`／`generate-champion-predictions`。以 `sourceSnapshotHash`
  判斷「資料未變則跳過」，單次最多處理 200 筆，評分類任務優先處理尚未淘汰的球隊／球員。
- **排程器（Scheduler，`@nestjs/schedule`）**：02:00 評分（球員→球隊）、04:00 完整 pipeline、
  06:00 球員近況、12:00 午間刷新，各時段錯開以緩解來源延遲與 AI 併發。
- **後台手動觸發（Admin manual trigger）**：`POST /admin/jobs/run` 可跑
  `FULL`／`SYNC`／`GENERATE` 或分領域 `TEAMS`／`PLAYERS`／`MATCHES`／`NEWS`／`CHAMPION` preset，
  `POST /admin/jobs/run-team/:teamId` 可單獨分析一個國家；背景執行、立即回 `202`，
  若已有流程在跑則回 `409 PIPELINE_RUNNING`。排程與手動觸發共用同一把重入鎖，不會重疊。

## 需手動設定的環境變數 | Environment keys that need manual setup

`apps/api/.env` 已針對本機預先設定好。若為全新環境，至少需設定：

- `DATABASE_URL` — Postgres 連線字串（預設沿用你現有的資料庫）
- `JWT_SECRET`、`COOKIE_SECRET`、`CRON_SECRET` — 長度足夠的隨機字串
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_DISPLAY_NAME`
- 使用真實 AI／資料同步時（`AI_MOCK_MODE=false`）：`NVIDIA_API_KEY`、`DASHSCOPE_API_KEY`、
  `FOOTBALL_DATA_API_KEY`、`GUARDIAN_API_KEY`、`NEWS_API_KEY`

`AI_MOCK_MODE=true` 可讓所有觸及 AI 的端點在沒有外部金鑰的情況下正常運作。

## 環境注意事項與陷阱 | Environment notes / gotchas

- **CJK／非 ASCII 路徑下的 Prisma client。** 本專案位於含 CJK 字元的路徑底下。
  Prisma 6.7+ 產生的 `.prisma/client/default.js` 會使用 Node subpath import
  `require('#main-entry-point')`，而當絕對路徑在 Windows 上含有非 ASCII 字元時，
  Node 以 URL 為基礎的 subpath-imports 解析器會找不到套件的 `imports` map。
  我們透過 `apps/api/scripts/patch-prisma-client.cjs` 將該行改寫為 `require('./index.js')`，
  並在 `postinstall` 及 `prisma:generate` / `prisma:migrate` 腳本後自動執行。
  若你曾執行過裸的 `prisma generate`，事後請再執行一次
  `node scripts/patch-prisma-client.cjs`。
- **pnpm** 使用 `node-linker=hoisted`（`.npmrc`），並允許 Prisma 的建置腳本
  （`pnpm.onlyBuiltDependencies`）。
- **資料庫權限。** 遷移角色需要目標資料庫 `public` schema 的 `CREATE` 權限
  （Postgres 15+ 預設會對非擁有者撤銷此權限）。
- **docker-compose** 的設定對齊 `.env` 的憑證；若你已在 5432 執行 Postgres，可跳過它。
