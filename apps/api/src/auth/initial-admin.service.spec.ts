import { UserRole, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type { AppConfigService } from "../config/app-config.service";
import type { PrismaService } from "../prisma/prisma.service";
import { InitialAdminService } from "./initial-admin.service";

describe("InitialAdminService", () => {
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let config: AppConfigService;
  let service: InitialAdminService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    config = {
      seedAdmin: {
        email: "admin@example.com",
        password: "admin123456",
        displayName: "Initial Admin",
      },
    } as AppConfigService;
    service = new InitialAdminService(
      prisma as unknown as PrismaService,
      config,
    );
  });

  it("creates the configured admin when missing", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.onApplicationBootstrap();

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "seed-user-admin",
          email: "admin@example.com",
          displayName: "Initial Admin",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          profile: { create: { nickname: "Initial Admin" } },
        }),
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refreshes an existing account back to the configured admin credentials", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: "seed-user-admin",
        email: "abc123",
        passwordHash: bcrypt.hashSync("other-password", 10),
        displayName: "Someone Else",
        role: UserRole.USER,
        status: UserStatus.DISABLED,
      })
      .mockResolvedValueOnce(null);

    await service.onApplicationBootstrap();

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "seed-user-admin" },
        data: expect.objectContaining({
          email: "admin@example.com",
          displayName: "Initial Admin",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash: expect.any(String),
        }),
      }),
    );
  });

  it("falls back to the configured login id when the seeded id is not present", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "legacy-admin-id",
      email: "admin@example.com",
      passwordHash: bcrypt.hashSync("other-password", 10),
      displayName: "Legacy Admin",
      role: UserRole.USER,
      status: UserStatus.DISABLED,
    });

    await service.onApplicationBootstrap();

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-admin-id" },
        data: expect.objectContaining({
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash: expect.any(String),
        }),
      }),
    );
  });

  it("skips updates when the configured admin already matches", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "seed-user-admin",
      email: "admin@example.com",
      passwordHash: bcrypt.hashSync("admin123456", 10),
      displayName: "Initial Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });

    await service.onApplicationBootstrap();

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("backfills emailVerifiedAt on a matching but unverified admin", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "seed-user-admin",
      email: "admin@example.com",
      passwordHash: bcrypt.hashSync("admin123456", 10),
      displayName: "Initial Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
    });

    await service.onApplicationBootstrap();

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { emailVerifiedAt: expect.any(Date) },
      }),
    );
  });
});
