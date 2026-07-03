import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  AiReportStatus,
  ChampionPredictionTriggerType,
  UserRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { QuotaKey } from './ai-quota.decorator';

/** Task types counted against the DEEP_CHAT bucket. */
const DEEP_CHAT_TASK_TYPES = [
  'DEEP_MATCH_CHAT',
  'DEEP_TEAM_CHAT',
  'DEEP_PLAYER_CHAT',
  'DEEP_CHAMPION_CHAT',
  'DEEP_NEWS_CHAT',
];

const KEY_LABEL: Record<QuotaKey, string> = {
  GENERAL_CHAT: '一般問答',
  DEEP_CHAT: '深層問答',
  NEWS_TRANSLATION: '新聞翻譯',
  CHAMPION_RECALCULATE: '冠軍預測重新計算',
};

interface QuotaWindow {
  limit: number;
  windowStart: Date;
  resetAt: Date;
  windowLabel: '今日' | '本週';
}

/**
 * Per-user AI quota. Chat/deep-chat/translation count successful AiUsageLog
 * rows (exactly one DONE row per successful call, mock included; failed calls
 * only leave FAILED rows and are free). Champion recalculation counts
 * ChampionPredictionRun rows instead, because the mock path bypasses the
 * router (no usage log) but always creates a run.
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async assertWithinQuota(
    user: AuthenticatedUser,
    key: QuotaKey,
  ): Promise<void> {
    const window = this.resolveWindow(user.role, key);
    const used = await this.countUsed(user.id, key, window.windowStart);
    if (used < window.limit) {
      return;
    }
    throw new HttpException(
      {
        code: 'AI_QUOTA_EXCEEDED',
        message: `${window.windowLabel}${KEY_LABEL[key]}額度已用完（${window.limit} 次），請於 ${window.resetAt.toLocaleString('zh-TW')} 後再試。`,
        details: {
          quotaKey: key,
          limit: window.limit,
          used,
          resetAt: window.resetAt.toISOString(),
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private resolveWindow(role: UserRole, key: QuotaKey): QuotaWindow {
    const quota = this.config.aiQuota;
    if (key === 'CHAMPION_RECALCULATE') {
      const { start, resetAt } = startOfIsoWeek();
      return {
        limit: quota.championRecalculatePerWeek,
        windowStart: start,
        resetAt,
        windowLabel: '本週',
      };
    }
    const { start, resetAt } = startOfDay();
    const limit =
      key === 'GENERAL_CHAT'
        ? role === UserRole.USER
          ? quota.generalChatUserPerDay
          : quota.generalChatPremiumPerDay // PREMIUM and ADMIN share the premium tier
        : key === 'DEEP_CHAT'
          ? quota.deepChatPerDay
          : quota.newsTranslationPerDay;
    return { limit, windowStart: start, resetAt, windowLabel: '今日' };
  }

  private countUsed(
    userId: string,
    key: QuotaKey,
    windowStart: Date,
  ): Promise<number> {
    if (key === 'CHAMPION_RECALCULATE') {
      return this.prisma.championPredictionRun.count({
        where: {
          triggeredByUserId: userId,
          triggerType: ChampionPredictionTriggerType.PREMIUM_USER,
          createdAt: { gte: windowStart },
        },
      });
    }
    const taskTypes =
      key === 'DEEP_CHAT'
        ? DEEP_CHAT_TASK_TYPES
        : key === 'GENERAL_CHAT'
          ? ['GENERAL_CHAT']
          : ['NEWS_TRANSLATION'];
    return this.prisma.aiUsageLog.count({
      where: {
        userId,
        taskType: { in: taskTypes },
        requestStatus: AiReportStatus.DONE,
        createdAt: { gte: windowStart },
      },
    });
  }
}

/** Local-time calendar day window (spec says 每日). */
function startOfDay(): { start: Date; resetAt: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const resetAt = new Date(start);
  resetAt.setDate(resetAt.getDate() + 1);
  return { start, resetAt };
}

/** Local-time ISO week window, Monday 00:00 (spec says 每週). */
function startOfIsoWeek(): { start: Date; resetAt: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const resetAt = new Date(start);
  resetAt.setDate(resetAt.getDate() + 7);
  return { start, resetAt };
}
