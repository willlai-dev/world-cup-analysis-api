import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { AdminOnlyGuard } from '../common/guards/admin-only.guard';
import { ListJobRunsQueryDto } from './dto/list-job-runs.dto';
import { RunJobsDto } from './dto/run-jobs.dto';
import { PIPELINE_PRESETS } from './jobs.pipelines';
import { type JobResult, JobsService } from './jobs.service';

export type RunPipelineAck = {
  started: boolean;
  label: string;
  jobTypes: JobType[];
};

/**
 * Admin-authenticated manual trigger for the data-sync + AI-generation pipeline.
 * Unlike `/api/jobs/*` (cron-secret, one job each), this runs a whole pipeline
 * from a logged-in ADMIN cookie so the dashboard can bootstrap an empty prod DB.
 * The pipeline runs in the background (202); poll `GET /admin/jobs/runs` for
 * progress. Shares JobsService's reentrancy guard with the cron scheduler.
 */
@ApiTags('admin')
@Controller('admin/jobs')
@UseGuards(AdminOnlyGuard)
export class AdminJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post('run')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Manually start a sync + rating pipeline (default: FULL bootstrap).',
  })
  run(@Body() dto: RunJobsDto): RunPipelineAck {
    const custom = dto.jobs && dto.jobs.length > 0;
    const preset = dto.pipeline ?? 'FULL';
    const jobTypes = custom ? (dto.jobs as JobType[]) : [...PIPELINE_PRESETS[preset]];
    const label = custom ? 'manual-custom' : `manual-${preset.toLowerCase()}`;

    const { started } = this.jobs.startPipeline(label, jobTypes);
    if (!started) {
      throw new ConflictException({
        code: 'PIPELINE_RUNNING',
        message: '目前已有一個資料抓取／評級流程在執行中，請待其完成後再試。',
      });
    }
    return { started, label, jobTypes };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent job runs (newest first) to watch pipeline progress.' })
  listRuns(@Query() query: ListJobRunsQueryDto): Promise<JobResult[]> {
    return this.jobs.listRuns(query.limit, query.jobType);
  }
}
