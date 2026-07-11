import { Injectable, Logger } from '@nestjs/common';
import { type AiEntityType, AiProvider, type AiReportStatus, Prisma } from '@prisma/client';
import type { ZodType, ZodTypeDef } from 'zod';
import type { ChatAnswerDto, ChatTurn } from '../common/dto/contracts';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiPromptService } from './ai-prompt.service';
import { looksChinese } from './language.util';
import { sourceSnapshotHash } from './source-hash.util';
import { AiSchemaValidator, type ValidationResult } from './ai-schema-validator.service';
import {
  type AiChatMessage,
  type AiChatResponse,
  type AiProviderAdapter,
  AiProviderError,
  type AiTaskType,
  type ModelSlot,
  type ProviderName,
  ROUTING_TABLE,
  TASK_ENTITY_TYPE,
  ZH_OUTPUT_EXEMPT_TASKS,
} from './ai-task.types';
import { AiUsageService } from './ai-usage.service';
import { NvidiaAdapter } from './providers/nvidia.adapter';
import { QwenAdapter } from './providers/qwen.adapter';

const DONE: AiReportStatus = 'DONE';
const FAILED: AiReportStatus = 'FAILED';

export type ChatInput = {
  taskType: AiTaskType;
  userId?: string | null;
  entityId?: string | null;
  question: string;
  scope?: string | null;
  sourceUpdatedAt?: string | null;
  context?: unknown;
  /** Prior conversation turns (general chat multi-turn); oldest→newest. */
  history?: ChatTurn[] | null;
};

export type TranslationResult = {
  ok: boolean;
  content: string;
  provider: AiProvider;
  model: string | null;
};

export type ReportInput<T> = {
  taskType: AiTaskType;
  userId?: string | null;
  entityId?: string | null;
  reportType: string;
  instruction: string;
  context?: unknown;
  scope?: string | null;
  /** When provided, output is parsed + validated; failure triggers fallback. */
  schema?: ZodType<T, ZodTypeDef, unknown>;
  /** Deterministic mock output used under AI_MOCK_MODE (no network). */
  mockData?: T;
  mockContent?: string;
  /** Allow the model to use public football knowledge (analysis-generation tasks). */
  allowModelKnowledge?: boolean;
};

export type ReportResult<T> = {
  reportId: string;
  status: AiReportStatus;
  ok: boolean;
  /** true when runReportIfChanged found an up-to-date report and skipped AI. */
  skipped?: boolean;
  data: T | null;
  content: string | null;
  provider: AiProvider | null;
  model: string | null;
  errorMessage: string | null;
};

type ResolvedSlot = { provider: ProviderName; model: string; adapter: AiProviderAdapter };

/**
 * The single seam every AI task funnels through (spec §"AI Router Flow"):
 * mock short-circuit → prompt → route to primary → validate → fallback →
 * persist (AiReport) → usage log → graceful degrade. Model ids and the
 * mock flag come from {@link AppConfigService}; nothing is hardcoded.
 */
