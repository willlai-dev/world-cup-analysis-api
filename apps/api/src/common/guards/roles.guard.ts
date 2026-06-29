import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

const FORBIDDEN = { code: 'FORBIDDEN', message: '你的帳號目前無法使用此功能。' };

/** Generic role gate driven by @Roles(). Assumes JwtAuthGuard already ran. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const user = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException(FORBIDDEN);
    }
    return true;
  }
}
