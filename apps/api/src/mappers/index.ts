import type {
  AiReport,
  ChampionPredictionEntry,
  Match,
  NewsArticle,
  NewsArticleTag,
  NewsTag,
  Player,
  Team,
  User,
} from '@prisma/client';
import type {
  AiReportDto,
  ChampionPredictionEntrySummary,
  MatchSummary,
  NewsSummary,
  PlayerSummary,
  TeamSummary,
  UserDto,
} from '../common/dto/contracts';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

export function toTeamSummary(team: Team): TeamSummary {
  return {
    id: team.id,
    nameEn: team.nameEn,
    nameZh: team.nameZh,
    fifaCode: team.fifaCode,
    continent: team.continent,
    groupName: team.groupName,
    coachName: team.coachName,
    flagUrl: team.flagUrl,
    worldRanking: team.worldRanking,
    ratingTier: team.ratingTier,
    championScore: team.championScore,
    formScore: team.formScore,
    attackScore: team.attackScore,
    midfieldScore: team.midfieldScore,
    defenseScore: team.defenseScore,
    statusScore: team.statusScore,
    isEliminated: team.isEliminated,
  };
}

export function toPlayerSummary(player: Player & { team?: Team | null }): PlayerSummary {
  return {
    id: player.id,
    teamId: player.teamId,
    team: player.team ? toTeamSummary(player.team) : undefined,
    nameEn: player.nameEn,
    nameZh: player.nameZh,
    position: player.position,
    clubName: player.clubName,
    shirtNumber: player.shirtNumber,
    ratingTier: player.ratingTier,
    overallScore: player.overallScore,
    attackScore: player.attackScore,
    creativityScore: player.creativityScore,
    techniqueScore: player.techniqueScore,
    defenseScore: player.defenseScore,
    physicalScore: player.physicalScore,
    formScore: player.formScore,
    role: player.role,
    injuryRiskLevel: player.injuryRiskLevel,
  };
}

export function toMatchSummary(
  match: Match & { homeTeam: Team; awayTeam: Team },
  aiSummary?: string | null,
): MatchSummary {
  return {
    id: match.id,
    homeTeam: toTeamSummary(match.homeTeam),
    awayTeam: toTeamSummary(match.awayTeam),
    stage: match.stage,
    groupName: match.groupName,
    stadium: match.stadium,
    kickoffAt: match.kickoffAt.toISOString(),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    sourceUpdatedAt: iso(match.sourceUpdatedAt),
    aiSummary: aiSummary ?? null,
  };
}

export function toNewsSummary(
  news: NewsArticle & { tags?: (NewsArticleTag & { newsTag: NewsTag })[] },
): NewsSummary {
  return {
    id: news.id,
    sourceName: news.sourceName,
    sourceUrl: news.sourceUrl,
    titleEn: news.titleEn,
    titleZh: news.titleZh,
    summaryEn: news.summaryEn,
    summaryZh: news.summaryZh,
    publishedAt: iso(news.publishedAt),
    category: news.category,
    tags: news.tags?.map((t) => ({ id: t.newsTag.id, name: t.newsTag.name, type: t.newsTag.type })),
    translationStatus: news.translationStatus,
  };
}

export function toChampionEntrySummary(
  entry: ChampionPredictionEntry & { team: Team },
): ChampionPredictionEntrySummary {
  return {
    id: entry.id,
    team: toTeamSummary(entry.team),
    rank: entry.rank,
    championScore: entry.championScore,
    ratingTier: entry.ratingTier,
    probabilityText: entry.probabilityText,
    strengths: entry.strengths,
    risks: entry.risks,
    aiComment: entry.aiComment,
  };
}

export function toAiReportDto(report: AiReport): AiReportDto {
  return {
    id: report.id,
    entityType: report.entityType,
    entityId: report.entityId,
    reportType: report.reportType,
    provider: report.provider,
    model: report.model,
    language: report.language,
    title: report.title,
    content: report.content,
    structuredJson: report.structuredJson ?? undefined,
    confidenceScore: report.confidenceScore,
    status: report.status,
    errorMessage: report.errorMessage,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}
