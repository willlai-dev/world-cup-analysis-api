import type { PrismaService } from '../../prisma/prisma.service';
import type { EntityMatcher } from './entity-matcher.service';
import { GeneralChatContextService } from './general-chat-context.service';
import { QuestionIntentResolver } from './question-intent.resolver';
import type { EntityMatchResult } from './general-chat.types';

const NOW = new Date('2026-07-02T10:00:00Z');

function teamRow() {
  return {
    nameEn: 'France',
    nameZh: '法國',
    fifaCode: 'FRA',
    continent: 'Europe',
    groupName: 'A',
    coachName: 'Deschamps',
    worldRanking: 2,
    ratingTier: 'S',
    championScore: 90,
    formScore: 80,
    isEliminated: false,
    updatedAt: NOW,
  };
}

function playerRow() {
  return {
    nameEn: 'Kylian Mbappé',
    nameZh: null,
    position: 'FW',
    ratingTier: 'S',
    overallScore: 95,
    attackScore: 96,
    creativityScore: 90,
    techniqueScore: 92,
    defenseScore: 40,
    physicalScore: 88,
    formScore: 90,
    role: 'STARTER',
    injuryRiskLevel: 'LOW',
    updatedAt: NOW,
    team: { nameEn: 'France', nameZh: '法國' },
  };
}

