import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AiPromptService } from './ai-prompt.service';
import { AiRouterService } from './ai-router.service';
import { AiSchemaValidator } from './ai-schema-validator.service';
import {
  type AiChatRequest,
  type AiChatResponse,
  AiProviderError,
  type ProviderName,
} from './ai-task.types';
import { AiUsageService } from './ai-usage.service';
import type { NvidiaAdapter } from './providers/nvidia.adapter';
import type { QwenAdapter } from './providers/qwen.adapter';
import { ChampionAnalysisOutputSchema } from './schemas/champion-analysis.schema';

type ChatFn = jest.Mock<Promise<AiChatResponse>, [AiChatRequest]>;

const okResponse = (provider: ProviderName, model: string, content: string): AiChatResponse => ({
  provider,
  model,
  content,
  latencyMs: 5,
  inputTokenEstimate: 10,
  outputTokenEstimate: 20,
});

const VALID_FINAL = {
  summary: 's',
  entries: [
    { teamName: 'Brazil', rank: 1, probabilityText: '30%', strengths: ['a'], risks: ['b'], aiComment: 'c' },
  ],
  dataLimitations: [],
};

function makeConfig(aiMockMode: boolean): AppConfigService {
  return {
    aiMockMode,
    nvidia: { apiKey: 'k', baseUrl: 'b', modelSuper: 'nv-super', modelUltra: 'nv-ultra' },
    qwen: {
      apiKey: 'k',
      openaiBaseUrl: 'b',
      dashscopeBaseUrl: 'b',
      modelPlus: 'qw-plus',
      modelFlash: 'qw-flash',
      modelFlashFallback: 'qw-flash-fb',
    },
  } as unknown as AppConfigService;
}

function build(aiMockMode: boolean, nvidiaChat: ChatFn, qwenChat: ChatFn) {
  const prisma = {
    aiReport: { create: jest.fn(async ({ data }) => ({ id: 'report-1', ...data })) },
    aiUsageLog: { create: jest.fn().mockResolvedValue(undefined) },
  };
  const nvidia = { providerName: 'NVIDIA', chat: nvidiaChat, supportsModel: () => true };
  const qwen = { providerName: 'QWEN', chat: qwenChat, supportsModel: () => true };
  const router = new AiRouterService(
    makeConfig(aiMockMode),
    prisma as unknown as PrismaService,
    new AiPromptService(),
    new AiSchemaValidator(),
    new AiUsageService(prisma as unknown as PrismaService),
    nvidia as unknown as NvidiaAdapter,
    qwen as unknown as QwenAdapter,
  );
  return { router, prisma, nvidiaChat, qwenChat };
}

