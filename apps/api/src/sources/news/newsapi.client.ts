import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { fetchJson } from '../http.util';
import type { NewsApiArticle, NewsApiResponse } from './news-source.types';

/** newsapi.org `/everything` search client. */
@Injectable()
export class NewsApiClient {
  constructor(private readonly config: AppConfigService) {}

  hasKey(): boolean {
    return this.config.newsApi.apiKey.length > 0;
  }

  async search(query: string, pageSize = 20): Promise<NewsApiArticle[]> {
    const { baseUrl, apiKey } = this.config.newsApi;
    const params = new URLSearchParams({
      q: query,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: String(pageSize),
      apiKey,
    });
    const url = `${baseUrl.replace(/\/$/, '')}/everything?${params.toString()}`;
    const data = await fetchJson<NewsApiResponse>(url);
    return data.articles ?? [];
  }
}
