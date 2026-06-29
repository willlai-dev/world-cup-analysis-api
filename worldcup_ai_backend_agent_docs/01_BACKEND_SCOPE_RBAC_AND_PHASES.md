# 01 BACKEND SCOPE, RBAC AND PHASES

本文件是 Backend Agent 的產品範圍、角色權限與階段實作規格。只實作後端能力，不實作前端 UI。

---

# 00 Project Overview

## 專案名稱

AI World Cup Analyst / AI 世足分析網站

## 產品核心

這是一個以 AI 分析為核心的世足網站。它不是只列出比分與新聞，而是把資料轉換成：

- 賽前分析。
- 賽後回顧。
- 國家隊能力評級。
- 球員六邊能力與狀態摘要。
- 冠軍預測排行與理由。
- 英文新聞摘要、分類、標籤與翻譯。
- 一般問答與高級深層問答。

## 系統角色

| 角色 | 說明 |
|---|---|
| Guest | 未登入訪客，只能看首頁 |
| USER | 一般使用者，可瀏覽主要頁、收藏、使用一般問答 |
| PREMIUM | 高級使用者，可使用新聞翻譯、深層問答、重新跑冠軍預測 |
| ADMIN | 只負責帳號管理，不使用一般系統功能 |

## 總體模組

1. 首頁精選模組。
2. 註冊模組。
3. 登入 / 登出模組。
4. 使用者下拉選單模組。
5. 基本資料模組。
6. 關注國家 / 球員模組。
7. 賽事列表模組。
8. 單場賽事分析模組。
9. 國家隊列表模組。
10. 國家隊詳細分析模組。
11. 球員列表模組。
12. 球員詳細分析模組。
13. 冠軍預測模組。
14. 新聞列表 / 分類 / 標籤模組。
15. 新聞翻譯模組。
16. 一般懸浮 AI 問答模組。
17. 詳細頁深層 AI 問答模組。
18. Admin 帳號管理模組。
19. Admin 註冊模組。

## 建議 Monorepo 結構

