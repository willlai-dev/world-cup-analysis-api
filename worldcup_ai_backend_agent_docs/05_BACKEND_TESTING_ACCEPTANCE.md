# 05 BACKEND TESTING AND ACCEPTANCE

只實作後端測試，不實作前端測試。

# 09 Testing and Acceptance Plan

## 測試層級

| 層級 | 技術 | 目標 |
|---|---|---|
| Backend Unit | Jest | Service、Guard、AI Router |
| Backend E2E | Jest + Supertest | API、RBAC、Auth |
| Frontend Unit | Vitest + Testing Library | Component、Form、Role UI |
| Frontend E2E | Playwright | 使用者流程 |
| Integration | Test DB / Docker | Prisma + API |

## Backend Unit Tests

### AuthService

- register creates USER。
- register rejects role input。
- duplicate email throws。
- login returns correct redirectPath。
- ADMIN login redirectPath = `/admin/accounts`。
- disabled user cannot login。
- wrong password throws。

### Guards

- JwtAuthGuard：no token 401、invalid 401、disabled 403、valid pass。
- AdminOnlyGuard：ADMIN pass，USER/PREMIUM 403。
- PremiumOnlyGuard：PREMIUM pass，USER/ADMIN 403。
- NonAdminUserGuard：USER/PREMIUM pass，ADMIN 403。

### Favorites

- add team favorite。
- duplicate add no duplicate。
- remove team favorite。
- add player favorite。
- Admin cannot favorite。

### AI Router

- MATCH_ANALYSIS -> NVIDIA Ultra。
- GENERAL_CHAT -> NVIDIA Super。
- NEWS_TRANSLATION -> Qwen 3.6 Flash。
- NVIDIA failure fallback to Qwen。
- invalid JSON fails validation。
- successful task creates AiReport。
- every AI call creates AiUsageLog。

## Backend E2E Tests

Required：

1. Guest GET `/api/home/highlights` -> 200。
2. Guest GET `/api/matches` -> 401。
3. Register USER -> success。
4. Login USER -> redirect `/matches`。
5. Login ADMIN -> redirect `/admin/accounts`。
6. USER GET `/api/admin/users` -> 403。
7. ADMIN GET `/api/admin/users` -> 200。
8. ADMIN GET `/api/matches` -> 403。
9. USER POST `/api/news/:id/translate` -> 403。
10. PREMIUM POST `/api/news/:id/translate` -> 200/mock。
11. USER POST `/api/champion-predictions/recalculate` -> 403。
12. PREMIUM POST `/api/champion-predictions/recalculate` -> 200/202。
13. Wrong cron secret -> 401。
14. Correct cron secret -> 200。
15. Duplicate favorite does not create duplicate。



## Backend Agent Additional Acceptance

- `GET /health` returns 200 without auth.
- `GET /home/highlights` returns public data without auth.
- All protected user APIs return 401 when no token/session.
- Admin cannot access user domain APIs.
- USER/PREMIUM cannot access admin APIs.
- `AI_MOCK_MODE=true` makes AI endpoints testable without external keys.
- Prisma seed creates at least:
  - one ADMIN
  - one USER
  - one PREMIUM
  - teams
  - players
  - matches
  - news
  - champion prediction sample
