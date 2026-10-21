// @vitest-environment jsdom
/** THE LINE OF DRAFTS THIS TAB FORKED (L10).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The module's only layer is
 * the browser's localStorage and sessionStorage, and jsdom's real ones run,
 * so what is asserted is what the browser keeps. */
import {beforeEach,expect,it} from 'vitest';
import {clearDraftLineage,recordDraftFork} from '../src/lib/draft-lineage';
const place='waka:owner:profile:conversation:chat:draft:';
const key=(n:number)=>`${place}${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const put=(k:string,raw:string)=>{localStorage.setItem(k,raw);return {key:k,raw};};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
it('clears every draft the cleared one replaced, through a chain of forks',()=>{
  const o=put(key(1),'O'),f1=put(key(2),'F1');put(key(3),'F2');
  recordDraftFork(f1.key,o);recordDraftFork(key(3),f1);
  clearDraftLineage(key(3));
  expect(localStorage.getItem(o.key)).toBeNull();expect(localStorage.getItem(f1.key)).toBeNull();
  expect(sessionStorage.getItem('waka:draftLineage:own')).toBeNull();
});
it('never clears a draft with no recorded link, nor one rewritten since the fork',()=>{
  const o=put(key(1),'O'),other=put(key(4),'Another tab');put(key(2),'F');
  recordDraftFork(key(2),o);localStorage.setItem(o.key,'O, edited in another tab');
  clearDraftLineage(key(2));
  expect(localStorage.getItem(o.key)).toBe('O, edited in another tab');expect(localStorage.getItem(other.key)).toBe('Another tab');
});
it('links only drafts of one place, and only what this tab recorded',()=>{
  const elsewhere=put('waka:owner:profile:conversation:other:draft:11111111-1111-4111-8111-111111111111','Other chat');
  recordDraftFork(key(2),elsewhere);clearDraftLineage(key(2));
  expect(localStorage.getItem(elsewhere.key)).toBe('Other chat');
  const o=put(key(1),'O');recordDraftFork(key(2),o);sessionStorage.clear();clearDraftLineage(key(2));expect(localStorage.getItem(o.key)).toBe('O');
});
