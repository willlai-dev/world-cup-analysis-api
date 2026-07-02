import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { QuotaModule } from './ai/quota/quota.module';
import { AuthModule } from './auth/auth.module';
import { ChampionPredictionModule } from './champion-prediction/champion-prediction.module';
import { ConfigModule } from './config/config.module';
import { FavoritesModule } from './favorites/favorites.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';
import { JobsModule } from './jobs/jobs.module';
import { MatchesModule } from './matches/matches.module';
import { NewsModule } from './news/news.module';
import { PlayersModule } from './players/players.module';
import { PrismaModule } from './prisma/prisma.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    PrismaModule,
    QuotaModule,
    AuthModule,
    UsersModule,
    AdminModule,
    TeamsModule,
    PlayersModule,
    MatchesModule,
    FavoritesModule,
    ChampionPredictionModule,
    NewsModule,
    HomeModule,
    AiModule,
    JobsModule,
    HealthModule,
  ],
})
export class AppModule {}
