import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from './quota.service';

const QUOTA = {
  generalChatUserPerDay: 2,
  generalChatPremiumPerDay: 5,
  newsTranslationPerDay: 3,
  deepChatPerDay: 4,
  championRecalculatePerWeek: 3,
};

function build() {
  const prisma = {
    aiUsageLog: { count: jest.fn().mockResolvedValue(0) },
    championPredictionRun: { count: jest.fn().mockResolvedValue(0) },
  };
  const config = { aiQuota: QUOTA } as unknown as AppConfigService;
  const service = new QuotaService(prisma as unknown as PrismaService, config);
  return { service, prisma };
}

function user(role: UserRole = UserRole.USER): AuthenticatedUser {
  return { id: 'u1', role } as AuthenticatedUser;
}

async function expectQuotaError(promise: Promise<void>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error('expected AI_QUOTA_EXCEEDED to be thrown');
}

describe('QuotaService', () => {
  it('passes when usage is below the limit', async () => {
    const { service, prisma } = build();
    prisma.aiUsageLog.count.mockResolvedValue(1);

    await expect(
      service.assertWithinQuota(user(), 'GENERAL_CHAT'),
    ).resolves.toBeUndefined();
  });

  it('throws 429 AI_QUOTA_EXCEEDED with details at the limit', async () => {
    const { service, prisma } = build();
    prisma.aiUsageLog.count.mockResolvedValue(2);

    const err = await expectQuotaError(
      service.assertWithinQuota(user(), 'GENERAL_CHAT'),
    );
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      details: { quotaKey: 'GENERAL_CHAT', limit: 2, used: 2 },
    });
    const details = (err.getResponse() as { details: { resetAt: string } })
      .details;
    expect(new Date(details.resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('applies the PREMIUM limit for GENERAL_CHAT', async () => {
    const { service, prisma } = build();
    prisma.aiUsageLog.count.mockResolvedValue(2);

    await expect(
      service.assertWithinQuota(user(UserRole.PREMIUM), 'GENERAL_CHAT'),
    ).resolves.toBeUndefined();
  });

  it('applies the PREMIUM limit for ADMIN on GENERAL_CHAT (feature superuser)', async () => {
    const { service, prisma } = build();
    // Above the USER limit (2) but below the PREMIUM limit (5): admin shares the premium tier.
    prisma.aiUsageLog.count.mockResolvedValue(4);

    await expect(
      service.assertWithinQuota(user(UserRole.ADMIN), 'GENERAL_CHAT'),
    ).resolves.toBeUndefined();
  });

  it('counts only DONE rows since local midnight for daily buckets', async () => {
    const { service, prisma } = build();
    await service.assertWithinQuota(user(), 'GENERAL_CHAT');

    const where = prisma.aiUsageLog.count.mock.calls[0][0].where;
    expect(where).toMatchObject({
      userId: 'u1',
      requestStatus: 'DONE',
      taskType: { in: ['GENERAL_CHAT'] },
    });
    const start: Date = where.createdAt.gte;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    expect(start.getTime()).toBe(midnight.getTime());
  });

  it('aggregates all five deep-chat task types into DEEP_CHAT', async () => {
    const { service, prisma } = build();
    await service.assertWithinQuota(user(UserRole.PREMIUM), 'DEEP_CHAT');

    const where = prisma.aiUsageLog.count.mock.calls[0][0].where;
    expect(where.taskType.in).toEqual([
      'DEEP_MATCH_CHAT',
      'DEEP_TEAM_CHAT',
      'DEEP_PLAYER_CHAT',
      'DEEP_CHAMPION_CHAT',
      'DEEP_NEWS_CHAT',
    ]);
  });

  it('counts champion recalculates from PREMIUM_USER runs in the ISO week', async () => {
    const { service, prisma } = build();
    prisma.championPredictionRun.count.mockResolvedValue(3);

    const err = await expectQuotaError(
      service.assertWithinQuota(user(UserRole.PREMIUM), 'CHAMPION_RECALCULATE'),
    );
    expect(err.getStatus()).toBe(429);
    expect(prisma.aiUsageLog.count).not.toHaveBeenCalled();

    const where = prisma.championPredictionRun.count.mock.calls[0][0].where;
    expect(where).toMatchObject({
      triggeredByUserId: 'u1',
      triggerType: 'PREMIUM_USER',
    });
    const start: Date = where.createdAt.gte;
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getHours()).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
