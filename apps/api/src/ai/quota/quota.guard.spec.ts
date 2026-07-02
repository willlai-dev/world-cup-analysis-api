import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { QuotaService } from './quota.service';
import { QuotaGuard } from './quota.guard';

function buildContext(user?: Partial<AuthenticatedUser>): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function build(quotaKey?: string) {
  const assertWithinQuota = jest.fn().mockResolvedValue(undefined);
  const reflector = { get: jest.fn().mockReturnValue(quotaKey) };
  const guard = new QuotaGuard(
    { assertWithinQuota } as unknown as QuotaService,
    reflector as unknown as Reflector,
  );
  return { guard, assertWithinQuota };
}

describe('QuotaGuard', () => {
  it('passes through when no @AiQuota metadata is present', async () => {
    const { guard, assertWithinQuota } = build(undefined);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(assertWithinQuota).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    const { guard } = build('GENERAL_CHAT');

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('delegates to QuotaService with the metadata key', async () => {
    const { guard, assertWithinQuota } = build('DEEP_CHAT');
    const user = { id: 'u1', role: UserRole.PREMIUM };

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
    expect(assertWithinQuota).toHaveBeenCalledWith(user, 'DEEP_CHAT');
  });
});
