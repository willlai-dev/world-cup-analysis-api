import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
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
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let tokens: TokenService;
  let service: AuthService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    tokens = { sign: jest.fn().mockReturnValue({ token: 't', maxAge: 100 }) } as unknown as TokenService;
    service = new AuthService(prisma as unknown as PrismaService, tokens);
  });

  describe('register', () => {
    it('creates a USER', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(buildUser());
      const result = await service.register({
        email: 'u@e.com',
        password: PASSWORD,
        displayName: 'U',
      });
      expect(result.role).toBe(UserRole.USER);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: UserRole.USER }) }),
      );
    });

    it('throws on duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      await expect(
        service.register({ email: 'u@e.com', password: PASSWORD, displayName: 'U' }),
      ).rejects.toBeInstanceOf(ConflictException);
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
  });
});
