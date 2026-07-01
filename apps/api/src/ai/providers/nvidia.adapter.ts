import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type {
  AiChatRequest,
  AiChatResponse,
  AiProviderAdapter,
  ProviderName,
} from '../ai-task.types';
import { openAiCompatibleChat } from './openai-compatible.helper';

/** NVIDIA Build / NIM — OpenAI-compatible `/chat/completions`. */
@Injectable()
export class NvidiaAdapter implements AiProviderAdapter {
  readonly providerName: ProviderName = 'NVIDIA';

  constructor(private readonly config: AppConfigService) {}

  supportsModel(model: string): boolean {
    const { modelSuper, modelUltra } = this.config.nvidia;
    return model === modelSuper || model === modelUltra;
  }

  chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { apiKey, baseUrl } = this.config.nvidia;
    return openAiCompatibleChat(this.providerName, baseUrl, apiKey, request);
  }
}
