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
 * PREMIUM-tier gate — used on translate / recalculate / deep-chat. Stacks on top
 * of the class-level NonAdminUserGuard. PREMIUM passes; ADMIN also passes (admin
 * is a feature superuser and inherits all premium capabilities); USER is
 * forbidden (403).
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
    if (user.role !== UserRole.PREMIUM && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '此功能僅限高級會員使用。',
      });
    }
    return true;
  }
}
