import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function buildCtx(cookies: Record<string, string | undefined>): {
  ctx: ExecutionContext;
  req: { cookies: Record<string, string | undefined>; user?: unknown };
} {
  const req: { cookies: Record<string, string | undefined>; user?: unknown } = { cookies };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
  const prisma = { user: { findUnique: jest.fn() } } as unknown as PrismaService;
  const guard = new JwtAuthGuard(reflector, jwt, prisma);

  beforeEach(() => {
    jest.resetAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
  });

  it('allows public routes without a token', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const { ctx } = buildCtx({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('401 when no token cookie', async () => {
    const { ctx } = buildCtx({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 when token invalid', async () => {
    (jwt.verifyAsync as jest.Mock).mockRejectedValue(new Error('bad'));
    const { ctx } = buildCtx({ access_token: 'x' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('403 when user disabled', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'u@e.com',
      displayName: 'U',
      role: UserRole.USER,
      status: UserStatus.DISABLED,
    });
    const { ctx } = buildCtx({ access_token: 'valid' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes for a valid active user and attaches req.user', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'u@e.com',
      displayName: 'U',
      role: UserRole.PREMIUM,
      status: UserStatus.ACTIVE,
      tokenVersion: 0,
    });
    const { ctx, req } = buildCtx({ access_token: 'valid' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u1', role: UserRole.PREMIUM });
  });

  it('401 when the token predates a password reset (tokenVersion mismatch)', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u1', tv: 0 });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'u@e.com',
      displayName: 'U',
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      tokenVersion: 1,
    });
    const { ctx } = buildCtx({ access_token: 'stale' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
