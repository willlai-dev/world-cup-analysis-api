import { Injectable } from '@nestjs/common';
import { type Prisma, PlayerPosition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sleep } from '../http.util';
import type { SyncResult } from '../sync-result';
import { FootballDataClient } from './football-data.client';

/** football-data free tier ~10 req/min → pause between per-team squad calls. */
const THROTTLE_MS = 6500;

function mapPosition(position?: string | null): PlayerPosition {
  const p = (position ?? '').toLowerCase();
  if (!p) return PlayerPosition.UNKNOWN;
  if (p.includes('keep')) return PlayerPosition.GK;
  // Check midfield before defence so "Defensive Midfield" maps to MF, not DF.
  if (p.includes('midfield')) return PlayerPosition.MF;
  if (p.includes('back') || p.includes('defen')) return PlayerPosition.DF;
  if (p.includes('forward') || p.includes('winger') || p.includes('offence') || p.includes('attack') || p.includes('strik'))
    return PlayerPosition.FW;
  return PlayerPosition.UNKNOWN;
}

/**
 * Syncs squads for already-synced teams (those carrying a football-data
 * externalId). Throttled and resilient: a failing/rate-limited team is counted
 * and skipped, never aborting the whole job. Best-effort — squad availability
 * depends on the football-data plan/tier.
 */
@Injectable()
export class PlayerSyncService {
  private throttleMs = THROTTLE_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FootballDataClient,
  ) {}

  async run(): Promise<SyncResult> {
    if (!this.client.hasKey()) {
      return { source: 'football-data', skipped: true, reason: 'FOOTBALL_DATA_API_KEY not configured' };
    }

    const teams = await this.prisma.team.findMany({
      where: { externalId: { not: null } },
      select: { id: true, externalId: true },
    });

    let created = 0;
    let updated = 0;
    let failed = 0;
    let fetched = 0;

    for (let i = 0; i < teams.length; i += 1) {
      const team = teams[i];
      if (!team.externalId) continue;
      try {
        const squad = await this.client.getTeamSquad(team.externalId);
        fetched += squad.length;
        for (const member of squad) {
          const counts = await this.upsertPlayer(team.id, member);
          created += counts.created;
          updated += counts.updated;
        }
      } catch {
        // The client already retries 429s; a throw here means it gave up.
        failed += 1;
      }
      if (i < teams.length - 1) {
        await sleep(this.throttleMs);
      }
    }

    return { source: 'football-data', fetched, created, updated, failed };
  }

  private async upsertPlayer(
    teamId: string,
    member: { id: number; name: string; position?: string | null; shirtNumber?: number | null },
  ): Promise<{ created: number; updated: number }> {
    const externalId = String(member.id);
    const existing = await this.prisma.player.findFirst({
      where: { OR: [{ externalId }, { teamId, nameEn: member.name }] },
    });
    const data: Prisma.PlayerUncheckedCreateInput = {
      teamId,
      externalId,
      nameEn: member.name,
      position: mapPosition(member.position),
      shirtNumber: member.shirtNumber ?? undefined,
    };
    if (existing) {
      await this.prisma.player.update({ where: { id: existing.id }, data });
      return { created: 0, updated: 1 };
    }
    await this.prisma.player.create({ data });
    return { created: 1, updated: 0 };
  }
}
