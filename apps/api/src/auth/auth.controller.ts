import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { UserDto } from '../common/dto/contracts';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ACCESS_TOKEN_COOKIE,
  buildAuthCookieOptions,
  clearAuthCookieOptions,
} from '../common/utils/cookie.util';
import { AppConfigService } from '../config/app-config.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto): Promise<{ user: UserDto }> {
    const user = await this.auth.register(dto);
    return { user };
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
