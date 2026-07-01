import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SyncResult } from '../sync-result';
import { FootballDataClient } from './football-data.client';

/** Syncs World Cup national teams from football-data.org into the Team table. */
@Injectable()
export class TeamSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FootballDataClient,
  ) {}

  async run(): Promise<SyncResult> {
    if (!this.client.hasKey()) {
      return { source: 'football-data', skipped: true, reason: 'FOOTBALL_DATA_API_KEY not configured' };
    }

    const teams = await this.client.getCompetitionTeams();
    let created = 0;
    let updated = 0;

    for (const t of teams) {
      const externalId = String(t.id);
      const fifaCode = t.tla ?? null;
      // Merge with seeded rows: they carry fifaCode (and sometimes externalId).
      const existing = await this.prisma.team.findFirst({
        where: { OR: [{ externalId }, ...(fifaCode ? [{ fifaCode }] : [])] },
      });

      // undefined leaves a column unchanged on update / falls back to default on create.
      const data: Prisma.TeamUncheckedCreateInput = {
        externalId,
        fifaCode,
        nameEn: t.name,
        coachName: t.coach?.name ?? undefined,
        flagUrl: t.crest ?? undefined,
      };

      if (existing) {
        await this.prisma.team.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await this.prisma.team.create({ data });
        created += 1;
      }
    }

    return { source: 'football-data', fetched: teams.length, created, updated };
  }
}
