import type { UserRole, UserStatus } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** tokenVersion at issue time; mismatch with the DB revokes the session. */
  tv?: number;
}
