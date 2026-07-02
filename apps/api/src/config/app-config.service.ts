import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./env.validation";

/**
 * Typed accessor over the validated environment. Inject this instead of the
 * raw ConfigService so callers get fully typed, non-optional config values.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env["NODE_ENV"] {
    return this.get("NODE_ENV");
  }
  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }
  get isTest(): boolean {
    return this.nodeEnv === "test";
  }
  get port(): number {
    return this.get("PORT");
  }
  get apiPrefix(): string {
    return this.get("API_GLOBAL_PREFIX");
  }
  get frontendUrl(): string {
    return this.get("FRONTEND_URL");
  }

  get jwtSecret(): string {
    return this.get("JWT_SECRET");
  }
  get jwtExpiresIn(): string {
    return this.get("JWT_EXPIRES_IN");
  }
  get cookieSecret(): string {
    return this.get("COOKIE_SECRET");
  }
  get cronSecret(): string {
    return this.get("CRON_SECRET");
  }

  get seedAdmin() {
    return {
      email: this.get("SEED_ADMIN_EMAIL"),
      password: this.get("SEED_ADMIN_PASSWORD"),
      displayName: this.get("SEED_ADMIN_DISPLAY_NAME"),
    };
  }
  get seedPremium() {
    return {
      email: this.get("SEED_PREMIUM_EMAIL"),
      password: this.get("SEED_PREMIUM_PASSWORD"),
    };
  }
  get seedUser() {
    return {
      email: this.get("SEED_USER_EMAIL"),
      password: this.get("SEED_USER_PASSWORD"),
    };
  }

  get aiMockMode(): boolean {
    return this.get("AI_MOCK_MODE");
  }
  get aiGenerationDelayMs(): number {
    return this.get("AI_GENERATION_DELAY_MS");
  }
  get playerStatus() {
    return {
      topN: this.get("PLAYER_STATUS_TOP_N"),
      newsDays: this.get("PLAYER_STATUS_NEWS_DAYS"),
    };
  }
  get newsImpactLookbackDays(): number {
    return this.get("NEWS_IMPACT_LOOKBACK_DAYS");
  }
  get aiQuota() {
    return {
      generalChatUserPerDay: this.get("AI_QUOTA_GENERAL_CHAT_USER_PER_DAY"),
      generalChatPremiumPerDay: this.get(
        "AI_QUOTA_GENERAL_CHAT_PREMIUM_PER_DAY",
      ),
      newsTranslationPerDay: this.get("AI_QUOTA_NEWS_TRANSLATION_PER_DAY"),
      deepChatPerDay: this.get("AI_QUOTA_DEEP_CHAT_PER_DAY"),
      championRecalculatePerWeek: this.get(
        "AI_QUOTA_CHAMPION_RECALCULATE_PER_WEEK",
      ),
    };
  }
  get nvidia() {
    return {
      apiKey: this.get("NVIDIA_API_KEY"),
      baseUrl: this.get("NVIDIA_BASE_URL"),
      modelSuper: this.get("NVIDIA_MODEL_SUPER"),
      modelUltra: this.get("NVIDIA_MODEL_ULTRA"),
    };
  }
  get qwen() {
    return {
      apiKey: this.get("DASHSCOPE_API_KEY"),
      openaiBaseUrl: this.get("QWEN_OPENAI_BASE_URL"),
      dashscopeBaseUrl: this.get("QWEN_DASHSCOPE_BASE_URL"),
      modelPlus: this.get("QWEN_MODEL_PLUS"),
      modelFlash: this.get("QWEN_MODEL_FLASH"),
      modelFlashFallback: this.get("QWEN_MODEL_FLASH_FALLBACK"),
    };
  }

  get footballData() {
    return {
      apiKey: this.get("FOOTBALL_DATA_API_KEY"),
      baseUrl: this.get("FOOTBALL_DATA_BASE_URL"),
      competition: this.get("FOOTBALL_DATA_COMPETITION"),
    };
  }
  get matchRefreshCooldownSeconds(): number {
    return this.get("MATCH_REFRESH_COOLDOWN_SECONDS");
  }
  get guardian() {
    return {
      apiKey: this.get("GUARDIAN_API_KEY"),
      baseUrl: this.get("GUARDIAN_BASE_URL"),
    };
  }
  get newsApi() {
    return {
      apiKey: this.get("NEWS_API_KEY"),
      baseUrl: this.get("NEWS_API_BASE_URL"),
    };
  }
}
