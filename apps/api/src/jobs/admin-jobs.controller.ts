import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { AdminOnlyGuard } from '../common/guards/admin-only.guard';
import { ListJobRunsQueryDto } from './dto/list-job-runs.dto';
import { RunJobsDto } from './dto/run-jobs.dto';
import { RunTeamDto } from './dto/run-team.dto';
import { PIPELINE_PRESETS } from './jobs.pipelines';
import { type JobResult, type TeamOption, JobsService } from './jobs.service';

export type RunPipelineAck = {
  started: boolean;
  label: string;
  jobTypes: JobType[];
};

export type RunTeamAck = {
  started: boolean;
  teamId: string;
  teamName: string;
  jobTypes: JobType[];
};

const PIPELINE_RUNNING = {
  code: 'PIPELINE_RUNNING',
  message: '目前已有一個資料抓取／評級流程在執行中，請待其完成後再試。',
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
      throw new ConflictException(PIPELINE_RUNNING);
    }
    return { started, label, jobTypes };
  }

  @Post('run-team/:teamId')
  @HttpCode(202)
  @ApiOperation({
    summary: '單獨分析一個國家：該隊球員評分 → 球隊評分 → 球員近況（可選先抓該隊名單）。',
  })
  async runTeam(
    @Param('teamId') teamId: string,
    @Body() dto: RunTeamDto,
  ): Promise<RunTeamAck> {
    // 404 before touching the guard so an unknown id never blocks/looks-busy.
    const team = await this.jobs.assertTeamExists(teamId);
    const { started, jobTypes } = this.jobs.startTeamPipeline(teamId, { sync: dto.sync });
    if (!started) {
      throw new ConflictException(PIPELINE_RUNNING);
    }
    return { started, teamId, teamName: team.nameEn, jobTypes };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent job runs (newest first) to watch pipeline progress.' })
  listRuns(@Query() query: ListJobRunsQueryDto): Promise<JobResult[]> {
    return this.jobs.listRuns(query.limit, query.jobType);
  }

  @Get('teams')
  @ApiOperation({
    summary: '球隊清單（id + 名稱 + FIFA 碼），供「單獨分析一個國家」選單使用。',
  })
  listTeams(): Promise<TeamOption[]> {
    return this.jobs.listTeamsForPicker();
  }
}
