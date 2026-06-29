import type { ChatAnswerDto } from '../dto/contracts';

/**
 * Phase 1 placeholder for AI chat responses. Real provider calls (NVIDIA/Qwen)
 * arrive in Phase 2; under AI_MOCK_MODE this returns a deterministic, grounded
 * answer so the API contract and RBAC are testable without external keys.
 */
export function buildMockChatAnswer(
  question: string,
  context?: { scope?: string; sourceUpdatedAt?: string | null },
): ChatAnswerDto {
  const scope = context?.scope ? `（${context.scope}）` : '';
  return {
    answer:
      `【AI_MOCK_MODE】${scope}已收到你的問題：「${question}」。` +
      `目前為示範模式，尚未串接真實 AI 模型；正式分析將以資料庫快照為準，不會捏造比分、傷病、陣容或新聞。`,
    provider: 'PROGRAM_RULE',
    model: 'mock',
    sourceUpdatedAt: context?.sourceUpdatedAt ?? null,
  };
}
