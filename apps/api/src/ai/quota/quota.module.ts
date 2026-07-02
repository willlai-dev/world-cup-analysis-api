import { Global, Module } from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { QuotaService } from './quota.service';

/**
 * Global so QuotaGuard can be applied via @UseGuards in any feature module
 * (matches/teams/players/news/champion-prediction/ai) without re-importing.
 */
@Global()
@Module({
  providers: [QuotaService, QuotaGuard],
  exports: [QuotaService, QuotaGuard],
})
export class QuotaModule {}
