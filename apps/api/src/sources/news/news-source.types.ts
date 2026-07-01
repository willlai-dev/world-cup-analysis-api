/** Normalized news item produced by every news client before persistence. */
export type NewsSourceDto = {
  sourceName: string;
  sourceUrl: string;
  titleEn: string;
  summaryEn: string | null;
  contentSnippet: string | null;
  publishedAt: Date | null;
  language: string;
};

export type GuardianResult = {
  webTitle: string;
  webUrl: string;
  webPublicationDate?: string | null;
  sectionName?: string | null;
  fields?: { trailText?: string | null } | null;
};
export type GuardianResponse = { response?: { results?: GuardianResult[] } };

export type NewsApiArticle = {
  source?: { name?: string | null } | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  content?: string | null;
};
export type NewsApiResponse = { status?: string; articles?: NewsApiArticle[] };
