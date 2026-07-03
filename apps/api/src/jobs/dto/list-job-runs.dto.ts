import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query for GET /admin/jobs/runs — recent JobRun rows, newest first. */
export class ListJobRunsQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @ApiPropertyOptional({ enum: JobType, description: 'Filter by job type.' })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;
}
