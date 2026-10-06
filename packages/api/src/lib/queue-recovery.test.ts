/** WHAT THIS MOCKS, AND WHY: `process.stdout.write` captures operational metric JSON
 * and simulates a broken sink. No database, provider or account is involved. */
import {afterEach,expect,it,vi} from 'vitest';
import {recordQueueRecovery} from './queue-recovery.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('emits bounded counts without payload, identifiers or uncontrolled dimensions',()=>{
  vi.stubEnv('WAKA_STAGE','PRIVATE_STAGE_SENTINEL');const log=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  recordQueueRecovery({overdue:2,oldestOverdueMs:310000,exhaustedLeases:1});
  const data=JSON.parse(log.mock.calls[0][0] as string);
  expect(data).toMatchObject({Stage:'other',OverdueJobs:2,OldestOverdueMs:310000,ExhaustedLeases:1});
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE_STAGE_SENTINEL|profileId|payload|statement/);
});
it('a broken metric sink does not fail recovery',()=>{
  vi.spyOn(process.stdout,'write').mockImplementation(()=>{throw new Error('Broken logging');});
  expect(()=>recordQueueRecovery({overdue:1,oldestOverdueMs:600000,exhaustedLeases:0})).not.toThrow();
});
