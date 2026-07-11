import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { fetchJson } from '../http.util';
import type { GuardianItemResponse, GuardianResponse, GuardianResult } from './news-source.types';

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
      'show-fields': 'trailText,bodyText',
      'page-size': String(pageSize),
      'api-key': apiKey,
    });
    const url = `${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`;
    const data = await fetchJson<GuardianResponse>(url);
    return data.response?.results ?? [];
  }

  /**
   * Fetches one article's plain-text body by its web URL (backfill for rows
   * stored before bodies were captured). The Guardian item id is the URL path,
   * so `theguardian.com/<id>` maps straight onto the single-item endpoint.
   * Returns null when the URL is not a Guardian item or the body is absent.
   */
  async getBodyTextByUrl(webUrl: string): Promise<string | null> {
    const { baseUrl, apiKey } = this.config.guardian;
    let itemPath: string;
    try {
      const parsed = new URL(webUrl);
      if (!parsed.hostname.endsWith('theguardian.com')) return null;
      itemPath = parsed.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
    if (!itemPath) return null;
    const params = new URLSearchParams({ 'show-fields': 'bodyText', 'api-key': apiKey });
    const url = `${baseUrl.replace(/\/$/, '')}/${itemPath}?${params.toString()}`;
    const data = await fetchJson<GuardianItemResponse>(url);
    const body = data.response?.content?.fields?.bodyText;
    return body && body.trim().length > 0 ? body : null;
  }
}
