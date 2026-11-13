// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. No module is replaced; the
 * notice is handed a plain object shaped like `useAuthoredSave`'s result,
 * because the question under test is the notice's own: what it asks, and
 * when that question goes away. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AuthoredSaveNotice } from '../src/components/AuthoredSaveNotice';

type Save = Parameters<typeof AuthoredSaveNotice>[0]['save'];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const save = (phase: string, resetInvalid = vi.fn()) => ({ phase, pending: null, busy: false, resetInvalid, retry: vi.fn(), dismiss: vi.fn(), editRejected: vi.fn() }) as unknown as Save;
const button = (text: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === text);

/* NEVER window.confirm: Start again asks in place, and only resets on the
   second, deliberate press. */
it('asks in place before starting again, and Cancel leaves the draft alone', async () => {
  const reset = vi.fn();
  await act(async () => root.render(<AuthoredSaveNotice save={save('invalid', reset)} locale="en-US" />));
  await act(async () => button('Start again')!.click());
  expect(host.textContent).toContain('Check what you saved first');
  await act(async () => button('Cancel')!.click());
  expect(reset).not.toHaveBeenCalled();
  await act(async () => button('Start again')!.click());
  await act(async () => button('Start again')!.click());
  expect(reset).toHaveBeenCalledOnce();
});

/* CODE REVIEW, 2026-11-09: the question outlived the state it was about. */
it('puts the question away when the save moves on to another state', async () => {
  const reset = vi.fn();
  await act(async () => root.render(<AuthoredSaveNotice save={save('invalid', reset)} locale="en-US" />));
  await act(async () => button('Start again')!.click());
  await act(async () => root.render(<AuthoredSaveNotice save={save('saving', reset)} locale="en-US" />));
  await act(async () => root.render(<AuthoredSaveNotice save={save('invalid', reset)} locale="en-US" />));
  expect(host.textContent, 'an old question came back with a new failure').not.toContain('Check what you saved first');
  expect(button('Cancel')).toBeUndefined();
});
