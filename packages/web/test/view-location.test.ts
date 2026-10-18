/** WHAT THIS MOCKS, AND WHY (gate G6): nothing; pure URL/identity rules. */
import { expect, it } from 'vitest';
import { EMPTY_VIEW, readViewLocation, resolveViewWall, viewHref } from '../src/lib/view-location';

it('round-trips selection, reflection, section, member and parked time without content', () => {
  const view = { ...EMPTY_VIEW, wallId: 'group-id', label: 'Our room', section: 'field' as const,
    inspirationId: 'inspiration-id', reflectionId: 'answer-id', memberId: 'member-id', at: 1234567890 };
  const url = new URL(viewHref(view), 'https://waka.example');
  expect(readViewLocation(url.pathname, url.search)).toEqual({ ...view, label: 'our-room' });
  expect(url.href).not.toContain('query');
});
it('uses identity before names and keeps a renamed wall reachable', () => {
  const walls = [{ kind: 'self', id: '', name: 'Me' }, { kind: 'group', id: 'group-id', name: 'New name' }];
  expect(resolveViewWall({ ...EMPTY_VIEW, wallId: 'group-id', label: 'old-name' }, walls)).toBe(walls[1]);
});
it('still resolves old name-only links without treating a missing stable ID as another name', () => {
  const walls = [{ kind: 'group', id: 'group-id', name: 'Reading room' }];
  expect(resolveViewWall({ ...EMPTY_VIEW, wallId: 'reading-room' }, walls)).toBe(walls[0]);
  expect(resolveViewWall({ ...EMPTY_VIEW, wallId: 'reading-room', label: 'label' }, walls)).toBeUndefined();
  const translated = { kind: 'group', id: 'translated-id', name: '함께 읽기' };
  expect(resolveViewWall(readViewLocation('/w/%ED%95%A8%EA%BB%98-%EC%9D%BD%EA%B8%B0')!, [translated])).toBe(translated);
});
it('accepts direct inspiration links, ignores malformed metadata and refuses invalid paths', () => {
  expect(readViewLocation('/inspirations/inspiration-id', '?reflection=open')).toMatchObject({ inspirationId: 'inspiration-id', reflectionId: 'open', section: 'field' });
  expect(readViewLocation('/', '?at=nan&view=unknown&reflection=open')).toEqual(EMPTY_VIEW);
  expect(readViewLocation('/w/%ZZ')).toBeNull();
  expect(readViewLocation('/unrelated')).toBeNull();
});
/* An `open` this build does not know was dropped silently and opened plain
   home; it is a dead link now, and Home says so in words. */
it('refuses an open page this build does not know, and keeps the ones it does', () => {
  expect(readViewLocation('/', '?open=reading')).toBeNull();
  expect(readViewLocation('/', '?open=saves')).toMatchObject({ open: 'saves' });
  expect(readViewLocation('/', '?open=claims')).toMatchObject({ open: 'claims' });
});
it('treats an empty or blank open as absent, not as a dead link', () => {
  expect(readViewLocation('/', '?open=')).toMatchObject({ open: null });
  expect(readViewLocation('/', '?open=%20%20')).toMatchObject({ open: null });
  expect(readViewLocation('/w/me', '?open=&view=sky')).toMatchObject({ open: null, section: 'sky' });
});
/* THE TWO REVIEW SUITES THAT STOOD HERE ARE REPLACED, NOT DROPPED
   (2026-10-10). They asserted that `/review/:id` round-tripped and that
   `?thought=` carried one exact answer id. Both are deleted with the review
   flow, and the invariant they were really holding — an address this product
   emits is an address it can read back, and one it cannot read resolves to
   nothing rather than to an empty world — is what the suite below now asserts
   about the same two paths from the other side. That matters more than the
   round trip did: a `/review/...` link in somebody's history or in an old
   notification must land on "this link is unavailable", which is what a null
   from here produces. `test/native-navigation.test.ts` presses the same
   question at the native layer. */
it('refuses the folded review addresses rather than resolving them to an empty world',()=>{
  expect(readViewLocation('/review/session-id')).toBeNull();
  expect(readViewLocation('/review/session-id','?thought=answer-id')).toBeNull();
  expect(readViewLocation('/review/new')).toBeNull();
  expect(readViewLocation('/review')).toBeNull(); // remains available to a public profile handle
  /* and `?thought=` on the world's own address is not quietly adopted as some
     other field: it is simply not a parameter this view model has. */
  expect(readViewLocation('/','?thought=answer-id')).toEqual(EMPTY_VIEW);
});
it('round-trips principle detail and sharing without putting the chosen wording in the URL',()=>{
  const view={...EMPTY_VIEW,section:'sky' as const,principleId:'principle-id',sharePrinciple:true};
  expect(viewHref(view)).toBe('/principles/principle-id/share');expect(readViewLocation(viewHref(view))).toEqual(view);
  expect(readViewLocation('/principles/principle-id')).toEqual({...view,sharePrinciple:false});
});
it('round-trips private conversation identity without claiming the single-segment public handle',()=>{
  for(const conversationId of ['list','conversation-id']){const view={...EMPTY_VIEW,conversationId};expect(readViewLocation(viewHref(view))).toEqual(view);}
  expect(readViewLocation('/chat')).toBeNull();expect(readViewLocation('/chat/conversation-id','?text=private')?.conversationId).toBe('conversation-id');
});
