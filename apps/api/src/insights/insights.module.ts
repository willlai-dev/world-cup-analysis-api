import { Module } from '@nestjs/common';
import { CalibrationService } from './calibration.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  controllers: [InsightsController],
  providers: [InsightsService, CalibrationService],
  exports: [CalibrationService],
})
export class InsightsModule {}
