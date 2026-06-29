# 07 BACKEND READONLY FRONTEND CONTRACT

此文件只讓 Backend Agent 理解前端會如何消費 API。不要實作 Next.js、React 或 Tailwind。

## Frontend Routes Expected by Product

```txt
/
/login
/register
/matches
/matches/[matchId]
/teams
/teams/[teamId]
/players
/players/[playerId]
/champion-predictions
/news
/news/[newsId]
/profile
/favorites
/admin/accounts
/admin/register-admin
```

## Backend API Must Support These Screens

- Home: `GET /home/highlights`
- Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Users: `GET /users/me`, `PATCH /users/me`, `GET /users/me/favorites`
- Admin: `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:userId/role`, `DELETE /admin/users/:userId`, `POST /admin/register-admin`
- Matches: `GET /matches`, `GET /matches/today`, `GET /matches/:matchId`, `GET /matches/:matchId/analysis`, `GET /matches/:matchId/prediction`, `GET /matches/:matchId/post-match-report`, `POST /matches/:matchId/deep-chat`
- Teams: `GET /teams`, `GET /teams/:teamId`, `GET /teams/:teamId/players`, `GET /teams/:teamId/matches`, `GET /teams/:teamId/analysis`, `POST /teams/:teamId/deep-chat`
- Players: `GET /players`, `GET /players/:playerId`, `GET /players/:playerId/rating`, `GET /players/:playerId/analysis`, `POST /players/:playerId/deep-chat`
- Favorites: `GET /users/me/favorites`, `POST /favorites/teams/:teamId`, `DELETE /favorites/teams/:teamId`, `POST /favorites/players/:playerId`, `DELETE /favorites/players/:playerId`
- Champion: `GET /champion-predictions`, `GET /champion-predictions/latest`, `POST /champion-predictions/recalculate`, `POST /champion-predictions/deep-chat`
- News: `GET /news`, `GET /news/:newsId`, `POST /news/:newsId/translate`, `POST /news/:newsId/deep-chat`
- AI: `POST /ai/chat`
- Jobs: protected `/jobs/*`
- Health: `GET /health`

## Response Envelope

Return consistent JSON:

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

For errors:

```json
{
  "data": null,
  "meta": {},
  "error": { "code": "FORBIDDEN", "message": "Permission denied" }
}
```

## Auth Contract

`POST /auth/login` response must include `redirectPath`:

```json
{
  "data": {
    "user": { "id": "...", "email": "...", "displayName": "...", "role": "USER" },
    "redirectPath": "/matches"
  }
}
```

Redirect rules:

- `USER` -> `/matches`
- `PREMIUM` -> `/matches`
- `ADMIN` -> `/admin/accounts`

## Frontend UI Spec For Reference Only

# 08 Frontend Pages & Components Spec

## `/` Home

Public。

Sections：

- Hero。
- 精選重點。
- 熱門賽事。
- 冠軍預測摘要。
- 焦點國家隊。
- 焦點球員。
- 新聞亮點。
- 登入 / 註冊 CTA。

API：`GET /home/highlights`。

## `/login`

Fields：email、password。

成功導向：

```txt
USER/PREMIUM -> /matches
ADMIN -> /admin/accounts
```

## `/register`

Fields：email、displayName、password、confirmPassword。

不可選角色。註冊者預設 USER。

## `/admin/accounts`

ADMIN only。

功能：

- 帳號列表。
- 搜尋。
- role/status filter。
- 新增帳號。
- 修改角色。
- 刪除帳號。

Table columns：Email, Display Name, Role, Status, Created At, Actions。

不可顯示一般 nav 與 floating chat。

## `/matches`

USER/PREMIUM only。

Filters：

- 日期。
- 狀態。
- 階段。
- 國家。
- 分組。

MatchCard：

- 主隊/客隊。
- 國旗。
- 開賽時間。
- 階段。
- 比分。
- AI 摘要。
- 詳情按鈕。

## `/matches/[matchId]`

Sections：

- Match Header。
- Scoreboard。
- Match Info。
- AI Match Analysis。
- Win Prediction。
- Key Players。
- Events Timeline。
- Post Match Review。
- Favorite Teams Actions。
- Deep Chat Panel，PREMIUM only。

## `/teams`

Filters：search、continent、ratingTier、sortBy、sortOrder。

TeamCard：

- 國旗。
- 國名。
- 洲別。
- 分組。
- 教練。
- 評級。
- 冠軍指數。
- 收藏按鈕。

## `/teams/[teamId]`

Sections：

- Team Header。
- Overall Rating。
- Ability Scores。
- AI Team Analysis。
- Recent Matches。
- Upcoming Matches。
- Players List。
- Key Players。
- Favorite Button。
- Deep Chat，PREMIUM only。

## `/players`

Filters：search、teamId、position、ratingTier、sortBy。

PlayerCard：

- 姓名。
- 國家。
- 位置。
- 俱樂部。
- 評級。
- 總分。
- 收藏按鈕。

## `/players/[playerId]`

Sections：

- Player Header。
- Rating Summary。
- Hexagon Ability Chart。
- Player Status Analysis。
- Strengths。
- Weaknesses。
- National Team Role。
- Related News。
- Favorite Button。
- Deep Chat，PREMIUM only。

## `/champion-predictions`

Sections：

- Latest Run Info。
- Champion Ranking Table。
- Final AI Report。
- NVIDIA Analysis A。
- Qwen Analysis B。
- Model Disagreement。
- Deep Chat，PREMIUM only。
- Recalculate Button，PREMIUM only。

USER 可看排行與理由，但不可重跑。

## `/news`

Filters：category、tag、teamId、playerId、sourceName、date。

NewsCard：

- 英文標題。
- 中文摘要。
- 來源。
- 發布時間。
- 分類。
- 標籤。
- 詳情按鈕。

## `/news/[newsId]`

Sections：

- Title。
- Source。
- Published At。
- AI Summary。
- Category。
- Tags。
- Original Link。
- Translation Panel，PREMIUM only。
- News Impact Deep Chat，PREMIUM only。

## `/profile`

USER/PREMIUM only。

- 查看 email。
- 查看 role。
- 修改 displayName。
- 修改 nickname。
- 修改 bio。
- 不可修改 role。

## `/favorites`

USER/PREMIUM only。

- 關注國家。
- 關注球員。
- 點擊進詳情。
- 取消關注。

## Empty/Error 文案

無資料：`目前沒有符合條件的資料。`

AI 尚未生成：`此分析尚未生成，請稍後再查看。`

AI 失敗：`此分析目前產生失敗，請稍後再試。`

權限不足：`你的帳號目前無法使用此功能。`

資料不足：`目前資料不足，無法產生可靠分析。`
