import { ForbiddenException, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { AdminOnlyGuard } from './admin-only.guard';
import { NonAdminUserGuard } from './non-admin-user.guard';
import { PremiumOnlyGuard } from './premium-only.guard';

function user(role: UserRole): AuthenticatedUser {
  return { id: 'u1', email: 'u@e.com', displayName: 'U', role, status: UserStatus.ACTIVE };
}

function ctx(u: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
  } as unknown as ExecutionContext;
}

describe('AdminOnlyGuard', () => {
  const guard = new AdminOnlyGuard();
  it('allows ADMIN', () => {
    expect(guard.canActivate(ctx(user(UserRole.ADMIN)))).toBe(true);
  });
  it('forbids USER and PREMIUM', () => {
    expect(() => guard.canActivate(ctx(user(UserRole.USER)))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(user(UserRole.PREMIUM)))).toThrow(ForbiddenException);
  });
  it('401 when unauthenticated', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});

describe('PremiumOnlyGuard', () => {
  const guard = new PremiumOnlyGuard();
  it('allows PREMIUM', () => {
    expect(guard.canActivate(ctx(user(UserRole.PREMIUM)))).toBe(true);
  });
  it('forbids USER and ADMIN', () => {
    expect(() => guard.canActivate(ctx(user(UserRole.USER)))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(user(UserRole.ADMIN)))).toThrow(ForbiddenException);
  });
});

describe('NonAdminUserGuard', () => {
  const guard = new NonAdminUserGuard();
  it('allows USER and PREMIUM', () => {
    expect(guard.canActivate(ctx(user(UserRole.USER)))).toBe(true);
    expect(guard.canActivate(ctx(user(UserRole.PREMIUM)))).toBe(true);
  });
  it('forbids ADMIN', () => {
    expect(() => guard.canActivate(ctx(user(UserRole.ADMIN)))).toThrow(ForbiddenException);
  });
});
