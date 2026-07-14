import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AiReportStatus, Prisma, UserRole, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type { AiUsageStatsDto, UserDto } from "../common/dto/contracts";
import { toUserDto } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { AiUsageQueryDto } from "./dto/ai-usage-query.dto";
import type { CreateUserDto } from "./dto/create-user.dto";
import type { ListUsersQueryDto } from "./dto/list-users-query.dto";
import type { RegisterAdminDto } from "./dto/register-admin.dto";

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ items: UserDto[]; total: number }> {
    const where: Prisma.UserWhereInput = {};
    if (query.role) {
      where.role = query.role;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { displayName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(toUserDto), total };
  }

  createUser(dto: CreateUserDto): Promise<UserDto> {
    return this.createWithRole(
      dto.email,
      dto.password,
      dto.displayName,
      dto.role,
    );
  }

  registerAdmin(dto: RegisterAdminDto): Promise<UserDto> {
    return this.createWithRole(
      dto.email,
      dto.password,
      dto.displayName,
      UserRole.ADMIN,
    );
  }

  async updateRole(userId: string, role: UserRole): Promise<UserDto> {
    const user = await this.getUserOr404(userId);
    // Demoting the last active admin would lock everyone out of account management.
    if (
      user.role === UserRole.ADMIN &&
      user.status === UserStatus.ACTIVE &&
      role !== UserRole.ADMIN
    ) {
      await this.ensureNotLastActiveAdmin(userId);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });
    return toUserDto(updated);
  }

  /**
   * Aggregated AI usage statistics over AiUsageLog (Phase 3). Window defaults
   * to the last 7 days; every row is one provider attempt (mock rows are
   * provider=PROGRAM_RULE / model="mock").
   */
  async getAiUsageStats(query: AiUsageQueryDto): Promise<AiUsageStatsDto> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const where: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(query.taskType ? { taskType: query.taskType } : {}),
    };

    const [calls, done, failed, tokens, byTaskType, byProvider, byStatus, byUser] =
      await Promise.all([
        this.prisma.aiUsageLog.count({ where }),
        this.prisma.aiUsageLog.count({
          where: { ...where, requestStatus: AiReportStatus.DONE },
        }),
        this.prisma.aiUsageLog.count({
          where: { ...where, requestStatus: AiReportStatus.FAILED },
        }),
        this.prisma.aiUsageLog.aggregate({
          where,
          _sum: { inputTokenEstimate: true, outputTokenEstimate: true },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ["taskType"],
          where,
          _count: { _all: true },
          orderBy: { _count: { taskType: "desc" } },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ["provider"],
          where,
          _count: { _all: true },
          orderBy: { _count: { provider: "desc" } },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ["requestStatus"],
          where,
          _count: { _all: true },
          orderBy: { _count: { requestStatus: "desc" } },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ["userId"],
          where: { ...where, userId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { userId: "desc" } },
          take: 10,
        }),
      ]);

    const byDayRows = await this.prisma.$queryRaw<
      { day: Date; calls: bigint }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      ${query.taskType ? Prisma.sql`AND "taskType" = ${query.taskType}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `;

    const userIds = byUser
      .map((u) => u.userId)
      .filter((id): id is string => id !== null);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        calls,
        done,
        failed,
        inputTokens: tokens._sum.inputTokenEstimate ?? 0,
        outputTokens: tokens._sum.outputTokenEstimate ?? 0,
      },
      byTaskType: byTaskType.map((r) => ({
        taskType: r.taskType,
        calls: r._count._all,
      })),
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        calls: r._count._all,
      })),
      byStatus: byStatus.map((r) => ({
        status: r.requestStatus,
        calls: r._count._all,
      })),
      byDay: byDayRows.map((r) => ({
        day: r.day.toISOString(),
        calls: Number(r.calls),
      })),
      topUsers: byUser
        .filter((r): r is typeof r & { userId: string } => r.userId !== null)
        .map((r) => ({
          userId: r.userId,
          email: userById.get(r.userId)?.email ?? null,
          displayName: userById.get(r.userId)?.displayName ?? null,
          calls: r._count._all,
        })),
    };
  }

  /**
   * Soft delete: sets status=DISABLED, never removes the row or related records.
   * Disabled users cannot log in (AuthService) or access protected APIs (JwtAuthGuard).
   */
  async softDeleteUser(
    actingUserId: string,
    targetUserId: string,
  ): Promise<{ success: true; user: UserDto }> {
    if (actingUserId === targetUserId) {
      throw new ConflictException({
        code: "CANNOT_DISABLE_SELF",
        message: "You cannot disable your own account.",
      });
    }
    const user = await this.getUserOr404(targetUserId);
    if (user.status === UserStatus.DISABLED) {
      return { success: true, user: toUserDto(user) }; // idempotent
    }
    if (user.role === UserRole.ADMIN) {
      await this.ensureNotLastActiveAdmin(targetUserId);
    }
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: UserStatus.DISABLED },
    });
    return { success: true, user: toUserDto(updated) };
  }

  private async createWithRole(
    email: string,
    password: string,
    displayName: string,
    role: UserRole,
  ): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "Email already registered",
      });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        role,
        status: UserStatus.ACTIVE,
        // Admin-created accounts are trusted — no verification round-trip.
        emailVerifiedAt: new Date(),
        profile: { create: {} },
      },
    });
    return toUserDto(user);
  }

  private async getUserOr404(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    return user;
  }

  private async ensureNotLastActiveAdmin(userId: string): Promise<void> {
    const otherActiveAdmins = await this.prisma.user.count({
      where: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        id: { not: userId },
      },
    });
    if (otherActiveAdmins === 0) {
      throw new ConflictException({
        code: "LAST_ADMIN_PROTECTED",
        message: "Cannot disable or demote the last active admin.",
      });
    }
  }
}
