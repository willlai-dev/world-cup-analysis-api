import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Protects all /jobs/* endpoints. Requires header `x-cron-secret` matching
 * CRON_SECRET. Wrong/missing -> 401. (Routes are @Public() so the global
 * JwtAuthGuard is skipped and this is the only gate.)
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const headerValue = req.headers['x-cron-secret'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!provided || provided !== this.config.cronSecret) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing cron secret',
      });
    }
    return true;
  }
}
