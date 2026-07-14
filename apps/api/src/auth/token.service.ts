import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import type { JwtPayload } from '../common/types/authenticated-user';

/** Parses durations like "7d", "12h", "30m", "45s", or a plain number (seconds). */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    return 7 * 24 * 60 * 60;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[unit] ?? 1);
}

@Injectable()
export class TokenService {
  readonly maxAgeSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: AppConfigService,
  ) {
    this.maxAgeSeconds = parseDurationToSeconds(config.jwtExpiresIn);
  }

  sign(
    user: Pick<User, 'id' | 'email' | 'role' | 'tokenVersion'>,
  ): { token: string; maxAge: number } {
    // tv (tokenVersion) lets a password reset revoke every earlier session.
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion,
    };
    return { token: this.jwt.sign(payload), maxAge: this.maxAgeSeconds };
  }
}
