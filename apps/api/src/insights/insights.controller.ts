import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PredictionInsightsDto } from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import { InsightsService } from './insights.service';

@ApiTags('insights')
@Controller('insights')
@UseGuards(NonAdminUserGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  // Program-rule aggregation over settled outcomes — no AI call, no QuotaGuard.
  @Get('predictions')
  @UseGuards(PremiumOnlyGuard)
  @ApiOperation({ summary: '預測戰績（PREMIUM）：賽前預測 vs 實際比分的命中統計與逐場列表。' })
  getPredictionInsights(): Promise<PredictionInsightsDto> {
    return this.insights.getPredictionInsights();
  }
}
