import {
  type AiChatRequest,
  type AiChatResponse,
  AiProviderError,
  type ProviderName,
} from '../ai-task.types';

// Large models (e.g. NVIDIA Ultra 550B) producing structured JSON can take well
// over a minute; keep this generous so heavy analysis tasks don't time out.
const DEFAULT_TIMEOUT_MS = 120_000;

/** Rough token estimate when the provider omits a `usage` block (~4 chars/token). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

type OpenAiCompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Shared POST `{baseUrl}/chat/completions` for any OpenAI-compatible provider
 * (NVIDIA Build + Qwen/DashScope). Handles Bearer auth, an AbortController
 * timeout, and normalizes the response to {@link AiChatResponse}. All failure
 * paths throw {@link AiProviderError} so the router can log + fall back.
 */
export async function openAiCompatibleChat(
  provider: ProviderName,
  baseUrl: string,
  apiKey: string,
  request: AiChatRequest,
): Promise<AiChatResponse> {
  const startedAt = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.3,
  };
  if (request.maxTokens != null) {
    body.max_tokens = request.maxTokens;
  }
  if (request.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    if (controller.signal.aborted) {
      throw new AiProviderError(
        provider,
        request.model,
        'TIMEOUT',
        `${provider} request timed out after ${timeoutMs}ms`,
        latencyMs,
      );
    }
    throw new AiProviderError(
      provider,
      request.model,
      'NETWORK',
      `${provider} network error: ${(err as Error).message}`,
      latencyMs,
    );
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiProviderError(
      provider,
      request.model,
      'HTTP',
      `${provider} HTTP ${response.status}: ${detail.slice(0, 500)}`,
      latencyMs,
      response.status,
    );
  }

  const json = (await response.json().catch(() => ({}))) as OpenAiCompletion;
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new AiProviderError(
      provider,
      request.model,
      'HTTP',
      `${provider} returned an empty completion`,
      latencyMs,
      response.status,
    );
  }

  const promptText = request.messages.map((m) => m.content).join('\n');
  return {
    provider,
    model: request.model,
    content,
    raw: json,
    inputTokenEstimate: json.usage?.prompt_tokens ?? estimateTokens(promptText),
    outputTokenEstimate: json.usage?.completion_tokens ?? estimateTokens(content),
    latencyMs,
  };
}
