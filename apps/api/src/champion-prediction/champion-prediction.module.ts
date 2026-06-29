import { Module } from '@nestjs/common';
import { ChampionPredictionController } from './champion-prediction.controller';
import { ChampionPredictionService } from './champion-prediction.service';

@Module({
  controllers: [ChampionPredictionController],
  providers: [ChampionPredictionService],
  exports: [ChampionPredictionService],
})
export class ChampionPredictionModule {}
