import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError } from '../dto/api-response.types';

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpCtx = host.switchToHttp();
    const reply = httpCtx.getResponse<FastifyReply>();
    const req = httpCtx.getRequest<FastifyRequest>();
    // Prefix that identifies which request blew up, so the stack trace below is
    // actionable instead of floating context-free in the log.
    const where = `${req?.method ?? '?'} ${req?.url ?? '?'}`;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODE_MAP[status] ?? 'ERROR';
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        if (typeof r.code === 'string') {
          code = r.code;
        }
        if (typeof r.message === 'string') {
          message = r.message;
        } else if (Array.isArray(r.message)) {
          message = r.message.join('; ');
          details = r.message;
        } else if (typeof r.error === 'string') {
          message = r.error;
        }
        if (r.details !== undefined) {
          details = r.details;
        }
      }
    } else if (exception instanceof Error) {
      message = 'Internal server error';
      this.logger.error(`${where} :: ${exception.message}`, exception.stack);
    } else {
      this.logger.error(`${where} :: unknown exception`, String(exception));
    }

    const body: ApiError = { data: null, meta: {}, error: { code, message } };
    if (details !== undefined) {
      body.error.details = details;
    }

    void reply.status(status).send(body);
  }
}
