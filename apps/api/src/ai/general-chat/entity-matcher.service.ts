import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { EntityMatchResult, MatchedPlayer, MatchedTeam } from './general-chat.types';

const MAX_TEAMS = 5;
const MAX_PLAYERS = 8;
/** Minimum length for a Latin name token to be matched as a whole word. */
const MIN_TEAM_TOKEN = 5;
const MIN_PLAYER_TOKEN = 4;

/** Strips diacritics + lowercases for accent-insensitive Latin matching (Mbappé ≈ Mbappe). */
function normalizeLatin(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` appears in `haystack` as a standalone (word-bounded) token. */
function hasWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack);
}

/**
 * Finds DB teams/players referenced in a free-text question. Team names are few
 * (~48) so they are loaded and matched in-memory; players are matched the same
 * way with accent-normalized, word-bounded token matching. Prisma-only — no AI,
 * no HTTP (spec §"Entity Matching").
 */
@Injectable()
export class EntityMatcher {
  constructor(private readonly prisma: PrismaService) {}

  async match(question: string): Promise<EntityMatchResult> {
    const raw = question ?? '';
    const [teams, players] = await Promise.all([
      this.matchTeams(raw),
      this.matchPlayers(raw),
    ]);
    return { teams, players };
  }

  private async matchTeams(raw: string): Promise<MatchedTeam[]> {
    const rows = await this.prisma.team.findMany({
      select: { id: true, nameEn: true, nameZh: true, fifaCode: true },
    });
    const qNorm = normalizeLatin(raw);
    const qUpper = raw.toUpperCase();
    const matched: MatchedTeam[] = [];
    for (const t of rows) {
      if (this.teamHit(t, raw, qNorm, qUpper)) {
        matched.push(t);
        if (matched.length >= MAX_TEAMS) break;
      }
    }
    return matched;
  }

  private teamHit(t: MatchedTeam, raw: string, qNorm: string, qUpper: string): boolean {
    if (t.nameZh && raw.includes(t.nameZh)) return true;
    const en = normalizeLatin(t.nameEn);
    if (en.length >= 3 && hasWord(qNorm, en)) return true;
    for (const part of en.split(/\s+/)) {
      if (part.length >= MIN_TEAM_TOKEN && hasWord(qNorm, part)) return true;
    }
    // fifaCode (e.g. "FRA") is only meaningful as an explicit uppercase token.
    if (t.fifaCode && hasWord(qUpper, t.fifaCode.toUpperCase())) return true;
    return false;
  }

  private async matchPlayers(raw: string): Promise<MatchedPlayer[]> {
    const rows = await this.prisma.player.findMany({
      select: { id: true, nameEn: true, nameZh: true, teamId: true },
    });
    const qNorm = normalizeLatin(raw);
    const matched: MatchedPlayer[] = [];
    for (const p of rows) {
      if (this.playerHit(p, raw, qNorm)) {
        matched.push(p);
        if (matched.length >= MAX_PLAYERS) break;
      }
    }
    return matched;
  }

  private playerHit(p: MatchedPlayer, raw: string, qNorm: string): boolean {
    if (p.nameZh && p.nameZh.length >= 2 && raw.includes(p.nameZh)) return true;
    const en = normalizeLatin(p.nameEn);
    if (en.length >= MIN_PLAYER_TOKEN && hasWord(qNorm, en)) return true;
    for (const part of en.split(/\s+/)) {
      if (part.length >= MIN_PLAYER_TOKEN && hasWord(qNorm, part)) return true;
    }
    return false;
  }
}
