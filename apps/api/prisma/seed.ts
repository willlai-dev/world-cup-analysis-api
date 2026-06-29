/* eslint-disable no-console */
import {
  AiEntityType,
  AiProvider,
  AiReportStatus,
  ChampionPredictionTriggerType,
  JobStatus,
  MatchStage,
  MatchStatus,
  NewsCategory,
  NewsTagType,
  PlayerPosition,
  PlayerRole,
  PrismaClient,
  RatingTier,
  RiskLevel,
  TeamRatingTier,
  TranslationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;

async function seedUsers(): Promise<void> {
  const accounts = [
    {
      id: 'seed-user-admin',
      email: env('SEED_ADMIN_EMAIL', 'admin@example.com'),
      password: env('SEED_ADMIN_PASSWORD', 'admin123456'),
      displayName: env('SEED_ADMIN_DISPLAY_NAME', 'Initial Admin'),
      role: UserRole.ADMIN,
    },
    {
      id: 'seed-user-premium',
      email: env('SEED_PREMIUM_EMAIL', 'premium@example.com'),
      password: env('SEED_PREMIUM_PASSWORD', 'premium123456'),
      displayName: 'Premium User',
      role: UserRole.PREMIUM,
    },
    {
      id: 'seed-user-user',
      email: env('SEED_USER_EMAIL', 'user@example.com'),
      password: env('SEED_USER_PASSWORD', 'user123456'),
      displayName: 'Normal User',
      role: UserRole.USER,
    },
  ];

  for (const acc of accounts) {
    const passwordHash = await bcrypt.hash(acc.password, 10);
    await prisma.user.upsert({
      where: { email: acc.email },
      create: {
        id: acc.id,
        email: acc.email,
        passwordHash,
        displayName: acc.displayName,
        role: acc.role,
        status: UserStatus.ACTIVE,
        profile: { create: { nickname: acc.displayName } },
      },
      update: { displayName: acc.displayName, role: acc.role, passwordHash },
    });
  }
  console.log(`Seeded ${accounts.length} users (admin / premium / user).`);
}

type TeamSeed = {
  code: string;
  nameEn: string;
  nameZh: string;
  continent: string;
  groupName: string;
  coachName: string;
  worldRanking: number;
  ratingTier: TeamRatingTier;
  championScore: number;
  formScore: number;
  attackScore: number;
  midfieldScore: number;
  defenseScore: number;
  statusScore: number;
};

const TEAMS: TeamSeed[] = [
  { code: 'BRA', nameEn: 'Brazil', nameZh: '巴西', continent: 'South America', groupName: 'A', coachName: 'Dorival Júnior', worldRanking: 1, ratingTier: TeamRatingTier.S, championScore: 92, formScore: 88, attackScore: 93, midfieldScore: 88, defenseScore: 85, statusScore: 87 },
  { code: 'FRA', nameEn: 'France', nameZh: '法國', continent: 'Europe', groupName: 'B', coachName: 'Didier Deschamps', worldRanking: 2, ratingTier: TeamRatingTier.S, championScore: 90, formScore: 86, attackScore: 91, midfieldScore: 87, defenseScore: 86, statusScore: 85 },
  { code: 'ARG', nameEn: 'Argentina', nameZh: '阿根廷', continent: 'South America', groupName: 'C', coachName: 'Lionel Scaloni', worldRanking: 3, ratingTier: TeamRatingTier.S, championScore: 91, formScore: 90, attackScore: 89, midfieldScore: 88, defenseScore: 84, statusScore: 89 },
  { code: 'ENG', nameEn: 'England', nameZh: '英格蘭', continent: 'Europe', groupName: 'D', coachName: 'Thomas Tuchel', worldRanking: 4, ratingTier: TeamRatingTier.A, championScore: 84, formScore: 80, attackScore: 86, midfieldScore: 85, defenseScore: 83, statusScore: 80 },
  { code: 'ESP', nameEn: 'Spain', nameZh: '西班牙', continent: 'Europe', groupName: 'A', coachName: 'Luis de la Fuente', worldRanking: 5, ratingTier: TeamRatingTier.A, championScore: 85, formScore: 84, attackScore: 84, midfieldScore: 90, defenseScore: 82, statusScore: 83 },
  { code: 'GER', nameEn: 'Germany', nameZh: '德國', continent: 'Europe', groupName: 'B', coachName: 'Julian Nagelsmann', worldRanking: 6, ratingTier: TeamRatingTier.A, championScore: 82, formScore: 79, attackScore: 83, midfieldScore: 84, defenseScore: 80, statusScore: 78 },
];

async function seedTeams(): Promise<void> {
  for (const t of TEAMS) {
    const id = `seed-team-${t.code}`;
    await prisma.team.upsert({
      where: { fifaCode: t.code },
      create: {
        id,
        fifaCode: t.code,
        externalId: id,
        nameEn: t.nameEn,
        nameZh: t.nameZh,
        continent: t.continent,
        groupName: t.groupName,
        coachName: t.coachName,
        flagUrl: `https://flags.example.com/${t.code.toLowerCase()}.svg`,
        worldRanking: t.worldRanking,
        ratingTier: t.ratingTier,
        championScore: t.championScore,
        formScore: t.formScore,
        attackScore: t.attackScore,
        midfieldScore: t.midfieldScore,
        defenseScore: t.defenseScore,
        statusScore: t.statusScore,
      },
      update: {
        nameEn: t.nameEn,
        nameZh: t.nameZh,
        ratingTier: t.ratingTier,
        championScore: t.championScore,
      },
    });
  }
  console.log(`Seeded ${TEAMS.length} teams.`);
}

type PlayerSeed = {
  n: number;
  nameEn: string;
  nameZh: string;
  position: PlayerPosition;
  club: string;
  shirt: number;
  ratingTier: RatingTier;
  overall: number;
  role: PlayerRole;
  injury: RiskLevel;
};

const PLAYERS_BY_TEAM: Record<string, PlayerSeed[]> = {
  BRA: [
    { n: 1, nameEn: 'Vinicius Junior', nameZh: '小維尼修斯', position: PlayerPosition.FW, club: 'Real Madrid', shirt: 7, ratingTier: RatingTier.S, overall: 91, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 2, nameEn: 'Rodrygo', nameZh: '羅德里戈', position: PlayerPosition.FW, club: 'Real Madrid', shirt: 10, ratingTier: RatingTier.A_PLUS, overall: 87, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 3, nameEn: 'Casemiro', nameZh: '卡塞米羅', position: PlayerPosition.MF, club: 'Manchester United', shirt: 5, ratingTier: RatingTier.A, overall: 84, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
    { n: 4, nameEn: 'Alisson', nameZh: '阿利森', position: PlayerPosition.GK, club: 'Liverpool', shirt: 1, ratingTier: RatingTier.A_PLUS, overall: 88, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
  ],
  FRA: [
    { n: 1, nameEn: 'Kylian Mbappé', nameZh: '姆巴佩', position: PlayerPosition.FW, club: 'Real Madrid', shirt: 10, ratingTier: RatingTier.S, overall: 93, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 2, nameEn: 'Antoine Griezmann', nameZh: '格列茲曼', position: PlayerPosition.MF, club: 'Atlético Madrid', shirt: 7, ratingTier: RatingTier.A_PLUS, overall: 87, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 3, nameEn: 'Aurélien Tchouaméni', nameZh: '楚阿梅尼', position: PlayerPosition.MF, club: 'Real Madrid', shirt: 8, ratingTier: RatingTier.A, overall: 85, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
  ],
  ARG: [
    { n: 1, nameEn: 'Lionel Messi', nameZh: '梅西', position: PlayerPosition.FW, club: 'Inter Miami', shirt: 10, ratingTier: RatingTier.S, overall: 90, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
    { n: 2, nameEn: 'Julián Álvarez', nameZh: '阿爾瓦雷斯', position: PlayerPosition.FW, club: 'Atlético Madrid', shirt: 9, ratingTier: RatingTier.A_PLUS, overall: 86, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 3, nameEn: 'Emiliano Martínez', nameZh: '馬丁尼茲', position: PlayerPosition.GK, club: 'Aston Villa', shirt: 23, ratingTier: RatingTier.A, overall: 85, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
  ],
  ENG: [
    { n: 1, nameEn: 'Jude Bellingham', nameZh: '貝林厄姆', position: PlayerPosition.MF, club: 'Real Madrid', shirt: 10, ratingTier: RatingTier.S, overall: 89, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 2, nameEn: 'Harry Kane', nameZh: '凱恩', position: PlayerPosition.FW, club: 'Bayern Munich', shirt: 9, ratingTier: RatingTier.A_PLUS, overall: 88, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 3, nameEn: 'Bukayo Saka', nameZh: '薩卡', position: PlayerPosition.FW, club: 'Arsenal', shirt: 7, ratingTier: RatingTier.A, overall: 85, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
  ],
  ESP: [
    { n: 1, nameEn: 'Rodri', nameZh: '羅德里', position: PlayerPosition.MF, club: 'Manchester City', shirt: 16, ratingTier: RatingTier.S, overall: 90, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
    { n: 2, nameEn: 'Lamine Yamal', nameZh: '亞馬爾', position: PlayerPosition.FW, club: 'Barcelona', shirt: 19, ratingTier: RatingTier.A_PLUS, overall: 86, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 3, nameEn: 'Pedri', nameZh: '佩德里', position: PlayerPosition.MF, club: 'Barcelona', shirt: 8, ratingTier: RatingTier.A, overall: 85, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
  ],
  GER: [
    { n: 1, nameEn: 'Florian Wirtz', nameZh: '維爾茨', position: PlayerPosition.MF, club: 'Bayer Leverkusen', shirt: 10, ratingTier: RatingTier.A_PLUS, overall: 87, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
    { n: 2, nameEn: 'Jamal Musiala', nameZh: '穆夏拉', position: PlayerPosition.MF, club: 'Bayern Munich', shirt: 14, ratingTier: RatingTier.A_PLUS, overall: 87, role: PlayerRole.STARTER, injury: RiskLevel.MEDIUM },
    { n: 3, nameEn: 'Antonio Rüdiger', nameZh: '呂迪格', position: PlayerPosition.DF, club: 'Real Madrid', shirt: 2, ratingTier: RatingTier.A, overall: 84, role: PlayerRole.STARTER, injury: RiskLevel.LOW },
  ],
};

function abilityFrom(overall: number, position: PlayerPosition) {
  const isFw = position === PlayerPosition.FW;
  const isDf = position === PlayerPosition.DF || position === PlayerPosition.GK;
  return {
    attackScore: isFw ? overall + 2 : overall - 6,
    creativityScore: overall - 2,
    techniqueScore: overall - 1,
    defenseScore: isDf ? overall + 2 : overall - 8,
    physicalScore: overall - 3,
    formScore: overall - 1,
  };
}

async function seedPlayers(): Promise<void> {
  let count = 0;
  for (const [code, players] of Object.entries(PLAYERS_BY_TEAM)) {
    const teamId = `seed-team-${code}`;
    for (const p of players) {
      const id = `seed-player-${code}-${p.n}`;
      const ability = abilityFrom(p.overall, p.position);
      await prisma.player.upsert({
        where: { id },
        create: {
          id,
          externalId: id,
          teamId,
          nameEn: p.nameEn,
          nameZh: p.nameZh,
          position: p.position,
          clubName: p.club,
          shirtNumber: p.shirt,
          ratingTier: p.ratingTier,
          overallScore: p.overall,
          ...ability,
          role: p.role,
          injuryRiskLevel: p.injury,
        },
        update: { nameEn: p.nameEn, nameZh: p.nameZh, overallScore: p.overall, ratingTier: p.ratingTier },
      });
      count += 1;
    }
  }
  console.log(`Seeded ${count} players.`);
}

type MatchSeed = {
  n: number;
  home: string;
  away: string;
  stage: MatchStage;
  group: string | null;
  status: MatchStatus;
  daysFromNow: number;
  homeScore: number | null;
  awayScore: number | null;
};

const MATCHES: MatchSeed[] = [
  { n: 1, home: 'BRA', away: 'ESP', stage: MatchStage.GROUP, group: 'A', status: MatchStatus.FINISHED, daysFromNow: -3, homeScore: 2, awayScore: 1 },
  { n: 2, home: 'FRA', away: 'GER', stage: MatchStage.GROUP, group: 'B', status: MatchStatus.FINISHED, daysFromNow: -2, homeScore: 1, awayScore: 1 },
  { n: 3, home: 'ARG', away: 'ENG', stage: MatchStage.GROUP, group: 'C', status: MatchStatus.FINISHED, daysFromNow: -1, homeScore: 3, awayScore: 2 },
  { n: 4, home: 'BRA', away: 'FRA', stage: MatchStage.SEMI_FINAL, group: null, status: MatchStatus.SCHEDULED, daysFromNow: 0, homeScore: null, awayScore: null },
  { n: 5, home: 'ARG', away: 'ESP', stage: MatchStage.SEMI_FINAL, group: null, status: MatchStatus.SCHEDULED, daysFromNow: 2, homeScore: null, awayScore: null },
  { n: 6, home: 'ENG', away: 'GER', stage: MatchStage.QUARTER_FINAL, group: null, status: MatchStatus.SCHEDULED, daysFromNow: 5, homeScore: null, awayScore: null },
];

async function seedMatches(now: Date): Promise<void> {
  for (const m of MATCHES) {
    const id = `seed-match-${m.n}`;
    const kickoffAt = new Date(now);
    kickoffAt.setDate(kickoffAt.getDate() + m.daysFromNow);
    kickoffAt.setHours(19, 0, 0, 0);
    const winnerTeamId =
      m.homeScore !== null && m.awayScore !== null && m.homeScore !== m.awayScore
        ? `seed-team-${m.homeScore > m.awayScore ? m.home : m.away}`
        : null;
    await prisma.match.upsert({
      where: { externalId: id },
      create: {
        id,
        externalId: id,
        homeTeamId: `seed-team-${m.home}`,
        awayTeamId: `seed-team-${m.away}`,
        winnerTeamId,
        stage: m.stage,
        groupName: m.group,
        stadium: 'Seed Stadium',
        kickoffAt,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        sourceUpdatedAt: now,
      },
      update: { status: m.status, homeScore: m.homeScore, awayScore: m.awayScore, kickoffAt },
    });
  }
  console.log(`Seeded ${MATCHES.length} matches.`);
}

type NewsSeed = {
  n: number;
  source: string;
  titleEn: string;
  summaryEn: string;
  category: NewsCategory;
  tags: { name: string; type: NewsTagType }[];
};

const NEWS: NewsSeed[] = [
  { n: 1, source: 'Reuters', titleEn: 'Brazil edge Spain in thriller', summaryEn: 'Vinicius scores twice as Brazil beat Spain 2-1.', category: NewsCategory.MATCH, tags: [{ name: 'Brazil', type: NewsTagType.TEAM }, { name: 'Vinicius Junior', type: NewsTagType.PLAYER }] },
  { n: 2, source: 'BBC', titleEn: 'Mbappé fit for France semi-final', summaryEn: 'France confirm Mbappé recovered from a minor knock.', category: NewsCategory.INJURY, tags: [{ name: 'France', type: NewsTagType.TEAM }, { name: 'Kylian Mbappé', type: NewsTagType.PLAYER }, { name: 'injury', type: NewsTagType.INJURY }] },
  { n: 3, source: 'Guardian', titleEn: 'Argentina rely on Messi magic', summaryEn: 'Messi inspires Argentina past England 3-2.', category: NewsCategory.PLAYER, tags: [{ name: 'Argentina', type: NewsTagType.TEAM }, { name: 'Lionel Messi', type: NewsTagType.PLAYER }] },
  { n: 4, source: 'AP', titleEn: 'Germany rebuild under Nagelsmann', summaryEn: 'Tactical shifts give Germany fresh momentum.', category: NewsCategory.TACTIC, tags: [{ name: 'Germany', type: NewsTagType.TEAM }, { name: 'tactics', type: NewsTagType.TACTIC }] },
  { n: 5, source: 'FIFA', titleEn: 'Semi-final schedule confirmed', summaryEn: 'Kick-off times announced for the semi-finals.', category: NewsCategory.TOURNAMENT, tags: [{ name: 'tournament', type: NewsTagType.TOPIC }] },
];

async function seedNews(now: Date): Promise<void> {
  for (const a of NEWS) {
    const id = `seed-news-${a.n}`;
    const publishedAt = new Date(now);
    publishedAt.setDate(publishedAt.getDate() - a.n);
    const article = await prisma.newsArticle.upsert({
      where: { sourceUrl: `https://news.example.com/${id}` },
      create: {
        id,
        externalId: id,
        sourceName: a.source,
        sourceUrl: `https://news.example.com/${id}`,
        titleEn: a.titleEn,
        summaryEn: a.summaryEn,
        contentSnippet: a.summaryEn,
        publishedAt,
        fetchedAt: now,
        category: a.category,
        language: 'en',
        translationStatus: TranslationStatus.NONE,
        aiSummaryStatus: AiReportStatus.DONE,
      },
      update: { titleEn: a.titleEn, summaryEn: a.summaryEn, category: a.category },
    });

    for (const tag of a.tags) {
      const tagRow = await prisma.newsTag.upsert({
        where: { name_type: { name: tag.name, type: tag.type } },
        create: { name: tag.name, type: tag.type },
        update: {},
      });
      const existing = await prisma.newsArticleTag.findUnique({
        where: { newsArticleId_newsTagId: { newsArticleId: article.id, newsTagId: tagRow.id } },
      });
      if (!existing) {
        await prisma.newsArticleTag.create({
          data: { newsArticleId: article.id, newsTagId: tagRow.id },
        });
      }
    }
  }
  console.log(`Seeded ${NEWS.length} news articles with tags.`);
}

async function seedChampionPrediction(now: Date): Promise<void> {
  const ranked = [...TEAMS].sort((a, b) => b.championScore - a.championScore);
  const runId = 'seed-champ-run-1';
  await prisma.championPredictionRun.upsert({
    where: { id: runId },
    create: {
      id: runId,
      triggerType: ChampionPredictionTriggerType.SYSTEM,
      status: JobStatus.DONE,
      completedAt: now,
    },
    update: { status: JobStatus.DONE, completedAt: now },
  });

  for (let i = 0; i < ranked.length; i += 1) {
    const t = ranked[i];
    await prisma.championPredictionEntry.upsert({
      where: { runId_teamId: { runId, teamId: `seed-team-${t.code}` } },
      create: {
        runId,
        teamId: `seed-team-${t.code}`,
        rank: i + 1,
        championScore: t.championScore,
        ratingTier: t.ratingTier,
        probabilityText: `${Math.max(4, 30 - i * 4)}%`,
        strengths: [`${t.nameEn} 進攻火力`, '陣容深度'],
        risks: ['防守端偶有失誤'],
        aiComment: `${t.nameEn} 目前評分 ${t.championScore}，屬於奪冠熱門之一。`,
      },
      update: { rank: i + 1, championScore: t.championScore, ratingTier: t.ratingTier },
    });
  }
  console.log(`Seeded champion prediction run with ${ranked.length} entries.`);
}

async function seedAiReports(now: Date): Promise<void> {
  const reports = [
    {
      id: 'seed-aireport-team-bra',
      entityType: AiEntityType.TEAM,
      entityId: 'seed-team-BRA',
      reportType: 'TEAM_SQUAD_ANALYSIS',
      title: '巴西國家隊分析',
      content: '巴西擁有頂級鋒線與穩定後防，整體評級為 S。資料更新時間以最新快照為準。',
      structuredJson: { attack: 93, defense: 85, midfield: 88, status: 87 },
    },
    {
      id: 'seed-aireport-match-4',
      entityType: AiEntityType.MATCH,
      entityId: 'seed-match-4',
      reportType: 'MATCH_ANALYSIS',
      title: '巴西 vs 法國 賽前分析',
      content: '兩支 S 級球隊對決，傾向小比分勝負，需注意中場控制。預測僅供參考，不構成保證。',
      structuredJson: {
        keyFactors: ['中場控制', '定位球', '鋒線效率'],
        risks: ['紅牌風險', '傷病不確定性'],
        prediction: { homeWinLean: 0.42, drawLean: 0.28, awayWinLean: 0.3, explanation: '主場與近況略佔優。' },
      },
    },
    {
      id: 'seed-aireport-player-bra-1',
      entityType: AiEntityType.PLAYER,
      entityId: 'seed-player-BRA-1',
      reportType: 'PLAYER_HEXAGON_ANALYSIS',
      title: 'Vinicius Junior 能力分析',
      content: '爆發力與盤帶突出，狀態良好。',
      structuredJson: { overallScore: 91, attackScore: 93, creativityScore: 89, techniqueScore: 90, defenseScore: 60, physicalScore: 85, formScore: 90 },
    },
    {
      id: 'seed-aireport-champion-final',
      entityType: AiEntityType.CHAMPION_PREDICTION,
      entityId: 'seed-champ-run-1',
      reportType: 'CHAMPION_PREDICTION_FINAL',
      title: '冠軍預測綜合報告',
      content: '綜合各模型，南美與歐洲強權並列熱門，最終結果仍受抽籤與狀態影響。',
      structuredJson: { topPick: 'Brazil', note: 'mock final report' },
    },
  ];

  for (const r of reports) {
    await prisma.aiReport.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        reportType: r.reportType,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
        language: 'zh-TW',
        title: r.title,
        content: r.content,
        structuredJson: r.structuredJson,
        confidenceScore: 0.7,
        status: AiReportStatus.DONE,
        createdAt: now,
      },
      update: { content: r.content, structuredJson: r.structuredJson, status: AiReportStatus.DONE },
    });
  }
  console.log(`Seeded ${reports.length} AI report mocks.`);
}

async function main(): Promise<void> {
  const now = new Date();
  await seedUsers();
  await seedTeams();
  await seedPlayers();
  await seedMatches(now);
  await seedNews(now);
  await seedChampionPrediction(now);
  await seedAiReports(now);
  console.log('✅ Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