@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly prompt: AiPromptService,
    private readonly validator: AiSchemaValidator,
    private readonly usage: AiUsageService,
    private readonly nvidia: NvidiaAdapter,
    private readonly qwen: QwenAdapter,
  ) {}

  /** GENERAL_CHAT + DEEP_*_CHAT. Always returns 200-shaped ChatAnswerDto. */
  async runChat(input: ChatInput): Promise<ChatAnswerDto> {
    const entityType = TASK_ENTITY_TYPE[input.taskType];

    if (this.config.aiMockMode) {
      await this.usage.log({
        userId: input.userId,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
        taskType: input.taskType,
        entityType,
        entityId: input.entityId,
        requestStatus: DONE,
        latencyMs: 0,
      });
      return buildMockChatAnswer(input.question, {
        scope: input.scope ?? undefined,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      });
    }

    const messages = this.prompt.build({
      taskType: input.taskType,
      scope: input.scope,
      context: input.context,
      userPrompt: input.question,
      history: input.history,
    });
    const result = await this.callWithRouting({
      taskType: input.taskType,
      userId: input.userId,
      entityId: input.entityId,
      messages,
      responseFormat: 'text',
    });

    if (result.ok) {
      return {
        answer: result.response.content,
        provider: result.response.provider,
        model: result.response.model,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      };
    }
    // Graceful degrade — never break the chat contract on provider outage.
    return {
      answer: '抱歉，AI 服務目前暫時無法使用，請稍後再試。本站分析以資料庫快照為準，若資料不足會明確標示。',
      provider: AiProvider.PROGRAM_RULE,
      model: null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    };
  }

  /** NEWS_TRANSLATION (Qwen Flash → Flash fallback). Returns translated text. */
  async runTranslation(input: {
    userId?: string | null;
    entityId?: string | null;
    source: string;
    scope?: string | null;
    /** Overrides the default translate instruction (e.g. full-text + key points). */
    instruction?: string;
  }): Promise<TranslationResult> {
    if (this.config.aiMockMode) {
      await this.usage.log({
        userId: input.userId,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
        taskType: 'NEWS_TRANSLATION',
        entityType: 'NEWS',
        entityId: input.entityId,
        requestStatus: DONE,
        latencyMs: 0,
      });
      return {
        ok: true,
        content: `【AI_MOCK_MODE 翻譯】${input.source}`,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
      };
    }

    const instruction =
      input.instruction ??
      '請將以下新聞內容翻譯成自然流暢的繁體中文，只輸出翻譯結果，不要加入任何額外說明或標題：';
    const messages = this.prompt.build({
      taskType: 'NEWS_TRANSLATION',
      scope: input.scope,
      userPrompt: `${instruction}\n\n${input.source}`,
    });
    const result = await this.callWithRouting({
      taskType: 'NEWS_TRANSLATION',
      userId: input.userId,
      entityId: input.entityId,
      messages,
      responseFormat: 'text',
      enforceZh: true,
    });

    if (result.ok) {
      return {
        ok: true,
        content: result.response.content,
        provider: result.response.provider,
        model: result.response.model,
      };
    }
    return { ok: false, content: '', provider: AiProvider.PROGRAM_RULE, model: null };
  }

  /**
   * Analysis tasks that persist an AiReport (champion A/B/final, etc). Always
   * creates a report row — DONE with validated output, or FAILED with the error
   * so the run can link to the attempt.
   */
  async runReport<T = string>(input: ReportInput<T>): Promise<ReportResult<T>> {
    const entityType = TASK_ENTITY_TYPE[input.taskType];
    const schema = input.schema;
    const hash = sourceSnapshotHash(input.context);

    if (this.config.aiMockMode) {
      return this.persistMockReport(input, entityType, hash);
    }

    const messages = this.prompt.build({
      taskType: input.taskType,
      scope: input.scope,
      context: input.context,
      userPrompt: input.instruction,
      allowModelKnowledge: input.allowModelKnowledge,
    });

    const result = await this.callWithRouting<T>({
      taskType: input.taskType,
      userId: input.userId,
      entityId: input.entityId,
      messages,
      responseFormat: schema ? 'json' : 'text',
      validate: schema ? (c) => this.validator.validate(schema, c) : undefined,
      enforceZh: true,
    });

    if (result.ok) {
      const report = await this.prisma.aiReport.create({
        data: {
          entityType,
          entityId: input.entityId ?? null,
          reportType: input.reportType,
          provider: result.response.provider,
          model: result.response.model,
          content: result.response.content,
          structuredJson: input.schema
            ? (result.data as unknown as Prisma.InputJsonValue)
            : undefined,
          sourceSnapshotHash: hash,
          inputTokenEstimate: result.response.inputTokenEstimate ?? null,
          outputTokenEstimate: result.response.outputTokenEstimate ?? null,
          status: DONE,
        },
      });
      return {
        reportId: report.id,
        status: DONE,
        ok: true,
        data: result.data,
        content: result.response.content,
        provider: result.response.provider,
        model: result.response.model,
        errorMessage: null,
      };
    }

    const primaryProvider = this.resolveSlot(ROUTING_TABLE[input.taskType].primary).provider;
    const report = await this.prisma.aiReport.create({
      data: {
        entityType,
        entityId: input.entityId ?? null,
        reportType: input.reportType,
        provider: primaryProvider,
        content: result.lastContent ?? null,
        sourceSnapshotHash: hash,
        status: FAILED,
        errorMessage: result.lastError,
      },
    });
    return {
      reportId: report.id,
      status: FAILED,
      ok: false,
      data: null,
      content: null,
      provider: null,
      model: null,
      errorMessage: result.lastError,
    };
  }

  /**
   * Like {@link runReport} but skips the AI call when the latest DONE report for
   * this entity+reportType already matches the current context hash — the
   * "don't regenerate unchanged data" path for generation jobs.
   */
  async runReportIfChanged<T = string>(input: ReportInput<T>): Promise<ReportResult<T>> {
    const entityType = TASK_ENTITY_TYPE[input.taskType];
    const hash = sourceSnapshotHash(input.context);
    if (hash) {
      const latest = await this.prisma.aiReport.findFirst({
        where: {
          entityType,
          entityId: input.entityId ?? null,
          reportType: input.reportType,
          status: DONE,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, sourceSnapshotHash: true },
      });
      if (latest && latest.sourceSnapshotHash === hash) {
        return {
          reportId: latest.id,
          status: DONE,
          ok: true,
          skipped: true,
          data: null,
          content: null,
          provider: null,
          model: null,
          errorMessage: null,
        };
      }
    }
    return this.runReport(input);
  }

  /** AI_MOCK_MODE path for runReport: persist a deterministic PROGRAM_RULE report. */
  private async persistMockReport<T>(
    input: ReportInput<T>,
    entityType: AiEntityType,
    hash: string | null,
  ): Promise<ReportResult<T>> {
    const data = (input.mockData ?? null) as T | null;
    const content = input.mockContent ?? '【AI_MOCK_MODE】示範分析內容（尚未串接真實模型）。';
    const report = await this.prisma.aiReport.create({
      data: {
        entityType,
        entityId: input.entityId ?? null,
        reportType: input.reportType,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
        content,
        structuredJson:
          input.schema && data != null ? (data as unknown as Prisma.InputJsonValue) : undefined,
        sourceSnapshotHash: hash,
        status: DONE,
      },
    });
    await this.usage.log({
      userId: input.userId,
      provider: AiProvider.PROGRAM_RULE,
      model: 'mock',
      taskType: input.taskType,
      entityType,
      entityId: input.entityId,
      requestStatus: DONE,
      latencyMs: 0,
    });
    return {
      reportId: report.id,
      status: DONE,
      ok: true,
      data,
      content,
      provider: AiProvider.PROGRAM_RULE,
      model: 'mock',
      errorMessage: null,
    };
  }

  // --- internals -----------------------------------------------------------

  /** Tries primary then fallback; logs an AiUsageLog row per attempt. */
  private async callWithRouting<T = string>(input: {
    taskType: AiTaskType;
    userId?: string | null;
    entityId?: string | null;
    messages: AiChatMessage[];
    responseFormat?: 'text' | 'json';
    validate?: (content: string) => ValidationResult<T>;
    /** Reject non-Chinese output and fall back (persisted reports/translations). */
    enforceZh?: boolean;
  }): Promise<
    | { ok: true; response: AiChatResponse; data: T }
    | { ok: false; lastError: string; lastContent?: string }
  > {
    const rule = ROUTING_TABLE[input.taskType];
    const slots = [rule.primary, rule.fallback].filter((s): s is ModelSlot => s !== null);
    const entityType = TASK_ENTITY_TYPE[input.taskType];
    let lastError = 'No model configured for task';
    let lastContent: string | undefined;

    for (const slot of slots) {
      const { provider, model, adapter } = this.resolveSlot(slot);
      try {
        const response = await adapter.chat({
          model,
          messages: input.messages,
          responseFormat: input.responseFormat,
        });

        // Language gate: persisted zh outputs must actually be Chinese, or an
        // English analysis would pass schema validation and get stored. Chat
        // is exempt — a user may legitimately converse in another language.
        if (
          input.enforceZh &&
          !ZH_OUTPUT_EXEMPT_TASKS.has(input.taskType) &&
          !looksChinese(response.content)
        ) {
          lastError = 'Output language check failed: expected 繁體中文, got non-Chinese text';
          lastContent = response.content;
          this.logger.warn(`${input.taskType} ${provider}/${model} output is not Chinese; trying fallback`);
          await this.usage.log({
            userId: input.userId,
            provider,
            model,
            taskType: input.taskType,
            entityType,
            entityId: input.entityId,
            requestStatus: FAILED,
            inputTokenEstimate: response.inputTokenEstimate,
            outputTokenEstimate: response.outputTokenEstimate,
            latencyMs: response.latencyMs,
            errorMessage: lastError,
          });
          continue;
        }

        if (input.validate) {
          const validation = input.validate(response.content);
          if (!validation.ok) {
            lastError = validation.error;
            lastContent = response.content;
            this.logger.warn(
              `${input.taskType} ${provider}/${model} output failed schema validation: ${validation.error}`,
            );
            await this.usage.log({
              userId: input.userId,
              provider,
              model,
              taskType: input.taskType,
              entityType,
              entityId: input.entityId,
              requestStatus: FAILED,
              inputTokenEstimate: response.inputTokenEstimate,
              outputTokenEstimate: response.outputTokenEstimate,
              latencyMs: response.latencyMs,
              errorMessage: `Validation failed: ${validation.error}`,
            });
            continue;
          }
          await this.logSuccess(input, provider, model, response);
          return { ok: true, response, data: validation.data };
        }

        await this.logSuccess(input, provider, model, response);
        return { ok: true, response, data: response.content as unknown as T };
      } catch (err) {
        const e =
          err instanceof AiProviderError
            ? err
            : new AiProviderError(provider, model, 'NETWORK', (err as Error).message);
        lastError = e.message;
        this.logger.warn(`${input.taskType} ${provider}/${model} attempt failed: ${e.message}`);
        await this.usage.log({
          userId: input.userId,
          provider,
          model,
          taskType: input.taskType,
          entityType,
          entityId: input.entityId,
          requestStatus: FAILED,
          latencyMs: e.latencyMs,
          errorMessage: e.message,
        });
      }
    }

    // Every configured slot failed — the caller will now graceful-degrade.
    this.logger.error(`${input.taskType} exhausted all providers: ${lastError}`);
    return { ok: false, lastError, lastContent };
  }

  private async logSuccess(
    input: { taskType: AiTaskType; userId?: string | null; entityId?: string | null },
    provider: ProviderName,
    model: string,
    response: AiChatResponse,
  ): Promise<void> {
    await this.usage.log({
      userId: input.userId,
      provider,
      model,
      taskType: input.taskType,
      entityType: TASK_ENTITY_TYPE[input.taskType],
      entityId: input.entityId,
      requestStatus: DONE,
      inputTokenEstimate: response.inputTokenEstimate,
      outputTokenEstimate: response.outputTokenEstimate,
      latencyMs: response.latencyMs,
    });
  }

  private resolveSlot(slot: ModelSlot): ResolvedSlot {
    const nvidia = this.config.nvidia;
    const qwen = this.config.qwen;
    switch (slot) {
      case 'NVIDIA_SUPER':
        return { provider: 'NVIDIA', model: nvidia.modelSuper, adapter: this.nvidia };
      case 'NVIDIA_ULTRA':
        return { provider: 'NVIDIA', model: nvidia.modelUltra, adapter: this.nvidia };
      case 'QWEN_PLUS':
        return { provider: 'QWEN', model: qwen.modelPlus, adapter: this.qwen };
      case 'QWEN_FLASH':
        return { provider: 'QWEN', model: qwen.modelFlash, adapter: this.qwen };
      case 'QWEN_FLASH_FALLBACK':
        return { provider: 'QWEN', model: qwen.modelFlashFallback, adapter: this.qwen };
    }
  }
}
