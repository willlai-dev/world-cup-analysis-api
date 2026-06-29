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
