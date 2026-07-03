import { JobType } from '@prisma/client';
import { PIPELINE_PRESET_NAMES, PIPELINE_PRESETS } from './jobs.pipelines';

const validJobTypes = new Set(Object.values(JobType));

/** Position of a job in a pipeline (-1 if absent). */
const at = (pipeline: readonly JobType[], job: JobType) => pipeline.indexOf(job);

describe('PIPELINE_PRESETS', () => {
  it('exposes the expected preset names', () => {
    expect(PIPELINE_PRESET_NAMES).toEqual([
      'FULL',
      'SYNC',
      'GENERATE',
      'TEAMS',
      'PLAYERS',
      'MATCHES',
      'NEWS',
      'CHAMPION',
    ]);
  });

  it('every preset is a non-empty list of valid, unique JobTypes', () => {
    for (const name of PIPELINE_PRESET_NAMES) {
      const jobs = PIPELINE_PRESETS[name];
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every((j) => validJobTypes.has(j))).toBe(true);
      expect(new Set(jobs).size).toBe(jobs.length); // no duplicates
    }
  });

  it('per-domain presets bundle that domain sync + its AI analysis', () => {
    expect(PIPELINE_PRESETS.TEAMS).toEqual(['SYNC_TEAMS', 'GENERATE_TEAM_RATINGS']);
    expect(PIPELINE_PRESETS.PLAYERS).toEqual([
      'SYNC_PLAYERS',
      'GENERATE_PLAYER_RATINGS',
      'GENERATE_PLAYER_STATUS',
    ]);
    expect(PIPELINE_PRESETS.MATCHES).toEqual([
      'SYNC_FIXTURES',
      'SYNC_RESULTS',
      'GENERATE_MATCH_ANALYSIS',
    ]);
    expect(PIPELINE_PRESETS.NEWS).toEqual([
      'FETCH_NEWS',
      'GENERATE_NEWS_SUMMARY',
      'GENERATE_NEWS_IMPACT',
    ]);
    expect(PIPELINE_PRESETS.CHAMPION).toEqual(['GENERATE_CHAMPION_PREDICTIONS']);
  });

  it('FULL runs every job in dependency-safe order', () => {
    const full = PIPELINE_PRESETS.FULL;
    // one of each job type
    expect(new Set(full)).toEqual(validJobTypes);
    // player ratings feed team ratings; team ratings feed champion ranking
    expect(at(full, 'GENERATE_PLAYER_RATINGS')).toBeLessThan(at(full, 'GENERATE_TEAM_RATINGS'));
    expect(at(full, 'GENERATE_TEAM_RATINGS')).toBeLessThan(
      at(full, 'GENERATE_CHAMPION_PREDICTIONS'),
    );
    // news must be fetched+summarised before player status reads tagged news
    expect(at(full, 'FETCH_NEWS')).toBeLessThan(at(full, 'GENERATE_NEWS_SUMMARY'));
    expect(at(full, 'GENERATE_NEWS_SUMMARY')).toBeLessThan(at(full, 'GENERATE_PLAYER_STATUS'));
    // all syncs precede all generation
    const lastSync = Math.max(
      at(full, 'SYNC_TEAMS'),
      at(full, 'SYNC_PLAYERS'),
      at(full, 'SYNC_FIXTURES'),
      at(full, 'SYNC_RESULTS'),
      at(full, 'FETCH_NEWS'),
    );
    const firstGenerate = Math.min(
      ...full.filter((j) => j.startsWith('GENERATE_')).map((j) => at(full, j)),
    );
    expect(lastSync).toBeLessThan(firstGenerate);
  });

  it('SYNC has no AI jobs; GENERATE has no sync jobs', () => {
    expect(PIPELINE_PRESETS.SYNC.some((j) => j.startsWith('GENERATE_'))).toBe(false);
    const syncish = (j: JobType) => j.startsWith('SYNC_') || j === 'FETCH_NEWS';
    expect(PIPELINE_PRESETS.GENERATE.some(syncish)).toBe(false);
  });
});
