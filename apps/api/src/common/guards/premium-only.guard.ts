import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * PREMIUM only — used on translate / recalculate / deep-chat. Stacks on top of
 * a class-level NonAdminUserGuard: ADMIN fails the class guard, USER fails here,
 * PREMIUM passes both.
 */
@Injectable()
export class PremiumOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (user.role !== UserRole.PREMIUM) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '此功能僅限高級會員使用。',
      });
    }
    return true;
  }
}
