import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { UserDto } from '../common/dto/contracts';
import { IpRateLimit, IpRateLimitGuard } from '../common/guards/ip-rate-limit.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ACCESS_TOKEN_COOKIE,
  buildAuthCookieOptions,
  clearAuthCookieOptions,
} from '../common/utils/cookie.util';
import { AppConfigService } from '../config/app-config.service';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailFlowService } from './email-flow.service';

/** Identical anti-enumeration reply for every forgot-password request. */
const FORGOT_PASSWORD_MESSAGE = '如果該 Email 已註冊,我們已寄出密碼重設信,請查收。';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailFlows: EmailFlowService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ user: UserDto; requiresEmailVerification: boolean }> {
    return this.auth.register(dto);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ limit: 20, windowSeconds: 60 })
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ success: boolean; message: string }> {
    await this.emailFlows.verifyEmail(dto.token);
    return { success: true, message: 'Email 驗證成功,請重新登入。' };
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ limit: 20, windowSeconds: 60 })
  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.emailFlows.resendVerification(dto.email);
    return { success: true, message: '驗證信已重新寄出,請查收。' };
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ limit: 20, windowSeconds: 60 })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.emailFlows.requestPasswordReset(dto.email);
    return { success: true, message: FORGOT_PASSWORD_MESSAGE };
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ limit: 20, windowSeconds: 60 })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.emailFlows.resetPassword(dto.token, dto.newPassword, dto.confirmPassword);
    return { success: true, message: '密碼已重設成功,請使用新密碼重新登入。' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: UserDto; redirectPath: string }> {
    const { user, token, maxAge, redirectPath } = await this.auth.validateAndLogin(dto);
    reply.setCookie(
      ACCESS_TOKEN_COOKIE,
      token,
      buildAuthCookieOptions(this.config.isProduction, maxAge),
    );
    return { user, redirectPath };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) reply: FastifyReply): { success: boolean } {
    reply.clearCookie(ACCESS_TOKEN_COOKIE, clearAuthCookieOptions());
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    return this.auth.getMe(user.id);
  }
}
