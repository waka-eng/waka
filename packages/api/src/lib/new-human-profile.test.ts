/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. These config values are
 * synthetic server settings; actual creation/race tests use disposable SQL. */
import {expect,it} from 'vitest';
import {newHumanEmbeddingEnrollmentEnabled} from './new-human-profile.js';
it('keeps absent/0 off and requires an exact supported stage/App pair when enabled',()=>{
 expect(newHumanEmbeddingEnrollmentEnabled({})).toBe(false);
 expect(newHumanEmbeddingEnrollmentEnabled({WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'0',WAKA_STAGE:'production'})).toBe(false);
 for(const stage of ['development','dev','production']){
  const good={WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'1',WAKA_STAGE:stage,SST_RESOURCE_App:JSON.stringify({name:'waka',stage})};
  expect(newHumanEmbeddingEnrollmentEnabled(good)).toBe(true);
  for(const flag of ['', 'true',' 1','01','2'])expect(()=>newHumanEmbeddingEnrollmentEnabled({...good,WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:flag})).toThrow('invalid');
  for(const env of [{...good,WAKA_STAGE:'local'},{...good,SST_RESOURCE_App:'{}'},{...good,SST_RESOURCE_App:'private-malformed'},{...good,SST_RESOURCE_App:JSON.stringify({name:'other',stage})},{...good,SST_RESOURCE_App:JSON.stringify({name:'waka',stage:stage==='production'?'development':'production'})}])expect(()=>newHumanEmbeddingEnrollmentEnabled(env)).toThrow('invalid');
 }
});
