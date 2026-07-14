import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { UserDto } from '../common/dto/contracts';
import { toUserDto } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { EmailFlowService } from './email-flow.service';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

export function redirectPathForRole(role: UserRole): string {
  return role === UserRole.ADMIN ? '/admin/accounts' : '/matches';
}

export interface RegisterResult {
  user: UserDto;
  /** Always true for self-registration — the account starts unverified. */
  requiresEmailVerification: boolean;
}

export interface LoginResult {
  user: UserDto;
  token: string;
  maxAge: number;
  redirectPath: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly emailFlows: EmailFlowService,
  ) {}

  /**
   * Registers a normal USER (role input is never accepted). The account starts
   * unverified and a verification mail is sent. Re-registering an email that
   * is pending verification never creates a duplicate — it re-enters the
   * verification flow instead (resend honors the cooldown silently).
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      if (existing.emailVerifiedAt) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: '此 Email 已註冊,請直接登入。',
        });
      }
      // Credentials of the pending account are intentionally left untouched.
      await this.emailFlows.trySendVerification(existing);
      return { user: toUserDto(existing), requiresEmailVerification: true };
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        profile: { create: {} },
      },
    });
    await this.emailFlows.trySendVerification(user);
    return { user: toUserDto(user), requiresEmailVerification: true };
  }

  async validateAndLogin(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const invalid = (): never => {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    };
    if (!user) {
      return invalid();
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: '你的帳號目前無法使用此功能。',
      });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      return invalid();
    }
    // Correct credentials but unverified email → no token of any kind is issued.
    // Checked after the password so unauthenticated probing can't detect it.
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email 尚未完成驗證,請先完成信箱驗證後再登入。',
      });
    }
    const { token, maxAge } = this.tokens.sign(user);
    return { user: toUserDto(user), token, maxAge, redirectPath: redirectPathForRole(user.role) };
  }

  async getMe(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
    }
    return toUserDto(user);
  }
}
