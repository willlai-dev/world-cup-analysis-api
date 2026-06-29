# 04 Backend AI Router, Jobs & Data Sources Spec

## AI Module 結構

```txt
ai/
├── ai.module.ts
├── ai-router.service.ts
├── ai-prompt.service.ts
├── ai-schema-validator.service.ts
├── providers/
│   ├── ai-provider-adapter.ts
│   ├── nvidia.adapter.ts
│   └── qwen.adapter.ts
├── schemas/
└── dto/
```

## Provider Adapter Interface

```ts
export interface AiProviderAdapter {
  providerName: 'NVIDIA' | 'QWEN';
  chat(request: AiChatRequest): Promise<AiChatResponse>;
  supportsModel(model: string): boolean;
}

export type AiChatRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
};

export type AiChatResponse = {
  provider: 'NVIDIA' | 'QWEN';
  model: string;
  content: string;
  raw?: unknown;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  latencyMs: number;
};
```

## Env

```env
AI_MOCK_MODE=true
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_SUPER=nvidia/nemotron-3-super-120b-a12b
NVIDIA_MODEL_ULTRA=nvidia/nemotron-3-ultra-550b-a55b
DASHSCOPE_API_KEY=
QWEN_OPENAI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_PLUS=qwen3.7-plus
QWEN_MODEL_FLASH=qwen3.6-flash
QWEN_MODEL_FLASH_FALLBACK=qwen3.5-flash
```

## AI Task Types

```ts
MATCH_ANALYSIS
CHAMPION_PREDICTION_A
CHAMPION_PREDICTION_B
CHAMPION_PREDICTION_FINAL
GENERAL_CHAT
PLAYER_HEXAGON_ANALYSIS
NEWS_CLASSIFICATION
NEWS_TRANSLATION
PLAYER_STATUS_SUMMARY
PLAYER_RATING
TEAM_SQUAD_ANALYSIS
FINAL_REPORT_POLISH
JSON_FORMATTING
DEEP_MATCH_CHAT
DEEP_TEAM_CHAT
DEEP_PLAYER_CHAT
DEEP_CHAMPION_CHAT
DEEP_NEWS_CHAT
```

## Model Routing

| Task | Primary | Fallback |
|---|---|---|
| MATCH_ANALYSIS | NVIDIA Ultra | Qwen 3.7 Plus |
| CHAMPION_PREDICTION_A | NVIDIA Ultra | none |
| CHAMPION_PREDICTION_B | Qwen 3.7 Plus | none |
| CHAMPION_PREDICTION_FINAL | Qwen 3.7 Plus | NVIDIA Ultra |
| GENERAL_CHAT | NVIDIA Super | Qwen 3.7 Plus |
| PLAYER_HEXAGON_ANALYSIS | NVIDIA Super | NVIDIA Ultra |
| NEWS_CLASSIFICATION | NVIDIA Super | NVIDIA Ultra |
| NEWS_TRANSLATION | Qwen 3.6 Flash | Qwen 3.5 Flash |
| PLAYER_STATUS_SUMMARY | NVIDIA Super | NVIDIA Ultra |
| PLAYER_RATING | Program Rules + NVIDIA Super | NVIDIA Ultra |
| TEAM_SQUAD_ANALYSIS | NVIDIA Ultra | Qwen 3.7 Plus |
| FINAL_REPORT_POLISH | Qwen 3.7 Plus | NVIDIA Ultra |
| DEEP_MATCH_CHAT | NVIDIA Ultra | Qwen 3.7 Plus |
| DEEP_TEAM_CHAT | NVIDIA Ultra | Qwen 3.7 Plus |
| DEEP_PLAYER_CHAT | NVIDIA Super | NVIDIA Ultra |
| DEEP_CHAMPION_CHAT | Qwen 3.7 Plus | NVIDIA Ultra |
| DEEP_NEWS_CHAT | NVIDIA Super | NVIDIA Ultra |

## AI Router Flow

```txt
receive task
  -> validate role/quota
  -> load DB context
  -> build sourceSnapshotHash
  -> build prompt messages
  -> select primary model
  -> call provider with timeout
  -> validate output
  -> if failed, fallback
  -> save AiReport
  -> save AiUsageLog
  -> return response
```

## Global Skill

每個 AI 任務必須包含：

