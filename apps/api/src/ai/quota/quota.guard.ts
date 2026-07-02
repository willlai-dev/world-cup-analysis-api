import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AI_QUOTA_KEY, type QuotaKey } from './ai-quota.decorator';
import { QuotaService } from './quota.service';

/**
 * Enforces the @AiQuota() bucket on AI endpoints. Stacks after the role
 * guards (NonAdminUserGuard / PremiumOnlyGuard), so by the time it runs the
 * user is a USER or PREMIUM allowed to hit the route — it only answers
 * "have they any quota left", throwing 429 AI_QUOTA_EXCEEDED when not.
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly quota: QuotaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.get<QuotaKey | undefined>(
      AI_QUOTA_KEY,
      context.getHandler(),
    );
    if (!key) {
      return true;
    }
    const user = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
    await this.quota.assertWithinQuota(user, key);
    return true;
  }
}
