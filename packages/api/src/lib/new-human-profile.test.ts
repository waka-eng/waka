/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. These config values are
 * synthetic server settings; actual creation/race tests use disposable SQL. */
import {expect,it} from 'vitest';
import {newHumanEmbeddingEnrollmentEnabled} from './new-human-profile.js';
it('keeps absent/0 off without inspecting App and refuses every non-dev enabled/invalid form',()=>{
 expect(newHumanEmbeddingEnrollmentEnabled({})).toBe(false);
 expect(newHumanEmbeddingEnrollmentEnabled({WAKA_DEV_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'0'})).toBe(false);
 const good={WAKA_DEV_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'1',WAKA_STAGE:'development',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'development'})};
 expect(newHumanEmbeddingEnrollmentEnabled(good)).toBe(true);
 for(const flag of ['', 'true',' 1','01','2'])expect(()=>newHumanEmbeddingEnrollmentEnabled({...good,WAKA_DEV_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:flag})).toThrow('invalid');
 for(const env of [{...good,WAKA_STAGE:'production'},{...good,SST_RESOURCE_App:'{}'},{...good,SST_RESOURCE_App:'private-malformed'},{...good,SST_RESOURCE_App:JSON.stringify({name:'other',stage:'development'})}])expect(()=>newHumanEmbeddingEnrollmentEnabled(env)).toThrow('invalid');
});
