import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Gate for user-domain feature controllers (matches, teams, players, news,
 * champion, favorites, users, ai). Any authenticated app account may pass —
 * USER, PREMIUM and (as of the admin-superuser policy) ADMIN. Admin is now a
 * feature superuser and inherits every general capability, because there are
 * operational scenarios where an admin needs to call these APIs. USER-vs-PREMIUM
 * gating for premium-only actions is still enforced separately by
 * `PremiumOnlyGuard`.
 *
 * (The name is kept for continuity; it no longer excludes admins.)
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
    return true;
  }
}
