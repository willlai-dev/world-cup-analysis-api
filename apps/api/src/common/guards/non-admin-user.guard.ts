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
 * USER/PREMIUM only — ADMIN is forbidden (403). Applied to all user-domain
 * controllers (matches, teams, players, news, champion, favorites, users, ai).
 * Admin is an account-management role, not a feature superuser.
 */
@Injectable()
export class NonAdminUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin accounts cannot use general features.',
      });
    }
    return true;
  }
}
