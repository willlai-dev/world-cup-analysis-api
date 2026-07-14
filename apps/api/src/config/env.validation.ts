import { z } from "zod";

const boolFromString = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) =>
      typeof v === "boolean" ? v : v.toLowerCase() === "true",
    );

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  API_GLOBAL_PREFIX: z.string().default("api"),
  FRONTEND_URL: z.string().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECRET: z.string().min(1, "COOKIE_SECRET is required"),
  CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),

  SEED_ADMIN_EMAIL: z.string().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().default("admin123456"),
  SEED_ADMIN_DISPLAY_NAME: z.string().default("Initial Admin"),
  SEED_PREMIUM_EMAIL: z.string().default("premium@example.com"),
  SEED_PREMIUM_PASSWORD: z.string().default("premium123456"),
  SEED_USER_EMAIL: z.string().default("user@example.com"),
  SEED_USER_PASSWORD: z.string().default("user123456"),

  // AI providers (Phase 2/3 — optional in Phase 1 because AI_MOCK_MODE is on)
  NVIDIA_API_KEY: z.string().optional().default(""),
  NVIDIA_BASE_URL: z.string().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL_SUPER: z.string().default("nvidia/nemotron-3-super-120b-a12b"),
  NVIDIA_MODEL_ULTRA: z.string().default("nvidia/nemotron-3-ultra-550b-a55b"),
  DASHSCOPE_API_KEY: z.string().optional().default(""),
  QWEN_OPENAI_BASE_URL: z
    .string()
    .default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
  QWEN_DASHSCOPE_BASE_URL: z
    .string()
    .default("https://dashscope-intl.aliyuncs.com/api/v1"),
  QWEN_MODEL_PLUS: z.string().default("qwen3.7-plus"),
  QWEN_MODEL_FLASH: z.string().default("qwen3.6-flash"),
  QWEN_MODEL_FLASH_FALLBACK: z.string().default("qwen3.5-flash"),

  FOOTBALL_DATA_API_KEY: z.string().optional().default(""),
  FOOTBALL_DATA_BASE_URL: z
    .string()
    .default("https://api.football-data.org/v4"),
  FOOTBALL_DATA_COMPETITION: z.string().default("WC"),
  MATCH_REFRESH_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  GUARDIAN_API_KEY: z.string().optional().default(""),
  GUARDIAN_BASE_URL: z.string().default("https://content.guardianapis.com"),
  NEWS_API_KEY: z.string().optional().default(""),
  NEWS_API_BASE_URL: z.string().default("https://newsapi.org/v2"),

  // Mail (email verification / password reset). NODE_ENV=test always forces
  // the fake provider regardless of MAIL_PROVIDER — tests must never send mail.
  MAIL_PROVIDER: z.enum(["smtp", "gmail", "fake"]).default("fake"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: boolFromString(true),
  SMTP_USER: z.string().optional().default(""),
  SMTP_APP_PASSWORD: z.string().optional().default(""),
  MAIL_FROM_NAME: z.string().default("AI World Cup Analyst"),
  MAIL_FROM_EMAIL: z.string().optional().default(""),
  EMAIL_VERIFY_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15),
  EMAIL_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  EMAIL_DAILY_LIMIT: z.coerce.number().int().positive().default(5),

  AI_MOCK_MODE: boolFromString(true),

  // AI quota (Phase 3) — per-user windows; counts successful calls only
  AI_QUOTA_GENERAL_CHAT_USER_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
  AI_QUOTA_GENERAL_CHAT_PREMIUM_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  AI_QUOTA_NEWS_TRANSLATION_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  AI_QUOTA_DEEP_CHAT_PER_DAY: z.coerce.number().int().positive().default(50),
  AI_QUOTA_CHAMPION_RECALCULATE_PER_WEEK: z.coerce
    .number()
    .int()
    .positive()
    .default(3),

  // Phase 3 generation jobs
  /** Delay between AI calls inside generation loops (NVIDIA 503 mitigation); skipped in mock mode. */
  AI_GENERATION_DELAY_MS: z.coerce.number().int().min(0).default(500),
  /** Players per team covered by the daily status job (top N by overallScore). */
  PLAYER_STATUS_TOP_N: z.coerce.number().int().positive().default(15),
  /** How many days of news feed a player's status context. */
  PLAYER_STATUS_NEWS_DAYS: z.coerce.number().int().positive().default(7),
  /** How far back news-impact generation looks for candidate articles. */
  NEWS_IMPACT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  /** Run FINAL_REPORT_POLISH after each real-mode champion run. */
  CHAMPION_POLISH_ENABLED: boolFromString(true),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
