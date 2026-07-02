import { ConflictException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'target',
    email: 't@e.com',
    passwordHash: 'h',
    displayName: 'T',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

describe('AdminService soft delete', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
  };
  let service: AdminService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() } };
    service = new AdminService(prisma as unknown as PrismaService);
  });

  it('disables a USER (sets status=DISABLED, keeps the row)', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser());
    prisma.user.update.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));
    const result = await service.softDeleteUser('admin', 'target');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: { status: UserStatus.DISABLED },
    });
    expect(result.user.status).toBe(UserStatus.DISABLED);
  });

  it('rejects disabling your own account', async () => {
    await expect(service.softDeleteUser('same', 'same')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects disabling the last active admin (409)', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildUser({ id: 'target', role: UserRole.ADMIN, status: UserStatus.ACTIVE }),
    );
    prisma.user.count.mockResolvedValue(0); // no other active admins
    await expect(service.softDeleteUser('admin', 'target')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('disables an admin when other active admins exist', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildUser({ role: UserRole.ADMIN, status: UserStatus.ACTIVE }),
    );
    prisma.user.count.mockResolvedValue(1);
    prisma.user.update.mockResolvedValue(buildUser({ role: UserRole.ADMIN, status: UserStatus.DISABLED }));
    const result = await service.softDeleteUser('admin', 'target');
    expect(result.user.status).toBe(UserStatus.DISABLED);
  });

  it('is idempotent when already disabled (no update)', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));
    const result = await service.softDeleteUser('admin', 'target');
    expect(result.success).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('AdminService.getAiUsageStats', () => {
  function buildStats() {
    const prisma = {
      aiUsageLog: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10) // calls
          .mockResolvedValueOnce(8) // done
          .mockResolvedValueOnce(2), // failed
        aggregate: jest.fn().mockResolvedValue({
          _sum: { inputTokenEstimate: 1200, outputTokenEstimate: 3400 },
        }),
        groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) => {
          if (by[0] === 'taskType')
            return Promise.resolve([{ taskType: 'GENERAL_CHAT', _count: { _all: 7 } }]);
          if (by[0] === 'provider')
            return Promise.resolve([{ provider: 'NVIDIA', _count: { _all: 9 } }]);
          if (by[0] === 'requestStatus')
            return Promise.resolve([{ requestStatus: 'DONE', _count: { _all: 8 } }]);
          return Promise.resolve([{ userId: 'u1', _count: { _all: 6 } }]);
        }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ day: new Date('2026-07-01T00:00:00Z'), calls: 10n }]),
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u1', email: 'a@b.c', displayName: 'A' }]),
      },
    };
    const service = new AdminService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  it('aggregates totals / groupings / byDay / topUsers over the window', async () => {
    const { service, prisma } = buildStats();

    const stats = await service.getAiUsageStats({
      from: '2026-06-25T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      taskType: 'GENERAL_CHAT',
    });

    expect(stats.totals).toEqual({
      calls: 10,
      done: 8,
      failed: 2,
      inputTokens: 1200,
      outputTokens: 3400,
    });
    expect(stats.byTaskType).toEqual([{ taskType: 'GENERAL_CHAT', calls: 7 }]);
    expect(stats.byProvider).toEqual([{ provider: 'NVIDIA', calls: 9 }]);
    expect(stats.byStatus).toEqual([{ status: 'DONE', calls: 8 }]);
    expect(stats.byDay).toEqual([{ day: '2026-07-01T00:00:00.000Z', calls: 10 }]);
    expect(stats.topUsers).toEqual([
      { userId: 'u1', email: 'a@b.c', displayName: 'A', calls: 6 },
    ]);

    // taskType filter propagates to every count/groupBy where-clause
    const where = prisma.aiUsageLog.count.mock.calls[0][0].where;
    expect(where.taskType).toBe('GENERAL_CHAT');
    expect(where.createdAt.gte.toISOString()).toBe('2026-06-25T00:00:00.000Z');
  });

  it('defaults the window to the last 7 days', async () => {
    const { service, prisma } = buildStats();

    const stats = await service.getAiUsageStats({});

    const where = prisma.aiUsageLog.count.mock.calls[0][0].where;
    const spanMs =
      where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
    expect(spanMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(new Date(stats.to).getTime()).toBeGreaterThan(
      new Date(stats.from).getTime(),
    );
  });
});
