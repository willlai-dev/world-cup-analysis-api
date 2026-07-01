import { Injectable } from '@nestjs/common';
import type { AiEntityType, AiProvider, AiReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AiTaskType } from './ai-task.types';

export type UsageEntry = {
  userId?: string | null;
  provider: AiProvider;
  model?: string | null;
  taskType: AiTaskType;
  entityType?: AiEntityType | null;
  entityId?: string | null;
  requestStatus: AiReportStatus;
  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
};

/** Writes one AiUsageLog row per provider attempt (success and failure). */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: UsageEntry): Promise<void> {
    await this.prisma.aiUsageLog.create({
      data: {
        userId: entry.userId ?? null,
        provider: entry.provider,
        model: entry.model ?? null,
        taskType: entry.taskType,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        requestStatus: entry.requestStatus,
        inputTokenEstimate: entry.inputTokenEstimate ?? null,
        outputTokenEstimate: entry.outputTokenEstimate ?? null,
        latencyMs: entry.latencyMs ?? null,
        errorMessage: entry.errorMessage ?? null,
      },
    });
  }
}
