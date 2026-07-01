import type { AppConfigService } from '../../config/app-config.service';
import * as http from '../http.util';
import { FootballDataClient } from './football-data.client';

jest.mock('../http.util', () => {
  const actual = jest.requireActual('../http.util');
  return { ...actual, fetchJson: jest.fn(), sleep: jest.fn().mockResolvedValue(undefined) };
});

const fetchJsonMock = http.fetchJson as jest.Mock;

describe('FootballDataClient 429 retry', () => {
  function build() {
    const config = {
      footballData: { apiKey: 'k', baseUrl: 'https://fd/v4', competition: 'WC' },
    } as unknown as AppConfigService;
    const client = new FootballDataClient(config);
    (client as unknown as { retryDelayMs: number }).retryDelayMs = 0;
    return client;
  }

  beforeEach(() => fetchJsonMock.mockReset());

  it('retries after a 429 and then succeeds', async () => {
    const client = build();
    fetchJsonMock
      .mockRejectedValueOnce(new http.SourceError('rate limited', 429, 30_000))
      .mockResolvedValueOnce({ teams: [{ id: 1, name: 'A', tla: 'A' }] });

    const teams = await client.getCompetitionTeams();

    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
    expect(teams).toHaveLength(1);
  });

  it('gives up after MAX_RETRIES consecutive 429s', async () => {
    const client = build();
    fetchJsonMock.mockRejectedValue(new http.SourceError('rate limited', 429, 30_000));

    await expect(client.getTeamSquad('1')).rejects.toBeInstanceOf(http.SourceError);
    expect(fetchJsonMock).toHaveBeenCalledTimes(6); // initial + 5 retries
  });

  it('does not retry non-429 errors', async () => {
    const client = build();
    fetchJsonMock.mockRejectedValue(new http.SourceError('forbidden', 403));

    await expect(client.getCompetitionTeams()).rejects.toBeInstanceOf(http.SourceError);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });
});
