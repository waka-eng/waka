// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. The real owner-scoped storage
 * and compare-before-write behavior run against browser localStorage. */
import {beforeEach,expect,it} from 'vitest';
import {readPrincipleArtifactDrafts,storePrincipleArtifactDraft,clearPrincipleArtifactDraft,type PrincipleArtifactDraft} from '../src/lib/principle-artifact-drafts';
const scope={accountId:'owner',profileId:'human'},id='11111111-1111-4111-8111-111111111111';
const fresh=():PrincipleArtifactDraft=>({id:crypto.randomUUID(),writer:crypto.randomUUID(),updatedAt:Date.now(),appearance:'dark',format:'square',showName:false,entries:[{principleId:id,text:'My card wording',originalStatement:'The principle wording'}]});
beforeEach(()=>localStorage.clear());
it('restores only this account/profile and leaves original wording separate',()=>{
  const value=fresh();storePrincipleArtifactDraft(scope,id,value);
  expect(readPrincipleArtifactDrafts(scope,id)[0].value).toEqual(value);
  expect(readPrincipleArtifactDrafts({...scope,profileId:'agent'},id)).toEqual([]);
  expect(readPrincipleArtifactDrafts({...scope,accountId:'other'},id)).toEqual([]);
});
it('cannot overwrite or clear a newer draft using an older receipt',()=>{
  const first=storePrincipleArtifactDraft(scope,id,fresh());
  const next=storePrincipleArtifactDraft(scope,id,{...first.value,entries:[{...first.value.entries[0],text:'Newer words'}]},first);
  expect(()=>storePrincipleArtifactDraft(scope,id,{...first.value,showName:true},first)).toThrow('changed elsewhere');
  clearPrincipleArtifactDraft(first);expect(readPrincipleArtifactDrafts(scope,id)[0]).toEqual(next);
});