describe('AiRouterService', () => {
  describe('runChat', () => {
    it('routes GENERAL_CHAT to the NVIDIA Super primary', async () => {
      const nvidiaChat: ChatFn = jest.fn().mockResolvedValue(okResponse('NVIDIA', 'nv-super', '嗨'));
      const qwenChat: ChatFn = jest.fn();
      const { router } = build(false, nvidiaChat, qwenChat);

      const res = await router.runChat({ taskType: 'GENERAL_CHAT', userId: 'u1', question: 'hi' });

      expect(nvidiaChat).toHaveBeenCalledTimes(1);
      expect(nvidiaChat.mock.calls[0][0].model).toBe('nv-super');
      expect(qwenChat).not.toHaveBeenCalled();
      expect(res.provider).toBe('NVIDIA');
      expect(res.answer).toBe('嗨');
    });

    it('falls back to Qwen Plus when the NVIDIA primary fails', async () => {
      const nvidiaChat: ChatFn = jest
        .fn()
        .mockRejectedValue(new AiProviderError('NVIDIA', 'nv-super', 'HTTP', 'boom'));
      const qwenChat: ChatFn = jest.fn().mockResolvedValue(okResponse('QWEN', 'qw-plus', '備援'));
      const { router } = build(false, nvidiaChat, qwenChat);

      const res = await router.runChat({ taskType: 'GENERAL_CHAT', userId: 'u1', question: 'hi' });

      expect(qwenChat).toHaveBeenCalledTimes(1);
      expect(qwenChat.mock.calls[0][0].model).toBe('qw-plus');
      expect(res.provider).toBe('QWEN');
      expect(res.answer).toBe('備援');
    });

    it('short-circuits in mock mode with zero external calls', async () => {
      const nvidiaChat: ChatFn = jest.fn();
      const qwenChat: ChatFn = jest.fn();
      const { router } = build(true, nvidiaChat, qwenChat);

      const res = await router.runChat({ taskType: 'GENERAL_CHAT', userId: 'u1', question: 'hi' });

      expect(nvidiaChat).not.toHaveBeenCalled();
      expect(qwenChat).not.toHaveBeenCalled();
      expect(res.provider).toBe('PROGRAM_RULE');
      expect(res.answer).toContain('AI_MOCK_MODE');
    });

    it('degrades to a PROGRAM_RULE answer when every provider fails', async () => {
      const nvidiaChat: ChatFn = jest
        .fn()
        .mockRejectedValue(new AiProviderError('NVIDIA', 'nv-super', 'TIMEOUT', 't'));
      const qwenChat: ChatFn = jest
        .fn()
        .mockRejectedValue(new AiProviderError('QWEN', 'qw-plus', 'HTTP', 'h'));
      const { router, prisma } = build(false, nvidiaChat, qwenChat);

      const res = await router.runChat({ taskType: 'GENERAL_CHAT', userId: 'u1', question: 'hi' });

      expect(res.provider).toBe('PROGRAM_RULE');
      expect(res.model).toBeNull();
      // one usage log per failed attempt (primary + fallback)
      expect(prisma.aiUsageLog.create).toHaveBeenCalledTimes(2);
    });

    it('writes a DONE usage log on success', async () => {
      const nvidiaChat: ChatFn = jest.fn().mockResolvedValue(okResponse('NVIDIA', 'nv-super', 'ok'));
      const { router, prisma } = build(false, nvidiaChat, jest.fn());

      await router.runChat({ taskType: 'GENERAL_CHAT', userId: 'u1', question: 'hi' });

      expect(prisma.aiUsageLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.aiUsageLog.create.mock.calls[0][0].data).toMatchObject({
        provider: 'NVIDIA',
        requestStatus: 'DONE',
        taskType: 'GENERAL_CHAT',
      });
    });
  });

  describe('runReport', () => {
    it('persists a DONE report with validated structured output', async () => {
      const qwenChat: ChatFn = jest
        .fn()
        .mockResolvedValue(okResponse('QWEN', 'qw-plus', JSON.stringify(VALID_FINAL)));
      const { router, prisma } = build(false, jest.fn(), qwenChat);

      const res = await router.runReport({
        taskType: 'CHAMPION_PREDICTION_FINAL',
        userId: 'u1',
        reportType: 'CHAMPION_FINAL',
        instruction: 'go',
        schema: ChampionAnalysisOutputSchema,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe('DONE');
      expect(res.data?.entries).toHaveLength(1);
      expect(prisma.aiReport.create.mock.calls[0][0].data).toMatchObject({ status: 'DONE' });
    });

    it('treats invalid output as a failed attempt and falls back', async () => {
      const nvidiaChat: ChatFn = jest
        .fn()
        .mockResolvedValue(okResponse('NVIDIA', 'nv-ultra', 'not json'));
      const qwenChat: ChatFn = jest
        .fn()
        .mockResolvedValue(okResponse('QWEN', 'qw-plus', JSON.stringify(VALID_FINAL)));
      const { router } = build(false, nvidiaChat, qwenChat);

      // MATCH_ANALYSIS: primary NVIDIA Ultra → fallback Qwen Plus
      const res = await router.runReport({
        taskType: 'MATCH_ANALYSIS',
        reportType: 'MATCH_ANALYSIS',
        instruction: 'go',
        schema: ChampionAnalysisOutputSchema,
      });

      expect(nvidiaChat).toHaveBeenCalledTimes(1);
      expect(qwenChat).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
      expect(res.provider).toBe('QWEN');
    });

    it('persists a FAILED report when all attempts produce invalid output', async () => {
      const nvidiaChat: ChatFn = jest.fn().mockResolvedValue(okResponse('NVIDIA', 'nv-ultra', 'no'));
      const qwenChat: ChatFn = jest.fn().mockResolvedValue(okResponse('QWEN', 'qw-plus', 'nope'));
      const { router, prisma } = build(false, nvidiaChat, qwenChat);

      const res = await router.runReport({
        taskType: 'MATCH_ANALYSIS',
        reportType: 'MATCH_ANALYSIS',
        instruction: 'go',
        schema: ChampionAnalysisOutputSchema,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe('FAILED');
      expect(prisma.aiReport.create.mock.calls[0][0].data).toMatchObject({
        status: 'FAILED',
        provider: 'NVIDIA',
      });
    });
  });

  describe('runTranslation', () => {
    it('returns the deterministic mock translation in mock mode', async () => {
      const nvidiaChat: ChatFn = jest.fn();
      const qwenChat: ChatFn = jest.fn();
      const { router } = build(true, nvidiaChat, qwenChat);

      const res = await router.runTranslation({ userId: 'u1', source: 'Hello' });

      expect(qwenChat).not.toHaveBeenCalled();
      expect(res.ok).toBe(true);
      expect(res.content).toBe('【AI_MOCK_MODE 翻譯】Hello');
      expect(res.provider).toBe('PROGRAM_RULE');
    });

    it('uses Qwen Flash for real translation', async () => {
      const qwenChat: ChatFn = jest.fn().mockResolvedValue(okResponse('QWEN', 'qw-flash', '哈囉'));
      const { router } = build(false, jest.fn(), qwenChat);

      const res = await router.runTranslation({ userId: 'u1', source: 'Hello' });

      expect(qwenChat).toHaveBeenCalledTimes(1);
      expect(qwenChat.mock.calls[0][0].model).toBe('qw-flash');
      expect(res.ok).toBe(true);
      expect(res.content).toBe('哈囉');
    });
  });
});