function build() {
  const prisma = {
    team: { findMany: jest.fn().mockResolvedValue([]) },
    player: { findMany: jest.fn().mockResolvedValue([]) },
    championPredictionRun: { findFirst: jest.fn().mockResolvedValue(null) },
    match: { findMany: jest.fn().mockResolvedValue([]) },
    newsArticle: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const matcher = { match: jest.fn().mockResolvedValue({ teams: [], players: [] }) };
  const service = new GeneralChatContextService(
    prisma as unknown as PrismaService,
    new QuestionIntentResolver(),
    matcher as unknown as EntityMatcher,
  );
  return { service, prisma, matcher };
}

const emptyEntities: EntityMatchResult = { teams: [], players: [] };

describe('GeneralChatContextService', () => {
  it('builds champion context for a champion question', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue(emptyEntities);
    prisma.championPredictionRun.findFirst.mockResolvedValue({
      completedAt: NOW,
      createdAt: NOW,
      entries: [
        {
          rank: 1,
          championScore: 90,
          probabilityText: '30%',
          ratingTier: 'S',
          aiComment: 'x',
          team: { nameEn: 'France', nameZh: '法國' },
        },
      ],
    });

    const res = await service.build('目前冠軍預測前三名是誰？');

    expect(res.context).toBeDefined();
    expect(res.context).toHaveProperty('championPrediction');
    expect(res.scope).toContain('冠軍預測');
    expect(res.sourceUpdatedAt).toBe(NOW.toISOString());
  });

  it('builds match context from recent + live + upcoming, includes now, for a fixtures question', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue(emptyEntities);
    const upcomingMatch = {
      kickoffAt: NOW,
      status: 'SCHEDULED',
      stage: 'ROUND_OF_32',
      groupName: null,
      homeScore: null,
      awayScore: null,
      sourceUpdatedAt: NOW,
      homeTeam: { nameEn: 'Spain', nameZh: '西班牙' },
      awayTeam: { nameEn: 'Austria', nameZh: '奧地利' },
    };
    // loadMatches([]) issues 3 queries in order: recent FINISHED, live, upcoming SCHEDULED.
    prisma.match.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([upcomingMatch]);

    const res = await service.build('明天有哪些未開始的賽事');

    expect(res.context).toHaveProperty('matches');
    expect(res.context).toHaveProperty('now');
    expect(res.scope).toContain('賽事');
    // Upcoming query must filter by SCHEDULED (not just a "today" window).
    const statuses = prisma.match.findMany.mock.calls.map((c) => c[0].where?.status);
    expect(statuses).toContain('SCHEDULED');
  });

  it('builds both team and player context for "法國有哪些高評級球員"', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue({
      teams: [{ id: 'fr', nameEn: 'France', nameZh: '法國', fifaCode: 'FRA' }],
      players: [],
    });
    prisma.team.findMany.mockResolvedValue([teamRow()]);
    prisma.player.findMany.mockResolvedValue([playerRow()]);

    const res = await service.build('法國有哪些高評級球員');

    expect(res.context).toHaveProperty('teams');
    expect(res.context).toHaveProperty('players');
    expect(res.scope).toContain('法國');
    expect(res.scope).toContain('球員');
    // loadPlayers should have been scoped to the matched team.
    expect(prisma.player.findMany.mock.calls[0][0].where).toEqual({ teamId: { in: ['fr'] } });
  });

  it('builds news (and team) context for "最近阿根廷有什麼新聞"', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue({
      teams: [{ id: 'ar', nameEn: 'Argentina', nameZh: '阿根廷', fifaCode: 'ARG' }],
      players: [],
    });
    prisma.team.findMany.mockResolvedValue([{ ...teamRow(), nameEn: 'Argentina', nameZh: '阿根廷' }]);
    prisma.newsArticle.findMany.mockResolvedValue([
      {
        titleEn: 'Argentina win',
        titleZh: '阿根廷獲勝',
        summaryEn: 's',
        summaryZh: '摘',
        sourceName: 'Guardian',
        publishedAt: NOW,
        category: 'MATCH',
        tags: [{ newsTag: { name: 'Argentina' } }],
      },
    ]);

    const res = await service.build('最近阿根廷有什麼新聞');

    expect(res.context).toHaveProperty('news');
    expect(res.context).toHaveProperty('teams');
    expect(res.scope).toContain('新聞');
  });

  it('returns undefined context when nothing relevant is found (empty DB)', async () => {
    const { service, matcher } = build();
    matcher.match.mockResolvedValue(emptyEntities);

    const res = await service.build('隨便聊聊天氣');

    expect(res.context).toBeUndefined();
    expect(res.sourceUpdatedAt).toBeNull();
    expect(res.scope).toBe('一般問答');
  });

  it('bundles the named team fixtures even without a match keyword (介紹一下法國)', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue({
      teams: [{ id: 'fr', nameEn: 'France', nameZh: '法國', fifaCode: 'FRA' }],
      players: [],
    });
    prisma.team.findMany.mockResolvedValue([teamRow()]);
    prisma.match.findMany.mockResolvedValue([
      {
        kickoffAt: NOW,
        status: 'SCHEDULED',
        stage: 'ROUND_OF_16',
        groupName: null,
        homeScore: null,
        awayScore: null,
        sourceUpdatedAt: NOW,
        homeTeam: { nameEn: 'Paraguay', nameZh: '巴拉圭' },
        awayTeam: { nameEn: 'France', nameZh: '法國' },
      },
    ]);

    const res = await service.build('介紹一下法國');

    expect(res.context).toHaveProperty('teams');
    expect(res.context).toHaveProperty('matches'); // fixtures bundled from the entity
    expect(res.context).toHaveProperty('now');
    // fixtures queried scoped to the named team
    expect(prisma.match.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ homeTeamId: { in: ['fr'] } }, { awayTeamId: { in: ['fr'] } }],
    });
  });

  it("bundles the player's team fixtures when only a player is named (Mbappe 接下來對陣誰)", async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue({
      teams: [],
      players: [{ id: 'p1', nameEn: 'Kylian Mbappé', nameZh: null, teamId: 'fr' }],
    });
    prisma.player.findMany.mockResolvedValue([playerRow()]);
    prisma.match.findMany.mockResolvedValue([
      {
        kickoffAt: NOW,
        status: 'SCHEDULED',
        stage: 'ROUND_OF_16',
        groupName: null,
        homeScore: null,
        awayScore: null,
        sourceUpdatedAt: NOW,
        homeTeam: { nameEn: 'Paraguay', nameZh: '巴拉圭' },
        awayTeam: { nameEn: 'France', nameZh: '法國' },
      },
    ]);

    const res = await service.build('Mbappe 接下來對陣誰');

    expect(res.context).toHaveProperty('matches');
    const teamScoped = prisma.match.findMany.mock.calls.find((c) => c[0].where?.OR);
    expect(teamScoped?.[0].where).toEqual({
      OR: [{ homeTeamId: { in: ['fr'] } }, { awayTeamId: { in: ['fr'] } }],
    });
  });

  it('widens entity matching with prior turns (pronoun carryover)', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue({
      teams: [],
      players: [{ id: 'p1', nameEn: 'Kylian Mbappé', nameZh: null, teamId: 'fr' }],
    });
    prisma.player.findMany.mockResolvedValue([playerRow()]);

    const res = await service.build('他狀態如何？', 'Mbappe 是誰');

    // matcher receives current question + prior text so 「他」 resolves to Mbappé
    expect(matcher.match).toHaveBeenCalledWith('他狀態如何？ Mbappe 是誰');
    expect(res.context).toHaveProperty('players');
  });

  it('falls back to champion/matches/news for an UNKNOWN question with data present', async () => {
    const { service, prisma, matcher } = build();
    matcher.match.mockResolvedValue(emptyEntities);
    prisma.championPredictionRun.findFirst.mockResolvedValue({
      completedAt: NOW,
      createdAt: NOW,
      entries: [
        { rank: 1, championScore: 90, probabilityText: '30%', ratingTier: 'S', aiComment: 'x', team: { nameEn: 'France', nameZh: '法國' } },
      ],
    });

    const res = await service.build('嗨你好');

    expect(res.context).toBeDefined();
    expect(res.context).toHaveProperty('championPrediction');
  });
});
