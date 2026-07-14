import { QuestionIntentResolver } from './question-intent.resolver';

describe('QuestionIntentResolver', () => {
  const resolver = new QuestionIntentResolver();

  it('classifies a champion question as CHAMPION_QUERY', () => {
    const res = resolver.resolve('目前冠軍預測前三名是誰？');
    expect(res.intent).toBe('CHAMPION_QUERY');
    expect(res.categories).toEqual(['CHAMPION']);
  });

  it('classifies a fixtures question as MATCH_QUERY', () => {
    const res = resolver.resolve('今天有哪些比賽');
    expect(res.intent).toBe('MATCH_QUERY');
    expect(res.categories).toEqual(['MATCH']);
  });

  it('classifies「對陣 / 接下來」opponent questions as MATCH_QUERY', () => {
    expect(resolver.resolve('接下來法國對陣誰').categories).toContain('MATCH');
    expect(resolver.resolve('下一場出戰哪一隊').categories).toContain('MATCH');
  });

  it('classifies a team-strength question as TEAM_QUERY', () => {
    const res = resolver.resolve('巴西的戰力和陣容如何');
    expect(res.intent).toBe('TEAM_QUERY');
    expect(res.categories).toEqual(['TEAM']);
  });

  it('classifies a player question as PLAYER_QUERY', () => {
    const res = resolver.resolve('這位球員的狀態如何');
    expect(res.intent).toBe('PLAYER_QUERY');
    expect(res.categories).toEqual(['PLAYER']);
  });

  it('classifies a news question as NEWS_QUERY', () => {
    const res = resolver.resolve('最近有什麼新聞');
    expect(res.intent).toBe('NEWS_QUERY');
    expect(res.categories).toEqual(['NEWS']);
  });

  it('classifies a multi-category question as MIXED_QUERY', () => {
    const res = resolver.resolve('法國有哪些高評級球員，還有他們的新聞');
    expect(res.intent).toBe('MIXED_QUERY');
    expect(res.categories).toEqual(expect.arrayContaining(['PLAYER', 'NEWS']));
  });

  it('returns UNKNOWN for an unclassifiable question', () => {
    const res = resolver.resolve('你好嗎');
    expect(res.intent).toBe('UNKNOWN');
    expect(res.categories).toEqual([]);
    expect(res.wantsPrediction).toBe(false);
  });

  it('defaults a bare prediction question (賽事 typo) to MATCH_QUERY', () => {
    const res = resolver.resolve('最近一次賽是預測如何');
    expect(res.intent).toBe('MATCH_QUERY');
    expect(res.categories).toEqual(['MATCH']);
    expect(res.wantsPrediction).toBe(true);
  });

  it('flags wantsPrediction on a match prediction question', () => {
    const res = resolver.resolve('最近一次賽事的預測如何');
    expect(res.categories).toEqual(['MATCH']);
    expect(res.wantsPrediction).toBe(true);
  });

  it('keeps champion prediction questions CHAMPION-only (no MATCH fallback)', () => {
    const res = resolver.resolve('目前冠軍預測前三名是誰？');
    expect(res.categories).toEqual(['CHAMPION']);
    expect(res.wantsPrediction).toBe(true);
  });

  it('does not flag wantsPrediction on a plain fixtures question', () => {
    expect(resolver.resolve('今天有哪些比賽').wantsPrediction).toBe(false);
  });

  it('matches English keywords case-insensitively', () => {
    const res = resolver.resolve('who is the CHAMPION favourite');
    expect(res.categories).toContain('CHAMPION');
  });

  it('handles empty input without throwing', () => {
    expect(resolver.resolve('').intent).toBe('UNKNOWN');
  });
});
