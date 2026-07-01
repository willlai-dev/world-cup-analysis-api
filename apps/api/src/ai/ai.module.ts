import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiPromptService } from './ai-prompt.service';
import { AiRouterService } from './ai-router.service';
import { AiSchemaValidator } from './ai-schema-validator.service';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { NvidiaAdapter } from './providers/nvidia.adapter';
import { QwenAdapter } from './providers/qwen.adapter';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiRouterService,
    AiPromptService,
    AiSchemaValidator,
    AiUsageService,
    NvidiaAdapter,
    QwenAdapter,
  ],
  exports: [AiService, AiRouterService],
})
export class AiModule {}
