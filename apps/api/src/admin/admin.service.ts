import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Prisma, UserRole, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type { UserDto } from "../common/dto/contracts";
import { toUserDto } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
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
        code: "EMAIL_TAKEN",
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
