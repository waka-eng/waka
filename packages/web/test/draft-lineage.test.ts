// @vitest-environment jsdom
/** THE LINE OF DRAFTS THIS TAB FORKED (L10).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The module's only layer is
 * the browser's localStorage and sessionStorage, and jsdom's real ones run,
 * so what is asserted is what the browser keeps. Sign-out runs the real
 * `clearUnsentDrafts`. */
import {beforeEach,expect,it} from 'vitest';
import {clearDraftLineage,recordDraftStored} from '../src/lib/draft-lineage';
import {clearUnsentDrafts} from '../src/lib/draft-eviction';
const scope={accountId:'owner',profileId:'profile'};
const place='waka.profile:owner:profile:conversation:chat:draft:';
const key=(n:number)=>`${place}${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const put=(k:string,raw:string)=>{localStorage.setItem(k,raw);return {key:k,raw};};
/** This tab stores a draft, as `keep` does: put it, then record it over the row it was editing. */
const store=(k:string,raw:string,previous?:{key:string;raw:string})=>{const row=put(k,raw);recordDraftStored(scope,row,previous);return row;};
const session=()=>Object.keys(sessionStorage).map(k=>`${k}=${sessionStorage.getItem(k)}`).join('\n');
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
it('clears every draft this tab stored that the cleared one replaced, through a chain of forks',()=>{
  const o=store(key(1),'O'),f1=store(key(2),'F1',o);store(key(3),'F2',f1);
  clearDraftLineage(scope,key(3));
  expect(localStorage.getItem(o.key)).toBeNull();expect(localStorage.getItem(f1.key)).toBeNull();
  expect(session()).not.toContain(':draftLineage:forks');
});
it('never links a draft another tab wrote, so it is never cleared',()=>{
  const theirs=put(key(1),'Another tab, idle');store(key(2),'F',theirs);
  clearDraftLineage(scope,key(2));
  expect(localStorage.getItem(theirs.key)).toBe('Another tab, idle');
});
it('never links a key this tab made once another tab has rewritten it',()=>{
  store(key(1),'Mine, with a photo');const theirs=put(key(1),'Another tab carried it and edited');
  store(key(2),'F',theirs);clearDraftLineage(scope,key(2));
  expect(localStorage.getItem(key(1))).toBe('Another tab carried it and edited');
});
it('never clears a linked draft rewritten since the fork, nor an unlinked one',()=>{
  const o=store(key(1),'O'),other=put(key(4),'Another tab');store(key(2),'F',o);
  localStorage.setItem(o.key,'O, edited in another tab');
  clearDraftLineage(scope,key(2));
  expect(localStorage.getItem(o.key)).toBe('O, edited in another tab');expect(localStorage.getItem(other.key)).toBe('Another tab');
});
it('links only drafts of one place, and only what this tab recorded',()=>{
  const elsewhere=store('waka.profile:owner:profile:conversation:other:draft:11111111-1111-4111-8111-111111111111','Other chat');
  store(key(2),'F',elsewhere);clearDraftLineage(scope,key(2));
  expect(localStorage.getItem(elsewhere.key)).toBe('Other chat');
  const o=store(key(1),'O');store(key(3),'F',o);sessionStorage.clear();clearDraftLineage(scope,key(3));expect(localStorage.getItem(o.key)).toBe('O');
});
it('keeps no draft words in sessionStorage, only scoped keys and fingerprints',()=>{
  const o=store(key(1),'UNSENT_SECRET_WORDS');store(key(2),'UNSENT_SECRET_WORDS and more',o);
  expect(session()).not.toContain('UNSENT_SECRET');
  expect(Object.keys(sessionStorage).every(k=>k.startsWith('waka.profile:owner:profile:draftLineage:'))).toBe(true);
  expect(Object.keys(sessionStorage)).toHaveLength(2);
});
it('is removed at sign-out with the drafts, and another account’s record is kept',async()=>{
  const o=store(key(1),'O');store(key(2),'F',o);
  const other={accountId:'next',profileId:'profile'};
  recordDraftStored(other,put('waka.profile:next:profile:conversation:chat:draft:11111111-1111-4111-8111-111111111111','Theirs'),undefined);
  await clearUnsentDrafts(scope);
  expect(Object.keys(sessionStorage).filter(k=>k.startsWith('waka.profile:owner:'))).toEqual([]);
  expect(Object.keys(sessionStorage).filter(k=>k.startsWith('waka.profile:next:'))).toHaveLength(1);
});
