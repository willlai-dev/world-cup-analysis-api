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
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

export function redirectPathForRole(role: UserRole): string {
  return role === UserRole.ADMIN ? '/admin/accounts' : '/matches';
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
  ) {}

  /** Registers a normal USER. Role input is never accepted. */
  async register(dto: RegisterDto): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
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
    return toUserDto(user);
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
