import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Body for the per-country manual trigger (`POST /admin/jobs/run-team/:teamId`). */
export class RunTeamDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'Re-fetch this team\'s squad from football-data before analysis. Set false to re-analyze existing data only (no external call).',
  })
  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}
