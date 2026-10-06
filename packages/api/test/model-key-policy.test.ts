/** WHAT THIS MOCKS, AND WHY: nothing. Pure policy uses synthetic metadata;
 * no real credentials, provider request or billing changes are involved. */
import {expect,it} from 'vitest';
import {verifyModelKeyLimit} from '../../../scripts/model-key-policy.mjs';
const key={limit:10,limit_reset:'monthly',include_byok_in_limit:true,label:'PRIVATE_CREDENTIAL_LABEL',creator_user_id:'PRIVATE_USER'};
it('accepts a tighter provider cap without implying separate stage or Gemini protection',()=>{
  expect(verifyModelKeyLimit(key,20,'monthly')).toEqual({provider:'openrouter',limitUsd:10,reset:'monthly',byokIncluded:true,separateStageKeysVerified:false,geminiLimitsVerified:false});
  expect(JSON.stringify(verifyModelKeyLimit(key,20,'monthly'))).not.toContain('PRIVATE');
});
it.each([{limit:null},{limit:50},{limit:'10'},{limit:-1},{limit_reset:'daily'},{include_byok_in_limit:false},{include_byok_in_limit:undefined}])('refuses an absent, broad or incomplete provider cap %#',override=>{
  expect(()=>verifyModelKeyLimit({...key,...override},10,'monthly')).toThrow();
});
it.each([[undefined,'monthly'],[0,'monthly'],[10,undefined],[10,'yearly']])('requires an approved policy before lookup %#',(amount,reset)=>{
  expect(()=>verifyModelKeyLimit(key,amount,reset)).toThrow('explicit');
});
