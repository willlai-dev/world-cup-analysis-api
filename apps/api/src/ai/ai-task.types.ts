import type { AiEntityType } from '@prisma/client';

/**
 * Every AI task the router knows how to run. Mirrors the task list in
 * `worldcup_ai_backend_agent_docs/04_BACKEND_AI_JOBS_DATA_SOURCES_SPEC.md`.
 */
export type AiTaskType =
  | 'MATCH_ANALYSIS'
  | 'CHAMPION_PREDICTION_A'
  | 'CHAMPION_PREDICTION_B'
  | 'CHAMPION_PREDICTION_FINAL'
  | 'GENERAL_CHAT'
  | 'PLAYER_HEXAGON_ANALYSIS'
  | 'NEWS_CLASSIFICATION'
  | 'NEWS_TRANSLATION'
  | 'NEWS_IMPACT'
  | 'PLAYER_STATUS_SUMMARY'
  | 'PLAYER_RATING'
  | 'TEAM_SQUAD_ANALYSIS'
  | 'FINAL_REPORT_POLISH'
  | 'JSON_FORMATTING'
  | 'DEEP_MATCH_CHAT'
  | 'DEEP_TEAM_CHAT'
  | 'DEEP_PLAYER_CHAT'
  | 'DEEP_CHAMPION_CHAT'
  | 'DEEP_NEWS_CHAT';

export type ProviderName = 'NVIDIA' | 'QWEN';

/**
 * A logical model slot. The router resolves a slot to a concrete provider +
 * model id via {@link AppConfigService} so model names are never hardcoded.
 */
export type ModelSlot =
  | 'NVIDIA_SUPER'
  | 'NVIDIA_ULTRA'
  | 'QWEN_PLUS'
  | 'QWEN_FLASH'
  | 'QWEN_FLASH_FALLBACK';

export type RoutingRule = {
  primary: ModelSlot;
  /** `null` means no fallback (e.g. champion A/B legs run a single model). */
  fallback: ModelSlot | null;
};

/** Primary → fallback model selection per task (spec §"Model Routing"). */
export const ROUTING_TABLE: Record<AiTaskType, RoutingRule> = {
  MATCH_ANALYSIS: { primary: 'NVIDIA_ULTRA', fallback: 'QWEN_PLUS' },
  CHAMPION_PREDICTION_A: { primary: 'NVIDIA_ULTRA', fallback: null },
  CHAMPION_PREDICTION_B: { primary: 'QWEN_PLUS', fallback: null },
  CHAMPION_PREDICTION_FINAL: { primary: 'QWEN_PLUS', fallback: 'NVIDIA_ULTRA' },
  GENERAL_CHAT: { primary: 'NVIDIA_SUPER', fallback: 'QWEN_PLUS' },
  PLAYER_HEXAGON_ANALYSIS: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
  NEWS_CLASSIFICATION: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
  NEWS_TRANSLATION: { primary: 'QWEN_FLASH', fallback: 'QWEN_FLASH_FALLBACK' },
  NEWS_IMPACT: { primary: 'NVIDIA_SUPER', fallback: 'QWEN_PLUS' },
  PLAYER_STATUS_SUMMARY: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
  PLAYER_RATING: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
  TEAM_SQUAD_ANALYSIS: { primary: 'NVIDIA_ULTRA', fallback: 'QWEN_PLUS' },
  FINAL_REPORT_POLISH: { primary: 'QWEN_PLUS', fallback: 'NVIDIA_ULTRA' },
  JSON_FORMATTING: { primary: 'QWEN_FLASH', fallback: 'QWEN_FLASH_FALLBACK' },
  DEEP_MATCH_CHAT: { primary: 'NVIDIA_ULTRA', fallback: 'QWEN_PLUS' },
  DEEP_TEAM_CHAT: { primary: 'NVIDIA_ULTRA', fallback: 'QWEN_PLUS' },
  DEEP_PLAYER_CHAT: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
  DEEP_CHAMPION_CHAT: { primary: 'QWEN_PLUS', fallback: 'NVIDIA_ULTRA' },
  DEEP_NEWS_CHAT: { primary: 'NVIDIA_SUPER', fallback: 'NVIDIA_ULTRA' },
};

/** Maps a task to the {@link AiEntityType} stored on AiReport / AiUsageLog. */
export const TASK_ENTITY_TYPE: Record<AiTaskType, AiEntityType> = {
  MATCH_ANALYSIS: 'MATCH',
  CHAMPION_PREDICTION_A: 'CHAMPION_PREDICTION',
  CHAMPION_PREDICTION_B: 'CHAMPION_PREDICTION',
  CHAMPION_PREDICTION_FINAL: 'CHAMPION_PREDICTION',
  GENERAL_CHAT: 'GENERAL_CHAT',
  PLAYER_HEXAGON_ANALYSIS: 'PLAYER',
  NEWS_CLASSIFICATION: 'NEWS',
  NEWS_TRANSLATION: 'NEWS',
  NEWS_IMPACT: 'NEWS',
  PLAYER_STATUS_SUMMARY: 'PLAYER',
  PLAYER_RATING: 'PLAYER',
  TEAM_SQUAD_ANALYSIS: 'TEAM',
  FINAL_REPORT_POLISH: 'CHAMPION_PREDICTION',
  JSON_FORMATTING: 'GENERAL_CHAT',
  DEEP_MATCH_CHAT: 'MATCH',
  DEEP_TEAM_CHAT: 'TEAM',
  DEEP_PLAYER_CHAT: 'PLAYER',
  DEEP_CHAMPION_CHAT: 'CHAMPION_PREDICTION',
  DEEP_NEWS_CHAT: 'NEWS',
};

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiChatRequest = {
  model: string;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
};

export type AiChatResponse = {
  provider: ProviderName;
  model: string;
  content: string;
  raw?: unknown;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  latencyMs: number;
};

/** Implemented by {@link NvidiaAdapter} and {@link QwenAdapter}. */
export interface AiProviderAdapter {
  readonly providerName: ProviderName;
  chat(request: AiChatRequest): Promise<AiChatResponse>;
  supportsModel(model: string): boolean;
}

export type AiProviderErrorKind = 'TIMEOUT' | 'HTTP' | 'NETWORK';

/** Typed failure thrown by adapters so the router can log and fall back. */
export class AiProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly model: string,
    readonly kind: AiProviderErrorKind,
    message: string,
    readonly latencyMs = 0,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
