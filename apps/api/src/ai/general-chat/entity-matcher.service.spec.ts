import type { PrismaService } from '../../prisma/prisma.service';
import { EntityMatcher } from './entity-matcher.service';

const TEAMS = [
  { id: 'fr', nameEn: 'France', nameZh: '法國', fifaCode: 'FRA' },
  { id: 'ar', nameEn: 'Argentina', nameZh: '阿根廷', fifaCode: 'ARG' },
  { id: 'kr', nameEn: 'Korea Republic', nameZh: '南韓', fifaCode: 'KOR' },
];

const PLAYERS = [
  { id: 'p1', nameEn: 'Kylian Mbappé', nameZh: null, teamId: 'fr' },
  { id: 'p2', nameEn: 'Lionel Messi', nameZh: '梅西', teamId: 'ar' },
];

function build() {
  const prisma = {
    team: { findMany: jest.fn().mockResolvedValue(TEAMS) },
    player: { findMany: jest.fn().mockResolvedValue(PLAYERS) },
  };
  const matcher = new EntityMatcher(prisma as unknown as PrismaService);
  return { matcher, prisma };
}

describe('EntityMatcher', () => {
  it('matches a team by English name', async () => {
    const { matcher } = build();
    const res = await matcher.match('France squad strength');
    expect(res.teams.map((t) => t.id)).toContain('fr');
  });

  it('matches a team by Chinese name (nameZh)', async () => {
    const { matcher } = build();
    const res = await matcher.match('阿根廷最近有什麼新聞');
    expect(res.teams.map((t) => t.id)).toContain('ar');
  });

  it('matches a team by fifaCode used as an explicit token', async () => {
    const { matcher } = build();
    const res = await matcher.match('KOR group standings');
    expect(res.teams.map((t) => t.id)).toContain('kr');
  });

  it('matches a multi-word team by a significant name part (Korea)', async () => {
    const { matcher } = build();
    const res = await matcher.match('How is Korea doing?');
    expect(res.teams.map((t) => t.id)).toContain('kr');
  });

  it('matches a player by surname despite an accent difference (Mbappe ≈ Mbappé)', async () => {
    const { matcher } = build();
    const res = await matcher.match('Mbappe 狀態如何');
    expect(res.players.map((p) => p.id)).toContain('p1');
  });

  it('matches a player by Chinese name (nameZh)', async () => {
    const { matcher } = build();
    const res = await matcher.match('梅西還會踢嗎');
    expect(res.players.map((p) => p.id)).toContain('p2');
  });

  it('does not produce false positives on a generic question', async () => {
    const { matcher } = build();
    const res = await matcher.match('今天有哪些比賽');
    expect(res.teams).toHaveLength(0);
    expect(res.players).toHaveLength(0);
  });
});
