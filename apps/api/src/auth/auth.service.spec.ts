import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { EmailFlowService } from './email-flow.service';
import type { TokenService } from './token.service';

const PASSWORD = 'password123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u1',
    email: 'u@e.com',
    passwordHash: PASSWORD_HASH,
    displayName: 'U',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    tokenVersion: 0,
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let tokens: TokenService;
  let emailFlows: { trySendVerification: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    tokens = { sign: jest.fn().mockReturnValue({ token: 't', maxAge: 100 }) } as unknown as TokenService;
    emailFlows = { trySendVerification: jest.fn().mockResolvedValue(true) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens,
      emailFlows as unknown as EmailFlowService,
    );
  });

  describe('register', () => {
    it('creates an unverified USER and sends a verification mail', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(buildUser({ emailVerifiedAt: null }));
      const result = await service.register({
        email: 'u@e.com',
        password: PASSWORD,
        displayName: 'U',
      });
      expect(result.user.role).toBe(UserRole.USER);
      expect(result.user.emailVerified).toBe(false);
      expect(result.requiresEmailVerification).toBe(true);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: UserRole.USER }) }),
      );
      // Accounts never start verified.
      expect(prisma.user.create.mock.calls[0][0].data.emailVerifiedAt).toBeUndefined();
      expect(emailFlows.trySendVerification).toHaveBeenCalledTimes(1);
    });

    it('throws EMAIL_ALREADY_REGISTERED on a verified duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      const attempt = service.register({ email: 'u@e.com', password: PASSWORD, displayName: 'U' });
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'EMAIL_ALREADY_REGISTERED' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('re-enters the verification flow (no duplicate) for an unverified email', async () => {
      const pending = buildUser({ emailVerifiedAt: null });
      prisma.user.findUnique.mockResolvedValue(pending);
      const result = await service.register({
        email: 'u@e.com',
        password: 'another-password',
        displayName: 'U2',
      });
      expect(result.requiresEmailVerification).toBe(true);
      expect(result.user.id).toBe(pending.id);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(emailFlows.trySendVerification).toHaveBeenCalledWith(pending);
    });
  });

  describe('validateAndLogin', () => {
    it('returns redirectPath /matches for USER', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      const result = await service.validateAndLogin({ email: 'u@e.com', password: PASSWORD });
      expect(result.redirectPath).toBe('/matches');
      expect(result.token).toBe('t');
    });

    it('returns redirectPath /admin/accounts for ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ role: UserRole.ADMIN }));
      const result = await service.validateAndLogin({ email: 'a@e.com', password: PASSWORD });
      expect(result.redirectPath).toBe('/admin/accounts');
    });

    it('rejects a disabled user', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));
      await expect(
        service.validateAndLogin({ email: 'u@e.com', password: PASSWORD }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      await expect(
        service.validateAndLogin({ email: 'u@e.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.validateAndLogin({ email: 'no@e.com', password: PASSWORD }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unverified account with EMAIL_NOT_VERIFIED and issues no token', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ emailVerifiedAt: null }));
      const attempt = service.validateAndLogin({ email: 'u@e.com', password: PASSWORD });
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_VERIFIED' } });
      expect(tokens.sign).not.toHaveBeenCalled();
    });

    it('does not reveal the verification state on a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ emailVerifiedAt: null }));
      await expect(
        service.validateAndLogin({ email: 'u@e.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
