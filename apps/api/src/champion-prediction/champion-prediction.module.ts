import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChampionPredictionController } from './champion-prediction.controller';
import { ChampionPredictionService } from './champion-prediction.service';

@Module({
  imports: [AiModule],
  controllers: [ChampionPredictionController],
  providers: [ChampionPredictionService],
  exports: [ChampionPredictionService],
})
export class ChampionPredictionModule {}
