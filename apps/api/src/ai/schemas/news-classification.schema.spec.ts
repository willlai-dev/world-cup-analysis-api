import { NewsClassificationOutputSchema } from './news-classification.schema';

function baseOutput(overrides: Record<string, unknown> = {}) {
  return {
    isWorldCupRelated: true,
    summaryZh: '摘要',
    category: 'TOURNAMENT',
    tags: [{ name: '1986年世界盃', type: 'TOURNAMENT' }],
    relatedTeamNames: [],
    relatedPlayerNames: [],
    confidenceScore: 90,
    dataLimitations: [],
    ...overrides,
  };
}

describe('NewsClassificationOutputSchema', () => {
  it('coerces an invalid tags[].type (model reusing category\'s TOURNAMENT) to OTHER instead of failing', () => {
    const result = NewsClassificationOutputSchema.safeParse(baseOutput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([{ name: '1986年世界盃', type: 'OTHER' }]);
    }
  });

  it('still accepts TOURNAMENT on the sibling category field', () => {
    const result = NewsClassificationOutputSchema.safeParse(baseOutput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('TOURNAMENT');
    }
  });

  it('passes through a valid tags[].type unchanged', () => {
    const result = NewsClassificationOutputSchema.safeParse(
      baseOutput({ tags: [{ name: '馬拉度納', type: 'PLAYER' }] }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([{ name: '馬拉度納', type: 'PLAYER' }]);
    }
  });

  it('defaults a tag with a missing type to OTHER', () => {
    const result = NewsClassificationOutputSchema.safeParse(
      baseOutput({ tags: [{ name: '未知標籤' }] }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([{ name: '未知標籤', type: 'OTHER' }]);
    }
  });
});
