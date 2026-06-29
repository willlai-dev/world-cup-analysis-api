export type ApiSuccess<T> = {
  data: T;
  meta?: Record<string, unknown>;
  error: null;
};

export type ApiError = {
  data: null;
  meta?: Record<string, unknown>;
  error: { code: string; message: string; details?: unknown };
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): { pagination: PaginationMeta } {
  return {
    pagination: {
      page,
      pageSize,
      total,
      totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
    },
  };
}

/**
 * Marker the controller can return so the envelope interceptor splits out
 * `meta` (e.g. pagination) from the `data` payload.
 */
export class Paginated<T> {
  constructor(
    public readonly data: T,
    public readonly meta: Record<string, unknown>,
  ) {}
}
