// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `indexedDB` uses `fake-indexeddb`
 * for durable transactions in Node; `Blob` uses Node's cloneable bytes. The
 * shipped React hook, storage queue, CAS and settlement all run unchanged. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Blob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInspirationDraft } from '../src/lib/use-inspiration-draft';
import { loadInspirationDraft, writeInspirationDraft } from '../src/lib/inspiration-draft-store';

const scope = { accountId: 'draft-owner', profileId: 'draft-profile' };
let hook: ReturnType<typeof useInspirationDraft>, root: Root, host: HTMLDivElement;
function Harness() { hook = useInspirationDraft(scope); return null; }
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('Blob', Blob);
  localStorage.clear(); sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await vi.waitFor(async () => { await act(async () => undefined); expect(hook.ready).toBe(true); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('serializes rapid text/media edits and settles only after durable storage', async () => {
  await act(async () => {
    hook.setText('First'); hook.setText('Second');
    hook.setMedia([{ id: 'audio', type: 'audio', name: 'Recording.webm', blob: new Blob(['audio bytes']) }]);
    await hook.flush();
  });
  const saved = { id: hook.draft.id, revision: hook.draft.revision };
  expect((await loadInspirationDraft(scope, saved.id))?.text).toBe('Second');
  expect(await (await loadInspirationDraft(scope, saved.id))?.media[0]?.blob?.text()).toBe('audio bytes');
  await act(async () => hook.settle(saved, 'inspiration'));
  expect(await loadInspirationDraft(scope, saved.id)).toBeNull();
  expect(hook.draft.text).toBe(''); expect(hook.draft.media).toEqual([]);
});

it('a late successful save leaves newer edits in the open draft', async () => {
  await act(async () => { hook.setText('Submitted'); await hook.flush(); });
  const saved = { id: hook.draft.id, revision: hook.draft.revision };
  await act(async () => { hook.setText('New thought'); await hook.settle(saved, 'inspiration'); });
  expect(hook.draft.text).toBe('New thought');
  expect((await loadInspirationDraft(scope, saved.id))?.text).toBe('New thought');
});

it('offers a separate draft after a competing tab wins without overwriting it', async () => {
  await act(async () => { hook.setText('Shared start'); await hook.flush(); });
  const original = hook.draft;
  await writeInspirationDraft(scope, { ...original, revision: original.revision + 1, text: 'Other tab' }, original.revision);
  await act(async () => {
    hook.setText('My new words');
    await expect(hook.flush()).rejects.toThrow('another tab');
  });
  expect(hook.draft.text).toBe('My new words');
  await act(async () => hook.fork());
  expect(hook.draft.id).not.toBe(original.id); expect(hook.error).toBe('');
  expect((await loadInspirationDraft(scope, original.id))?.text).toBe('Other tab');
  expect((await loadInspirationDraft(scope, hook.draft.id))?.text).toBe('My new words');
});
