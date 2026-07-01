import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type {
  AiChatRequest,
  AiChatResponse,
  AiProviderAdapter,
  ProviderName,
} from '../ai-task.types';
import { openAiCompatibleChat } from './openai-compatible.helper';

/** Qwen via DashScope OpenAI-compatible mode (`QWEN_OPENAI_BASE_URL`). */
@Injectable()
export class QwenAdapter implements AiProviderAdapter {
  readonly providerName: ProviderName = 'QWEN';

  constructor(private readonly config: AppConfigService) {}

  supportsModel(model: string): boolean {
    const { modelPlus, modelFlash, modelFlashFallback } = this.config.qwen;
    return model === modelPlus || model === modelFlash || model === modelFlashFallback;
  }

  chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { apiKey, openaiBaseUrl } = this.config.qwen;
    return openAiCompatibleChat(this.providerName, openaiBaseUrl, apiKey, request);
  }
}