```txt
worldcup-ai-analyst/
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # NestJS backend
├── packages/
│   └── shared-types/        # 可選，共用型別
├── docs/
│   └── agent-specs/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## 不可違反的設計約束

- 前端只呼叫自己的後端。
- AI API 與資料來源 API 只由後端呼叫。
- 主要 AI 內容應保存到 DB，不要每次頁面載入都重新生成。
- 高成本 AI 功能需權限與 quota。
- Admin 角色與一般功能隔離。
- 測試要覆蓋角色權限。


---

# 01 Functional Requirements

## 權限總表

| 功能 | Guest | USER | PREMIUM | ADMIN |
|---|---:|---:|---:|---:|
| 首頁 | 可 | 可 | 可 | 不使用 |
| 註冊一般帳號 | 可 | - | - | 可新增帳號 |
| 登入 | 可 | 可 | 可 | 可 |
| 賽事頁 | 不可 | 可 | 可 | 不使用 |
| 單場賽事詳情 | 不可 | 可 | 可 | 不使用 |
| 國家隊列表/詳情 | 不可 | 可 | 可 | 不使用 |
| 球員列表/詳情 | 不可 | 可 | 可 | 不使用 |
| 冠軍預測頁 | 不可 | 可 | 可 | 不使用 |
| 新聞頁 | 不可 | 可 | 可 | 不使用 |
| 新聞翻譯 | 不可 | 不可 | 可 | 不使用 |
| 一般懸浮問答 | 不可 | 可 | 可 | 不使用 |
| 詳細頁深層問答 | 不可 | 不可 | 可 | 不使用 |
| 重新跑冠軍預測 | 不可 | 不可 | 可 | 不使用 |
| 基本資料 | 不可 | 可 | 可 | 不使用 |
| 關注名單 | 不可 | 可 | 可 | 不使用 |
| 收藏國家/球員 | 不可 | 可 | 可 | 不使用 |
| 帳號管理 | 不可 | 不可 | 不可 | 可 |
| 新增 / 修改 / 刪除帳號 | 不可 | 不可 | 不可 | 可 |

## 首頁

公開頁面，未登入可看。

功能：

- 精選重點：熱門賽事、熱門國家、焦點球員、冠軍預測摘要。
- 熱門賽事區塊。
- 冠軍預測摘要，只顯示簡要排行，不顯示完整頁面。
- 焦點國家隊。
- 焦點球員。
- 登入 / 註冊入口。

## 註冊與登入

### 一般註冊

- 未登入使用者可註冊。
- 註冊後預設 USER。
- 不可自行註冊 PREMIUM。
- 不可自行註冊 ADMIN。

### Admin 註冊

- 只有 Admin 登入後可新增 Admin。
- 第一個 Admin 由 seed 手動建立。

### 登入導向

```txt
USER -> /matches
PREMIUM -> /matches
ADMIN -> /admin/accounts
```

## 使用者下拉選單

USER / PREMIUM：

- 基本資料。
- 關注名單。
- 登出。

ADMIN：

- 帳號管理。
- 註冊 Admin。
- 登出。

## 賽事功能

賽事列表：

- 查看所有賽事。
- 已結束賽事：比分、賽後摘要、賽後分析。
- 未開始賽事：賽前預測、比賽資訊。
- 依日期篩選。
- 依階段篩選。
- 依國家篩選。

單場詳情：

- 比賽基本資訊。
- AI 賽事分析。
- AI 勝負預測。
- 關鍵球員。
- 已結束賽事回顧。
- 加入關注國家。
- PREMIUM 才可深層問答。

## 國家隊功能

列表：

- 查看所有國家隊。
- 搜尋。
- 評級篩選 S/A/B/C。
- 洲別篩選。
- 排序：冠軍指數、整體評級、近期狀態。

詳情：

- 國家隊基本資訊。
- 國家隊整體評級。
- 國家隊能力分析：進攻、防守、中場、狀態。
- 近期賽事狀況。
- 球員名單。
- 關鍵球員。
- 收藏國家。
- PREMIUM 深層問答。

## 球員功能

列表：

- 查看所有球員。
- 依國家、位置、評級篩選。
- 依能力值排序：進攻、創造、技術、防守、身體、狀態。
- 搜尋球員。

詳情：

- 球員基本資訊。
- AI 球員評級。
- 六邊能力值。
- 球員狀況分析。
- 優勢與弱點。
- 國家隊角色。
- 收藏球員。
- PREMIUM 深層問答。

## 冠軍預測功能

USER/PREMIUM 可看：

- 冠軍預測排行。
- 國家評級。
- 預測理由。
- 更新時間。

PREMIUM 額外可：

- 深層問答。
- 重新跑冠軍預測。
- 查看或觸發雙模型交叉分析。

## 新聞功能

新聞以英文來源為主。抓取後先做 AI 摘要、分類與標籤。

USER/PREMIUM 可看：

- 新聞列表。
- AI 摘要。
- 原文標題。
- 分類與標籤。
- 依分類、標籤、國家、球員篩選。
- 新聞詳情與來源連結。

PREMIUM 額外可：

- 使用 Qwen 翻譯新聞為繁體中文。
- 針對新聞做深層問答與影響分析。

## 一般懸浮問答

- 右下角浮動球。
- USER/PREMIUM 可用。
- Admin 不顯示。
- 回答根據網站資料。
- 可問賽事、國家、球員、新聞、冠軍預測。

範例：

```txt
目前有哪些未開始的重點賽事？
法國有哪些高評級球員？
目前冠軍預測前三名是誰？
最近有哪些關於阿根廷的新聞？
哪些球員狀態最好？
```

## 深層問答

PREMIUM only。

可用頁面：

- 賽事詳情。
- 國家隊詳情。
- 球員詳情。
- 冠軍預測。
- 新聞詳情。

深層問答必須限制在目前頁面的 context，不可變成開放式閒聊。

## Admin 帳號管理

- Admin 登入後直接進 `/admin/accounts`。
- 查看帳號列表。
- 新增 USER / PREMIUM / ADMIN。
- 修改身分。
- 刪除帳號。
- 跳轉 Admin 註冊頁。
- 登出。
- Admin 不使用一般系統功能。


---

# 02 Phase Implementation Plan

## 三階段總覽

| 階段 | 目標 | 核心成果 |
|---|---|---|
| Phase 1 | 基礎網站與資料瀏覽 MVP | Auth、RBAC、Admin、主要頁、收藏、seed data |
| Phase 2 | 核心 AI 分析功能 | AI Router、NVIDIA/Qwen、新聞摘要分類、賽事/球員/國家分析、冠軍雙模型、一般問答 |
| Phase 3 | 高級功能與模型交叉分析 | 深層問答、冠軍重跑、模型分歧、新聞影響、報告修稿、quota |

---

# Phase 1：基礎網站與資料瀏覽 MVP

## 目標

先讓網站可登入、可依角色導向、可看主要資料、可收藏、可管理帳號。AI 可先用 mock 或 seed 報告，不必接真實 provider。

## 後端任務

1. 建立 NestJS + Fastify 專案。
2. 建立 ConfigModule、PrismaModule、HealthModule。
3. 建立 Prisma schema 與 seed。
4. 建立 AuthModule：註冊、登入、登出、me。
5. 建立 RBAC guards。
6. 建立 AdminModule：帳號列表、新增、改角色、刪除、註冊 Admin。
7. 建立 Matches / Teams / Players / News / ChampionPrediction read APIs。
8. 建立 Favorites APIs。
9. 建立基本 e2e 測試。

## 前端任務

1. 建立 Next.js + Tailwind 專案。
2. 建立 API client。
3. 建立 AuthProvider / auth store。
4. 建立 route guard。
5. 建立首頁、登入、註冊。
6. 建立 Admin 帳號管理頁。
7. 建立賽事、國家隊、球員、新聞、冠軍預測、基本資料、關注名單頁。
8. 建立 loading/error/empty states。
9. 建立基礎 E2E。

## Phase 1 不做

- 真實 AI 呼叫。
- 深層問答。
- 新聞翻譯。
- 冠軍預測重跑。
- 模型分歧顯示。
- quota。

## Phase 1 驗收

- Guest 只可看首頁。
- USER/PREMIUM 可看主要功能。
- ADMIN 只可看 Admin 頁。
- 收藏功能可用。
- Seed data 可完整展示。
- 權限測試通過。

---

# Phase 2：核心 AI 分析功能

## 目標

導入 NVIDIA 與 Qwen，讓網站具備 AI 分析價值。

## 後端任務

1. 建立 AiModule。
2. 建立 AiRouterService。
3. 建立 NvidiaAdapter。
4. 建立 QwenAdapter。
5. 建立 AiPromptService。
6. 建立 AiSchemaValidator。
7. 建立 AiUsageLog。
8. 建立 AI_MOCK_MODE。
9. 新聞摘要與分類標籤。
10. 新聞翻譯。
11. 賽事分析。
12. 國家隊分析。
13. 球員評級與六邊能力。
14. 冠軍預測 A/B/final。
15. 一般懸浮問答 API。

## 前端任務

1. AI Report Card。
2. Provider/model/time badge。
3. Floating chat。
4. 新聞翻譯 UI。
5. 球員六邊能力圖。
6. 冠軍預測報告展示。
7. AI pending/failed states。

## Phase 2 驗收

- AI Router 可 mock 與真實呼叫。
- NVIDIA 失敗可 fallback。
- Qwen 翻譯可 fallback。
- AI 報告保存到 DB。
- 一般問答可用。
- USER 不可翻譯。
- PREMIUM 可翻譯。

---

# Phase 3：高級功能與交叉分析

## 目標

建立高級使用者差異化能力。

## 後端任務

1. 深層問答 APIs。
2. 冠軍預測重新計算。
3. 模型分歧保存。
4. 新聞影響分析。
5. 最終報告修稿。
6. quota / rate limit。
7. 更完整 usage statistics。

## 前端任務

1. 深層問答 panel。
2. 冠軍重跑按鈕。
3. 模型分歧面板。
4. quota error UX。
5. 新聞影響分析 UI。

## Phase 3 驗收

- PREMIUM 可深層問答。
- USER 深層問答回 403 或 UI 不顯示。
- PREMIUM 可重跑冠軍預測且受 quota 控制。
- 模型分歧可顯示。
- 新聞影響分析使用謹慎語氣。
- AI 不捏造資料。
