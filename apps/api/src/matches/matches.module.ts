import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { InsightsModule } from "../insights/insights.module";
import { SourcesModule } from "../sources/sources.module";
import { MatchRefreshService } from "./match-refresh.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";

@Module({
  imports: [AiModule, SourcesModule, InsightsModule],
  controllers: [MatchesController],
  providers: [MatchesService, MatchRefreshService],
  exports: [MatchesService],
})
export class MatchesModule {}
