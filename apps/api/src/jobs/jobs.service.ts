import { Injectable } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type JobResult = {
  jobRunId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
};

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 1: records a JobRun (RUNNING -> DONE) without doing real external work.
   * Real data-source sync and AI generation jobs arrive in Phase 2/3.
   */
  async run(jobType: JobType): Promise<JobResult> {
    const started = await this.prisma.jobRun.create({
      data: { jobType, status: JobStatus.RUNNING, startedAt: new Date() },
    });
    const done = await this.prisma.jobRun.update({
      where: { id: started.id },
      data: {
        status: JobStatus.DONE,
        completedAt: new Date(),
        metadata: { mock: true, note: 'AI_MOCK_MODE / Phase 1 stub' },
      },
    });
    return {
      jobRunId: done.id,
      jobType: done.jobType,
      status: done.status,
      startedAt: done.startedAt ? done.startedAt.toISOString() : null,
      completedAt: done.completedAt ? done.completedAt.toISOString() : null,
    };
  }
}
