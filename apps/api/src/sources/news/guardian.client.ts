import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { fetchJson } from '../http.util';
import type { GuardianResponse, GuardianResult } from './news-source.types';

/** Guardian Content API search client. */
@Injectable()
export class GuardianClient {
  constructor(private readonly config: AppConfigService) {}

  hasKey(): boolean {
    return this.config.guardian.apiKey.length > 0;
  }

  async search(query: string, pageSize = 20): Promise<GuardianResult[]> {
    const { baseUrl, apiKey } = this.config.guardian;
    const params = new URLSearchParams({
      q: query,
      section: 'football',
      'order-by': 'newest',
      'show-fields': 'trailText',
      'page-size': String(pageSize),
      'api-key': apiKey,
    });
    const url = `${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`;
    const data = await fetchJson<GuardianResponse>(url);
    return data.response?.results ?? [];
  }
}
