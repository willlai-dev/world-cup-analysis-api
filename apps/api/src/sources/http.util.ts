const DEFAULT_TIMEOUT_MS = 20_000;

/** Thrown by source clients on any non-2xx / network / timeout failure. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/**
 * GET a JSON document from an external data source with an AbortController
 * timeout and Bearer/header auth. Normalizes every failure to {@link SourceError}
 * (carrying `statusCode` + `retryAfterMs` for 429 backoff) so callers can decide
 * whether to skip, retry, or fail the job.
 */
export async function fetchJson<T>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new SourceError(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new SourceError(`Network error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    throw new SourceError(
      `HTTP ${response.status}: ${detail.slice(0, 300)}`,
      response.status,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    );
  }

  return (await response.json()) as T;
}

/** Promise-based delay used to throttle rate-limited sources. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
