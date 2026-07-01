import { Module } from '@nestjs/common';
import { FootballDataClient } from './football-data/football-data.client';
import { MatchSyncService } from './football-data/match-sync.service';
import { PlayerSyncService } from './football-data/player-sync.service';
import { TeamSyncService } from './football-data/team-sync.service';
import { GuardianClient } from './news/guardian.client';
import { NewsApiClient } from './news/newsapi.client';
import { NewsSyncService } from './news/news-sync.service';

/**
 * External data-source clients + sync services (football-data.org, Guardian,
 * NewsAPI). Consumed by JobsModule. Prisma + AppConfigService are @Global.
 */
@Module({
  providers: [
    FootballDataClient,
    TeamSyncService,
    PlayerSyncService,
    MatchSyncService,
    GuardianClient,
    NewsApiClient,
    NewsSyncService,
  ],
  exports: [TeamSyncService, PlayerSyncService, MatchSyncService, NewsSyncService],
})
export class SourcesModule {}
