import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser, JwtPayload } from '../types/authenticated-user';
import { ACCESS_TOKEN_COOKIE } from '../utils/cookie.util';

type RequestWithUser = FastifyRequest & {
  user?: AuthenticatedUser;
  cookies: Record<string, string | undefined>;
};

/**
 * Global authentication guard. Reads the HttpOnly JWT cookie, verifies it,
 * loads the user, and attaches it to the request. Routes marked @Public() skip.
 * - missing/invalid token -> 401
 * - account DISABLED       -> 403 (rejected even if the token is still valid)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired session',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
    }
    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: '你的帳號目前無法使用此功能。',
      });
    }
    // Tokens minted before the last password reset carry a stale tokenVersion
    // (missing tv = version 0) and are rejected — this is the session revoke.
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session has been revoked, please log in again',
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };
    return true;
  }
}
