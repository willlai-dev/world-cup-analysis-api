import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsIn, IsOptional } from 'class-validator';
import { type PipelinePreset, PIPELINE_PRESET_NAMES } from '../jobs.pipelines';

/**
 * Body for the admin manual trigger. Defaults to the FULL bootstrap pipeline.
 * `jobs` (when non-empty) overrides `pipeline` and runs exactly those job types,
 * in the given order — for targeted re-runs / debugging.
 */
export class RunJobsDto {
  @ApiPropertyOptional({
    enum: PIPELINE_PRESET_NAMES,
    default: 'FULL',
    description: 'Named preset to run (ignored when `jobs` is provided).',
  })
  @IsOptional()
  @IsIn(PIPELINE_PRESET_NAMES)
  pipeline?: PipelinePreset;

  @ApiPropertyOptional({
    enum: JobType,
    isArray: true,
    description: 'Explicit job types to run in order; overrides `pipeline`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(JobType, { each: true })
  jobs?: JobType[];
}
