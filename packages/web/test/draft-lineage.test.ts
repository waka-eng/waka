// @vitest-environment jsdom
/** THE LINE OF DRAFTS THIS TAB FORKED (L10).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The module's only layer is
 * the browser's localStorage and sessionStorage, and jsdom's real ones run,
 * so what is asserted is what the browser keeps. */
import {beforeEach,expect,it} from 'vitest';
import {clearDraftLineage,recordDraftStored} from '../src/lib/draft-lineage';
const place='waka:owner:profile:conversation:chat:draft:';
const key=(n:number)=>`${place}${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const put=(k:string,raw:string)=>{localStorage.setItem(k,raw);return {key:k,raw};};
/** This tab stores a draft, as `keep` does: put it, then record it over the row it was editing. */
const store=(k:string,raw:string,previous?:{key:string;raw:string})=>{const row=put(k,raw);recordDraftStored(row,previous);return row;};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
it('clears every draft this tab stored that the cleared one replaced, through a chain of forks',()=>{
  const o=store(key(1),'O'),f1=store(key(2),'F1',o);store(key(3),'F2',f1);
  clearDraftLineage(key(3));
  expect(localStorage.getItem(o.key)).toBeNull();expect(localStorage.getItem(f1.key)).toBeNull();
  expect(sessionStorage.getItem('waka:draftLineage:own')).toBeNull();
});
it('never links a draft another tab wrote, so it is never cleared',()=>{
  const theirs=put(key(1),'Another tab, idle');store(key(2),'F',theirs);
  clearDraftLineage(key(2));
  expect(localStorage.getItem(theirs.key)).toBe('Another tab, idle');
});
it('never links a key this tab made once another tab has rewritten it',()=>{
  store(key(1),'Mine, with a photo');const theirs=put(key(1),'Another tab carried it and edited');
  store(key(2),'F',theirs);clearDraftLineage(key(2));
  expect(localStorage.getItem(key(1))).toBe('Another tab carried it and edited');
});
it('never clears a linked draft rewritten since the fork, nor an unlinked one',()=>{
  const o=store(key(1),'O'),other=put(key(4),'Another tab');store(key(2),'F',o);
  localStorage.setItem(o.key,'O, edited in another tab');
  clearDraftLineage(key(2));
  expect(localStorage.getItem(o.key)).toBe('O, edited in another tab');expect(localStorage.getItem(other.key)).toBe('Another tab');
});
it('links only drafts of one place, and only what this tab recorded',()=>{
  const elsewhere=store('waka:owner:profile:conversation:other:draft:11111111-1111-4111-8111-111111111111','Other chat');
  store(key(2),'F',elsewhere);clearDraftLineage(key(2));
  expect(localStorage.getItem(elsewhere.key)).toBe('Other chat');
  const o=store(key(1),'O');store(key(3),'F',o);sessionStorage.clear();clearDraftLineage(key(3));expect(localStorage.getItem(o.key)).toBe('O');
});
