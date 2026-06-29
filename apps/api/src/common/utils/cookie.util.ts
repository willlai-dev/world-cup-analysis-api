import type { CookieSerializeOptions } from '@fastify/cookie';

export const ACCESS_TOKEN_COOKIE = 'access_token';

/**
 * Cookie options for the HttpOnly JWT auth cookie.
 * Dev (localhost): sameSite 'lax' + secure false works across :3000/:3001.
 * Prod cross-domain would require sameSite 'none' + secure true (future).
 */
export function buildAuthCookieOptions(
  isProduction: boolean,
  maxAgeSeconds: number,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function clearAuthCookieOptions(): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/' };
}
