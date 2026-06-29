import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { type ApiSuccess, Paginated } from '../dto/api-response.types';

/**
 * Wraps every successful controller result in the mandatory envelope:
 *   { data, meta?, error: null }
 * Controllers may return a `Paginated` instance to attach `meta.pagination`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<unknown>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<unknown>> {
    return next.handle().pipe(
      map((result): ApiSuccess<unknown> => {
        if (result instanceof Paginated) {
          return { data: result.data, meta: result.meta, error: null };
        }
        return { data: result ?? null, error: null };
      }),
    );
  }
}
