import { SetMetadata } from '@nestjs/common';

export const AI_QUOTA_KEY = 'aiQuotaKey';

/** Quota buckets — DEEP_CHAT aggregates all five DEEP_*_CHAT task types. */
export type QuotaKey =
  | 'GENERAL_CHAT'
  | 'DEEP_CHAT'
  | 'NEWS_TRANSLATION'
  | 'CHAMPION_RECALCULATE';

/** Marks an AI endpoint with the quota bucket QuotaGuard should enforce. */
export const AiQuota = (key: QuotaKey) => SetMetadata(AI_QUOTA_KEY, key);
