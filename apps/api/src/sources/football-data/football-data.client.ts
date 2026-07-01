import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";
import { fetchJson, SourceError, sleep } from "../http.util";
import type {
  FdMatch,
  FdMatchesResponse,
  FdSquadMember,
  FdTeam,
  FdTeamDetail,
  FdTeamsResponse,
} from "./football-data.types";

/** Wait this long before retrying after a 429 (free tier rate limit). */
const RATE_LIMIT_RETRY_MS = 30_000;
const MAX_RETRIES = 5;

/** Thin client over football-data.org v4 (`X-Auth-Token` auth). */
@Injectable()
export class FootballDataClient {
  private retryDelayMs = RATE_LIMIT_RETRY_MS;

  constructor(private readonly config: AppConfigService) {}

  /** True when an API key is configured; sync services skip when false. */
  hasKey(): boolean {
    return this.config.footballData.apiKey.length > 0;
  }

  async getCompetitionTeams(): Promise<FdTeam[]> {
    const { competition } = this.config.footballData;
    const data = await this.getJson<FdTeamsResponse>(
      `/competitions/${competition}/teams`,
    );
    return data.teams ?? [];
  }

  async getTeamSquad(teamId: string): Promise<FdSquadMember[]> {
    const data = await this.getJson<FdTeamDetail>(`/teams/${teamId}`);
    return data.squad ?? [];
  }

  async getCompetitionMatches(status?: string): Promise<FdMatch[]> {
    const { competition } = this.config.footballData;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await this.getJson<FdMatchesResponse>(
      `/competitions/${competition}/matches${query}`,
    );
    return data.matches ?? [];
  }

  /** Fetch a single match by its football-data.org numeric ID. */
  async getMatch(matchId: number): Promise<FdMatch> {
    return this.getJson<FdMatch>(`/matches/${matchId}`);
  }

  /** GET with retry: on 429, wait Retry-After (>= 30s) and retry up to MAX_RETRIES. */
  private async getJson<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchJson<T>(this.url(path), { headers: this.headers() });
      } catch (err) {
        if (
          err instanceof SourceError &&
          err.statusCode === 429 &&
          attempt < MAX_RETRIES
        ) {
          await sleep(Math.max(err.retryAfterMs ?? 0, this.retryDelayMs));
          continue;
        }
        throw err;
      }
    }
  }

  private headers(): Record<string, string> {
    return { "X-Auth-Token": this.config.footballData.apiKey };
  }

  private url(path: string): string {
    return `${this.config.footballData.baseUrl.replace(/\/$/, "")}${path}`;
  }
}
