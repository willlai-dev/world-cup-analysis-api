import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { AuthTokenPurpose, UserRole, UserStatus } from '@prisma/client';
import type { AppConfigService } from '../config/app-config.service';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { EmailFlowService } from './email-flow.service';

const NOW = Date.now();

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u1',
    email: 'u@e.com',
    passwordHash: 'hash',
    displayName: 'U',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: null,
    tokenVersion: 0,
    ...overrides,
  };
}

function buildTokenRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tok1',
    userId: 'u1',
    purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
    tokenHash: 'stored-hash',
    expiresAt: new Date(NOW + 15 * 60 * 1000),
    usedAt: null,
    invalidatedAt: null,
    createdAt: new Date(NOW),
    user: buildUser(),
    ...overrides,
  };
}

describe('EmailFlowService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    authToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    emailSendRequest: { findMany: jest.Mock; create: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mail: { sendEmailVerification: jest.Mock; sendPasswordReset: jest.Mock; sendPasswordChangedNotice: jest.Mock };
  let service: EmailFlowService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      authToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      emailSendRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      // Mocked model calls resolve eagerly, so the "transaction" just awaits them.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    mail = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedNotice: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      authTokens: {
        verifyTtlMinutes: 15,
        resetTtlMinutes: 15,
        resendCooldownSeconds: 60,
        dailyLimit: 5,
      },
    } as unknown as AppConfigService;
    service = new EmailFlowService(
      prisma as unknown as PrismaService,
      config,
      mail as unknown as MailService,
    );
  });

  describe('token issuance', () => {
    it('stores only a hash — never the raw token — and invalidates older tokens', async () => {
      await service.trySendVerification({ id: 'u1', email: 'u@e.com' });

      const created = prisma.authToken.create.mock.calls[0][0].data;
      const rawToken = mail.sendEmailVerification.mock.calls[0][1] as string;
      expect(rawToken.length).toBeGreaterThanOrEqual(32);
      expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
      expect(created.tokenHash).not.toBe(rawToken);
      expect(prisma.authToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
            usedAt: null,
            invalidatedAt: null,
          }),
        }),
      );
    });

    it('skips sending inside the cooldown window without throwing', async () => {
      prisma.emailSendRequest.findMany.mockResolvedValue([{ createdAt: new Date(NOW - 10_000) }]);
      const sent = await service.trySendVerification({ id: 'u1', email: 'u@e.com' });
      expect(sent).toBe(false);
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('throws EMAIL_SEND_COOLDOWN inside the 60s window', async () => {
      prisma.emailSendRequest.findMany.mockResolvedValue([{ createdAt: new Date(NOW - 10_000) }]);
      const attempt = service.resendVerification('u@e.com');
      await expect(attempt).rejects.toBeInstanceOf(HttpException);
      await expect(attempt).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_SEND_COOLDOWN' }),
      });
    });

    it('throws EMAIL_DAILY_LIMIT_EXCEEDED after 5 sends in 24h', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        createdAt: new Date(NOW - (i + 2) * 60 * 60 * 1000),
      }));
      prisma.emailSendRequest.findMany.mockResolvedValue(rows);
      await expect(service.resendVerification('u@e.com')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_DAILY_LIMIT_EXCEEDED' }),
      });
    });

    it('resolves silently for an unknown email (no enumeration) but records the attempt', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resendVerification('ghost@e.com')).resolves.toBeUndefined();
      expect(prisma.emailSendRequest.create).toHaveBeenCalled();
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('rejects an already-verified account with EMAIL_ALREADY_VERIFIED', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ emailVerifiedAt: new Date() }));
      await expect(service.resendVerification('u@e.com')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('verifyEmail', () => {
    it('rejects an unknown token as EMAIL_VERIFICATION_TOKEN_INVALID', async () => {
      prisma.authToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('nope')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_VERIFICATION_TOKEN_INVALID' }),
      });
    });

    it('rejects a used token (single-use)', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({ usedAt: new Date(NOW - 1000) }),
      );
      await expect(service.verifyEmail('t')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_VERIFICATION_TOKEN_INVALID' }),
      });
    });

    it('rejects an invalidated (superseded) token', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({ invalidatedAt: new Date(NOW - 1000) }),
      );
      await expect(service.verifyEmail('t')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired token as EMAIL_VERIFICATION_TOKEN_EXPIRED', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({ expiresAt: new Date(NOW - 1000) }),
      );
      await expect(service.verifyEmail('t')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_VERIFICATION_TOKEN_EXPIRED' }),
      });
    });

    it('rejects a reset-purpose token used against verification', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({ purpose: AuthTokenPurpose.PASSWORD_RESET }),
      );
      await expect(service.verifyEmail('t')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the user verified and the token used on success', async () => {
      prisma.authToken.findUnique.mockResolvedValue(buildTokenRecord());
      await service.verifyEmail('t');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.authToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('resolves silently for an unknown email (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestPasswordReset('ghost@e.com')).resolves.toBeUndefined();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('sends a reset mail for an active account', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ emailVerifiedAt: new Date() }));
      await service.requestPasswordReset('u@e.com');
      expect(mail.sendPasswordReset).toHaveBeenCalledWith('u@e.com', expect.any(String));
    });

    it('applies the cooldown before the account lookup (uniform behavior)', async () => {
      prisma.emailSendRequest.findMany.mockResolvedValue([{ createdAt: new Date(NOW - 5_000) }]);
      await expect(service.requestPasswordReset('anyone@e.com')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EMAIL_SEND_COOLDOWN' }),
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const resetRecord = () =>
      buildTokenRecord({ purpose: AuthTokenPurpose.PASSWORD_RESET });

    it('rejects mismatched passwords', async () => {
      await expect(service.resetPassword('t', 'password123', 'password456')).rejects.toMatchObject(
        { response: expect.objectContaining({ code: 'PASSWORD_MISMATCH' }) },
      );
    });

    it('rejects a used token as PASSWORD_RESET_TOKEN_USED', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({ purpose: AuthTokenPurpose.PASSWORD_RESET, usedAt: new Date() }),
      );
      await expect(service.resetPassword('t', 'password123', 'password123')).rejects.toMatchObject(
        { response: expect.objectContaining({ code: 'PASSWORD_RESET_TOKEN_USED' }) },
      );
    });

    it('rejects an expired token as PASSWORD_RESET_TOKEN_EXPIRED', async () => {
      prisma.authToken.findUnique.mockResolvedValue(
        buildTokenRecord({
          purpose: AuthTokenPurpose.PASSWORD_RESET,
          expiresAt: new Date(NOW - 1000),
        }),
      );
      await expect(service.resetPassword('t', 'password123', 'password123')).rejects.toMatchObject(
        { response: expect.objectContaining({ code: 'PASSWORD_RESET_TOKEN_EXPIRED' }) },
      );
    });

    it('updates the password, revokes sessions and sends the notice on success', async () => {
      prisma.authToken.findUnique.mockResolvedValue(resetRecord());
      await service.resetPassword('t', 'password123', 'password123');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({
            passwordHash: expect.any(String),
            tokenVersion: { increment: 1 },
          }),
        }),
      );
      // Plaintext password must never reach the DB layer.
      const written = prisma.user.update.mock.calls[0][0].data.passwordHash as string;
      expect(written).not.toBe('password123');
      expect(mail.sendPasswordChangedNotice).toHaveBeenCalledWith('u@e.com');
    });
  });
});
