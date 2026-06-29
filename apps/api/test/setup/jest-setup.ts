import { loadTestEnv } from './load-test-env';

// Ensure the worker process targets the test DB / loads test env before AppModule loads.
loadTestEnv();
