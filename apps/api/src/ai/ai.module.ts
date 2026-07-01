import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiPromptService } from './ai-prompt.service';
import { AiRouterService } from './ai-router.service';
import { AiSchemaValidator } from './ai-schema-validator.service';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { EntityMatcher } from './general-chat/entity-matcher.service';
import { GeneralChatContextService } from './general-chat/general-chat-context.service';
import { QuestionIntentResolver } from './general-chat/question-intent.resolver';
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
    QuestionIntentResolver,
    EntityMatcher,
    GeneralChatContextService,
    NvidiaAdapter,
    QwenAdapter,
  ],
  exports: [AiService, AiRouterService],
})
export class AiModule {}
