import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

export const IP_RATE_LIMIT_KEY = 'ip_rate_limit';

export interface IpRateLimitOptions {
  /** Max requests per window per client IP. */
  limit: number;
  windowSeconds: number;
}

/** Method decorator: pair with `@UseGuards(IpRateLimitGuard)`. */
export const IpRateLimit = (options: IpRateLimitOptions): MethodDecorator =>
  SetMetadata(IP_RATE_LIMIT_KEY, options);

const MAX_TRACKED_KEYS = 10_000;

/**
 * Basic in-memory fixed-window limiter keyed by client IP + route. Applied to
 * the mail-sending / token-verification auth endpoints (spec: 基本 IP 限流).
 * State is per-process and resets on restart — good enough as a brute-force
 * speed bump; swap for a shared store if the API is ever scaled out.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<IpRateLimitOptions | undefined>(
      IP_RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const key = `${req.ip}:${context.getClass().name}.${context.getHandler().name}`;
    const now = Date.now();
    const windowMs = options.windowSeconds * 1000;

    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.prune(now);
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    if (entry.count > options.limit) {
      const retryAfterSeconds = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: '請求過於頻繁,請稍後再試。',
          details: { retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Drops stale windows so the map cannot grow without bound. */
  private prune(now: number): void {
    if (this.hits.size < MAX_TRACKED_KEYS) {
      return;
    }
    for (const [key, entry] of this.hits) {
      // Windows are ≤ a few minutes; anything older than an hour is stale.
      if (now - entry.windowStart > 60 * 60 * 1000) {
        this.hits.delete(key);
      }
    }
  }

  /** Test hook — e2e suites clear counters between scenarios. */
  reset(): void {
    this.hits.clear();
  }
}
