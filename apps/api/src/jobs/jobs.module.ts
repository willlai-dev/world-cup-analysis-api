import { Module } from '@nestjs/common';
import { ChampionPredictionModule } from '../champion-prediction/champion-prediction.module';
import { MatchesModule } from '../matches/matches.module';
import { NewsModule } from '../news/news.module';
import { PlayersModule } from '../players/players.module';
import { SourcesModule } from '../sources/sources.module';
import { TeamsModule } from '../teams/teams.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    SourcesModule,
    NewsModule,
    PlayersModule,
    MatchesModule,
    ChampionPredictionModule,
    TeamsModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsScheduler],
})
export class JobsModule {}
