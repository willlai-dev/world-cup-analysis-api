/** Minimal shapes for the football-data.org v4 responses we consume. */

export type FdTeam = {
  id: number;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
  coach?: { name?: string | null } | null;
};

export type FdTeamsResponse = { count?: number; teams: FdTeam[] };

export type FdSquadMember = {
  id: number;
  name: string;
  position?: string | null;
  shirtNumber?: number | null;
};

export type FdTeamDetail = FdTeam & { squad?: FdSquadMember[] };

export type FdMatchTeamRef = { id: number | null; name?: string | null; tla?: string | null };

export type FdMatch = {
  id: number;
  utcDate: string;
  status: string;
  stage?: string | null;
  group?: string | null;
  homeTeam: FdMatchTeamRef;
  awayTeam: FdMatchTeamRef;
  score?: {
    winner?: string | null;
    fullTime?: { home?: number | null; away?: number | null };
  } | null;
  lastUpdated?: string | null;
};

export type FdMatchesResponse = { count?: number; matches: FdMatch[] };