```txt
你是 AI 世足分析網站的分析引擎。回答必須以網站資料庫提供的資料為主。不可憑空編造比分、賽程、傷病、陣容、球員狀態、新聞來源、排名。如果資料不足，必須明確說「目前資料不足」。回答語言預設為繁體中文。涉及新聞、傷病、球員狀態、賽事狀態時，必須提及資料更新時間。不可提供投注建議或保證性預測。勝負預測只能表述為傾向、風險、條件，不可描述為確定結果。
```

## Page Context Skills

### Match

只能根據目前比賽、雙方國家隊、關鍵球員、事件、既有 AI 報告回答。

### Team

只能根據目前國家隊資料、球員名單、近期賽事、AI 評級、新聞標籤回答。

### Player

只能根據目前球員資料、六邊能力、狀態摘要、新聞標籤、國家隊角色回答。

### Champion

只能根據最新 champion prediction run、entries、模型報告、更新時間回答。

### News

只能根據目前新聞標題、摘要、來源、發布時間、AI 標籤、關聯國家與球員回答。影響分析必須標明是推論。

## Structured Output Schema 摘要

### MatchAnalysisOutput

```ts
type MatchAnalysisOutput = {
  title: string;
  summary: string;
  keyFactors: string[];
  keyPlayers: Array<{ playerName: string; teamName: string; reason: string }>;
  prediction: { homeWinLean: number; drawLean: number; awayWinLean: number; explanation: string };
  risks: string[];
  dataLimitations: string[];
};
```

### PlayerHexagonOutput

```ts
type PlayerHexagonOutput = {
  overallScore: number;
  ratingTier: 'S'|'A_PLUS'|'A'|'B_PLUS'|'B'|'C'|'UNKNOWN';
  attackScore: number;
  creativityScore: number;
  techniqueScore: number;
  defenseScore: number;
  physicalScore: number;
  formScore: number;
  strengths: string[];
  weaknesses: string[];
  roleSummary: string;
  injuryRiskLevel: 'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';
  dataLimitations: string[];
};
```

### NewsClassificationOutput

```ts
type NewsClassificationOutput = {
  summaryZh: string;
  category: 'MATCH'|'PLAYER'|'INJURY'|'TRANSFER'|'TEAM'|'TACTIC'|'CONTROVERSY'|'TOURNAMENT'|'OTHER';
  tags: Array<{ name: string; type: string }>;
  relatedTeamNames: string[];
  relatedPlayerNames: string[];
  confidenceScore: number;
  dataLimitations: string[];
};
```

## Quota 初版

```ts
const quota = {
  USER: { GENERAL_CHAT_PER_DAY: 20 },
  PREMIUM: {
    GENERAL_CHAT_PER_DAY: 100,
    NEWS_TRANSLATION_PER_DAY: 30,
    DEEP_CHAT_PER_DAY: 50,
    CHAMPION_RECALCULATE_PER_WEEK: 3,
  },
  ADMIN: {},
};
```

超過回 429 `AI_QUOTA_EXCEEDED`。

## Jobs Module

所有 jobs 需要 `x-cron-secret`。

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

Job flow：

```txt
create JobRun RUNNING
  -> execute
  -> DONE or FAILED
  -> save metadata/error
```

## Data Sources

| 類型 | 主來源 | 備援 |
|---|---|---|
| 賽程 / 比分 | FIFA | football-data.org |
| 歷史世界盃資料 | OpenFootball | FIFA |
| 國家隊 / 排名 | FIFA | Wikidata |
| 球員基本資料 | FIFA / 官方名單 | Wikidata / TheSportsDB |
| 球員狀態 | Reuters / AP / 官方公告 | BBC / Guardian |
| 新聞列表 | GDELT + RSS | Reuters / AP / FIFA |

## News Flow

```txt
fetch from GDELT/RSS/Guardian
  -> normalize NewsSourceDto
  -> dedupe by sourceUrl
  -> save NewsArticle
  -> NVIDIA summary/classification
  -> save tags
  -> PREMIUM may translate with Qwen
```

不要未授權抓全文；可保存標題、snippet、摘要與來源連結。

## AI / Jobs 測試

1. 模型選擇正確。
2. fallback 正確。
3. mock mode 不呼叫外部 API。
4. invalid output 會 failed。
5. AiUsageLog 被建立。
6. News translation USER 403，PREMIUM success。
7. jobs 無 secret 401。
8. jobs 執行建立 JobRun。
