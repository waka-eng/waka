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
