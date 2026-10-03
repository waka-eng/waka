/** WHAT THIS MOCKS, AND WHY (gate G6): `indexedDB` uses `fake-indexeddb` as the browser
 * storage engine in Node. The shipped ownership/CAS/settlement operations and
 * real Blob structured clones run; actual browser storage is also a release check. */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InspirationDraftConflict, loadInspirationDraft, newInspirationDraft, settleInspirationMediaDraft, writeInspirationDraft } from '../src/lib/inspiration-draft-store';

const scope = { accountId: 'account-a', profileId: 'profile-a' };
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
it('recovers an unfinished link even before it has been added to the note',async()=>{
  const draft={...newInspirationDraft(),revision:1,linkText:'https://example.test/unfinished'};
  await writeInspirationDraft(scope,draft,0);
  expect(await loadInspirationDraft(scope)).toMatchObject({id:draft.id,text:'',linkText:draft.linkText});
  expect(await loadInspirationDraft({accountId:'another',profileId:'another'})).toBeNull();
  await writeInspirationDraft(scope,{...draft,revision:2,linkText:'https://example.test/newer'},1);
  expect(await settleInspirationMediaDraft(scope,draft.id,1,'older-save')).toBe(false);
  expect((await loadInspirationDraft(scope))?.linkText).toBe('https://example.test/newer');
});
it('recovers actual draft bytes and text for their account/profile only', async () => {
  const draft = { ...newInspirationDraft('My unfinished thought'), revision: 1,
    media: [{ id: 'audio-1', type: 'audio' as const, name: 'Recording.webm', blob: new Blob(['original bytes'], { type: 'audio/webm' }) }] };
  await writeInspirationDraft(scope, draft, 0);
  const loaded = await loadInspirationDraft(scope);
  expect(loaded?.text).toBe(draft.text); expect(await loaded?.media[0]?.blob?.text()).toBe('original bytes');
  expect(await loadInspirationDraft({ ...scope, profileId: 'profile-b' })).toBeNull();
  expect(await loadInspirationDraft({ ...scope, accountId: 'other-account' }, draft.id)).toBeNull();
});
it('refuses a stale tab overwriting a newer revision, preserving the newer attachment', async () => {
  const initial = { ...newInspirationDraft('First thought'), revision: 1 };
  await writeInspirationDraft(scope, initial, 0);
  await writeInspirationDraft(scope, { ...initial, revision: 2, text: 'Newer thought', media: [{ id: 'link', type: 'link', name: 'Kept', url: 'https://example.test' }] }, 1);
  await expect(writeInspirationDraft(scope, { ...initial, revision: 2, text: 'Stale thought' }, 1)).rejects.toBeInstanceOf(InspirationDraftConflict);
  expect(await loadInspirationDraft(scope, initial.id)).toMatchObject({ text: 'Newer thought', media: [{ id: 'link' }] });
});
it('a completed older save cannot clear words or bytes added during its request', async () => {
  const initial = { ...newInspirationDraft('Before save'), revision: 1 };
  await writeInspirationDraft(scope, initial, 0);
  await writeInspirationDraft(scope, { ...initial, text: 'Written while saving', revision: 2 }, 1);
  expect(await settleInspirationMediaDraft(scope, initial.id, 1, 'inspiration-1')).toBe(false);
  expect((await loadInspirationDraft(scope, initial.id))?.text).toBe('Written while saving');
});
it('clears a confirmed draft once and prevents an old tab from reviving it', async () => {
  const initial = { ...newInspirationDraft('Kept'), revision: 1, media: [{ id: 'image', type: 'image' as const, name: 'Photo.png', blob: new Blob(['private bytes']) }] };
  await writeInspirationDraft(scope, initial, 0);
  expect(await settleInspirationMediaDraft(scope, initial.id, 1, 'saved-id')).toBe(true);
  expect(await loadInspirationDraft(scope, initial.id)).toBeNull();
  await expect(writeInspirationDraft(scope, { ...initial, revision: 2 }, 1)).rejects.toBeInstanceOf(InspirationDraftConflict);
  expect(await settleInspirationMediaDraft(scope, initial.id, 1, 'saved-id')).toBe(true);
});
it('settling one draft leaves a different draft untouched', async () => {
  const first = { ...newInspirationDraft('First'), revision: 1 }, second = { ...newInspirationDraft('Second'), revision: 1 };
  await writeInspirationDraft(scope, first, 0); await writeInspirationDraft(scope, second, 0);
  await settleInspirationMediaDraft(scope, first.id, 1, 'saved-id');
  expect((await loadInspirationDraft(scope, second.id))?.text).toBe('Second');
});
it('an empty later draft does not hide recoverable material in a new tab', async () => {
  const material = { ...newInspirationDraft('Still unfinished'), revision: 1, updatedAt: 100 };
  const empty = { ...newInspirationDraft(), revision: 1, updatedAt: 200 };
  await writeInspirationDraft(scope, material, 0); await writeInspirationDraft(scope, empty, 0);
  expect((await loadInspirationDraft(scope))?.id).toBe(material.id);
  expect((await loadInspirationDraft(scope, empty.id))?.id).toBe(empty.id);
});
it('recovers both the old clip and an unchosen replacement without leaking either to another owner', async () => {
  const old = { id: 'old', type: 'audio' as const, name: 'Old.webm', blob: new Blob(['old bytes']) };
  const candidate = { id: 'new', type: 'audio' as const, name: 'New.webm', blob: new Blob(['new bytes']) };
  const first = { ...newInspirationDraft(), revision: 1, media: [old] };
  await writeInspirationDraft(scope, first, 0);
  await writeInspirationDraft(scope, { ...first, revision: 2, recordingCandidate: candidate }, 1);
  expect(await settleInspirationMediaDraft(scope, first.id, 1, 'previous-save')).toBe(false);
  const restored = await loadInspirationDraft(scope, first.id);
  expect(await restored?.media[0]?.blob?.text()).toBe('old bytes');
  expect(await restored?.recordingCandidate?.blob?.text()).toBe('new bytes');
  expect(await loadInspirationDraft({ accountId: 'other', profileId: 'other' }, first.id)).toBeNull();
});
