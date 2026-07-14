import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthTokenPurpose, UserStatus, type AuthToken, type User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { maskEmail } from '../mail/mail.types';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
/** Rate-limit key — hash of the normalized email, so no PII is persisted. */
const emailKey = (email: string): string => sha256(email.trim().toLowerCase());

type SendCheck = { ok: true } | { ok: false; error: HttpException };

/**
 * Email verification & password reset flows.
 *
 * Security invariants:
 * - Tokens are 32 random bytes (base64url); only their SHA-256 hash is stored.
 * - Tokens are single-use, purpose-bound, TTL-bound; issuing a new token
 *   invalidates all previously active tokens of the same purpose.
 * - Send limits (cooldown + daily cap) are tracked per email hash in the DB
 *   and are checked BEFORE any account lookup, so forgot-password behaves
 *   identically whether or not the email exists.
 * - Raw tokens, links and passwords are never logged.
 */
@Injectable()
export class EmailFlowService {
  private readonly logger = new Logger(EmailFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------

  /**
   * Best-effort verification mail for register flows: rate limits are honored
   * (nothing is sent inside the cooldown window) but never surface as errors.
   */
  async trySendVerification(user: Pick<User, 'id' | 'email'>): Promise<boolean> {
    const check = await this.checkSendAllowed(user.email, AuthTokenPurpose.EMAIL_VERIFICATION);
    if (!check.ok) {
      return false;
    }
    await this.recordSend(user.email, AuthTokenPurpose.EMAIL_VERIFICATION);
    const token = await this.issueToken(
      user.id,
      AuthTokenPurpose.EMAIL_VERIFICATION,
      this.config.authTokens.verifyTtlMinutes,
    );
    await this.mail.sendEmailVerification(user.email, token);
    return true;
  }

  /** Resend endpoint: enforces cooldown/daily limits (429) before any lookup. */
  async resendVerification(email: string): Promise<void> {
    const check = await this.checkSendAllowed(email, AuthTokenPurpose.EMAIL_VERIFICATION);
    if (!check.ok) {
      throw check.error;
    }
    // Recorded before the existence check so unknown emails burn cooldown too.
    await this.recordSend(email, AuthTokenPurpose.EMAIL_VERIFICATION);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Do not reveal whether the address is registered.
      return;
    }
    if (user.emailVerifiedAt) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_VERIFIED',
        message: '此 Email 已完成驗證,請直接登入。',
      });
    }
    const token = await this.issueToken(
      user.id,
      AuthTokenPurpose.EMAIL_VERIFICATION,
      this.config.authTokens.verifyTtlMinutes,
    );
    await this.mail.sendEmailVerification(user.email, token);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.findToken(rawToken, AuthTokenPurpose.EMAIL_VERIFICATION);
    if (!record || record.usedAt || record.invalidatedAt || record.user.emailVerifiedAt) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_TOKEN_INVALID',
        message: '驗證連結無效或已失效,請重新寄送驗證信。',
      });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_TOKEN_EXPIRED',
        message: '驗證連結已過期,請重新寄送驗證信。',
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      }),
    ]);
    this.logger.log(`Email verified for ${maskEmail(record.user.email)}`);
  }

  // ---------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------

  /**
   * Always resolves successfully (anti-enumeration) — rate-limit errors are the
   * only exception, and they trigger before the account lookup, uniformly.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const check = await this.checkSendAllowed(email, AuthTokenPurpose.PASSWORD_RESET);
    if (!check.ok) {
      throw check.error;
    }
    await this.recordSend(email, AuthTokenPurpose.PASSWORD_RESET);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      return;
    }
    const token = await this.issueToken(
      user.id,
      AuthTokenPurpose.PASSWORD_RESET,
      this.config.authTokens.resetTtlMinutes,
    );
    await this.mail.sendPasswordReset(user.email, token);
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<void> {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_MISMATCH',
        message: '兩次輸入的密碼不一致。',
      });
    }
    const record = await this.findToken(rawToken, AuthTokenPurpose.PASSWORD_RESET);
    if (!record || record.invalidatedAt) {
      throw new BadRequestException({
        code: 'PASSWORD_RESET_TOKEN_INVALID',
        message: '重設連結無效或已失效,請重新申請。',
      });
    }
    if (record.usedAt) {
      throw new BadRequestException({
        code: 'PASSWORD_RESET_TOKEN_USED',
        message: '重設連結已被使用,請重新申請。',
      });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'PASSWORD_RESET_TOKEN_EXPIRED',
        message: '重設連結已過期,請重新申請。',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      // Superseded/duplicate reset tokens die with the successful reset.
      this.prisma.authToken.updateMany({
        where: {
          userId: record.userId,
          purpose: AuthTokenPurpose.PASSWORD_RESET,
          usedAt: null,
          invalidatedAt: null,
          id: { not: record.id },
        },
        data: { invalidatedAt: now },
      }),
      // tokenVersion bump revokes every previously-issued JWT session.
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
    ]);
    this.logger.log(`Password reset completed for ${maskEmail(record.user.email)}`);
    await this.mail.sendPasswordChangedNotice(record.user.email);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async findToken(
    rawToken: string,
    purpose: AuthTokenPurpose,
  ): Promise<(AuthToken & { user: User }) | null> {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    return record && record.purpose === purpose ? record : null;
  }

  /** Creates a fresh token and invalidates all still-active ones of the purpose. */
  private async issueToken(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMinutes: number,
  ): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, purpose, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      }),
      this.prisma.authToken.create({
        data: { userId, purpose, tokenHash: sha256(raw), expiresAt },
      }),
    ]);
    return raw;
  }

  /** Cooldown + daily cap per email hash. Runs before any account lookup. */
  private async checkSendAllowed(email: string, purpose: AuthTokenPurpose): Promise<SendCheck> {
    const { resendCooldownSeconds, dailyLimit } = this.config.authTokens;
    const now = Date.now();
    const recent = await this.prisma.emailSendRequest.findMany({
      where: { emailHash: emailKey(email), purpose, createdAt: { gte: new Date(now - DAY_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent.length >= dailyLimit) {
      const oldest = recent[recent.length - 1];
      const resetAt = new Date(oldest.createdAt.getTime() + DAY_MS).toISOString();
      return {
        ok: false,
        error: new HttpException(
          {
            code: 'EMAIL_DAILY_LIMIT_EXCEEDED',
            message: '此 Email 已達 24 小時內寄送次數上限,請稍後再試。',
            details: { resetAt },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      };
    }
    const latest = recent[0];
    if (latest) {
      const elapsedMs = now - latest.createdAt.getTime();
      const cooldownMs = resendCooldownSeconds * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfterSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
        return {
          ok: false,
          error: new HttpException(
            {
              code: 'EMAIL_SEND_COOLDOWN',
              message: `寄送過於頻繁,請於 ${retryAfterSeconds} 秒後再試。`,
              details: {
                retryAfterSeconds,
                resetAt: new Date(latest.createdAt.getTime() + cooldownMs).toISOString(),
              },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
        };
      }
    }
    return { ok: true };
  }

  private async recordSend(email: string, purpose: AuthTokenPurpose): Promise<void> {
    const hash = emailKey(email);
    await this.prisma.emailSendRequest.create({ data: { emailHash: hash, purpose } });
    // Opportunistic cleanup — rows older than the 24h window are dead weight.
    await this.prisma.emailSendRequest.deleteMany({
      where: { emailHash: hash, createdAt: { lt: new Date(Date.now() - DAY_MS) } },
    });
  }
}
