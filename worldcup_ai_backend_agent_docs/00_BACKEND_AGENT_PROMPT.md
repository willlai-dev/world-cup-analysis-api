# 00 BACKEND AGENT PROMPT — NestJS / Fastify / Prisma Only

你是 Backend Claude Code / AI coding agent。你的任務是實作 **AI World Cup Analyst 後端**。

## 絕對邊界

你只負責後端：`apps/api`、Prisma、PostgreSQL schema、NestJS modules、API、Auth/RBAC、AI Router、Jobs、Data Sources、後端測試與後端部署設定。

若需要前端資訊，只能把 `07_BACKEND_READONLY_FRONTEND_CONTRACT.md` 視為「API 消費者合約」，不要實作 UI。

## 你要閱讀的文件

請只閱讀本資料夾內文件，按照順序：

1. `00_BACKEND_AGENT_PROMPT.md`
2. `01_BACKEND_SCOPE_RBAC_AND_PHASES.md`
3. `02_BACKEND_DATABASE_PRISMA_SPEC.md`
4. `03_BACKEND_NESTJS_API_SPEC.md`
5. `04_BACKEND_AI_JOBS_DATA_SOURCES_SPEC.md`
6. `05_BACKEND_TESTING_ACCEPTANCE.md`
7. `06_BACKEND_ENV_DEPLOYMENT.md`
8. `07_BACKEND_READONLY_FRONTEND_CONTRACT.md`

## 技術選型

- NestJS
- Fastify Adapter
- TypeScript strict
- Prisma ORM
- PostgreSQL
- JWT 或 HttpOnly Cookie Session；建議 HttpOnly Cookie + 後端 `/auth/me`
- bcrypt 或 argon2
- Swagger / OpenAPI
- Jest + Supertest
- AI Provider：NVIDIA Build / NIM API、Qwen Cloud / DashScope

## 必須實作的後端原則

1. 前端只呼叫本後端 API。
2. NVIDIA、Qwen、足球資料、新聞資料 API key 只能放後端環境變數。
3. 所有 role / permission 由後端最終判斷。
4. Admin 是帳號管理角色，不是一般功能超級使用者。
5. Admin 登入後 redirectPath 必須是 `/admin/accounts`。
6. Admin 不能使用一般功能 API：matches、teams、players、news、champion predictions、favorites、AI chat。
7. USER / PREMIUM 不能進入 `/admin/*`。
8. USER 不能使用新聞翻譯、詳細頁深層問答、重新跑冠軍預測。
9. PREMIUM 才能使用新聞翻譯、詳細頁深層問答、重新跑冠軍預測。
10. AI 輸出必須經 schema validation 或結構檢查後才存 DB。
11. AI 回答必須以 DB snapshot / retrieved context 為準，不可捏造比分、傷病、陣容、新聞或球員狀態。
12. 高成本 AI 功能要可加 quota。Phase 1 可先留 service/hook；Phase 3 必須完成。
13. 所有 job endpoint 必須用 `CRON_SECRET` 或 internal guard 保護。
14. 實作 `AI_MOCK_MODE=true`，讓測試與無 API key 本地開發可跑。

## 實作順序

### Phase 1 Backend

先完成：

- NestJS + Fastify bootstrap
- ConfigModule
- PrismaModule
- PostgreSQL schema
- seed initial admin + demo teams/players/matches/news/champion prediction
- AuthModule
- RBAC guards
- AdminModule
- read APIs：matches、teams、players、news、champion predictions、home highlights
- Favorites APIs
- backend unit/e2e tests

### Phase 2 Backend

再完成：

- AiModule
- NvidiaAdapter
- QwenAdapter
- AiRouterService
- AI_MOCK_MODE
- AiUsageLog
- News summarize/classify/translate
- Match/team/player/champion AI reports
- General chat

### Phase 3 Backend

最後完成：

- premium deep chat
- champion prediction recalculation
- model disagreement support
- news impact analysis
- quota enforcement
- final report polish
- full acceptance tests

## 交付要求

完成後輸出：

- 已完成項目
- 未完成項目
- 主要變更檔案
- local setup 指令
- migration / seed 指令
- test 指令
- 需要人工設定的 env keys
- 與規格不一致處
