// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing; actual scoped localStorage and
 * compare-before-write receipts. */
import {beforeEach,expect,it} from 'vitest';
import {clearConversationDraft,readConversationDrafts,storeConversationDraft} from '../src/lib/conversation-drafts';
const scope={accountId:'a',profileId:'p'};
beforeEach(()=>localStorage.clear());
it('refuses stale overwrite/removal and keeps other profiles separate',()=>{
  const value={id:crypto.randomUUID(),writer:crypto.randomUUID(),updatedAt:1,revision:0,pending:false,content:'one'};
  const first=storeConversationDraft(scope,'c',value),second=storeConversationDraft(scope,'c',{...value,content:'two'},first);
  expect(()=>storeConversationDraft(scope,'c',{...value,content:'stale'},first)).toThrow();clearConversationDraft(first);expect(readConversationDrafts(scope,'c')).toEqual([second]);expect(readConversationDrafts({...scope,profileId:'other'},'c')).toEqual([]);
});
