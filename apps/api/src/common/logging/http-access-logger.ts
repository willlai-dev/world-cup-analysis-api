import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../types/authenticated-user';

const logger = new Logger('HTTP');

type RequestWithUser = FastifyRequest & { user?: AuthenticatedUser };

/**
 * Registers a Fastify `onResponse` hook that logs one line per HTTP request —
 * the missing "the frontend hit an endpoint but the backend shows nothing"
 * piece. Each line carries method, path (with query), the final status, the
 * response time, and the caller (role + email when the JWT guard attached a
 * user, else "anon"). 2xx/3xx -> log, 4xx -> warn, 5xx -> error.
 *
 * `onResponse` fires after the reply is fully sent, so `reply.statusCode` and
 * `reply.elapsedTime` are the real values (a Nest interceptor would see the
 * pre-`@HttpCode` default, mislogging e.g. a 202 as 200).
 */
export function registerHttpAccessLogger(instance: FastifyInstance): void {
  instance.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    const user = (request as RequestWithUser).user;
    const who = user ? `${user.role} ${user.email}` : 'anon';
    const line = `${request.method} ${request.url} -> ${reply.statusCode} ${Math.round(
      reply.elapsedTime,
    )}ms (${who})`;

    if (reply.statusCode >= 500) {
      logger.error(line);
    } else if (reply.statusCode >= 400) {
      logger.warn(line);
    } else {
      logger.log(line);
    }
    done();
  });
}
