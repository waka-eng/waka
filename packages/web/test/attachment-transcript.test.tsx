// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` transport methods `fetchAttachmentTranscript`,
 * `correctAttachmentTranscript` and `retryAttachmentTranscript` supply API
 * outcomes. The shipped editor, polling cleanup and conflict decisions run. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttachmentTranscript } from '../src/components/AttachmentTranscript';
import { ApiError, correctAttachmentTranscript, fetchAttachmentTranscript, retryAttachmentTranscript, type ApiAttachmentTranscript } from '../src/lib/api';
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  correctAttachmentTranscript: vi.fn(), fetchAttachmentTranscript: vi.fn(), retryAttachmentTranscript: vi.fn(),
}));
let host: HTMLDivElement, root: Root, current: ApiAttachmentTranscript;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  current = { attachmentId: 'audio', inspirationId: 'source', profileId: 'owner', revision: '1', status: 'ready',
    transcript: 'Machine transcript', correction: null, effectiveText: 'Machine transcript', correctedAt: null, reason: null, canEdit: true, canRetry: false, retryAfter: null };
  vi.mocked(fetchAttachmentTranscript).mockImplementation(async () => ({ ...current }));
  vi.mocked(correctAttachmentTranscript).mockImplementation(async (_id, value) => {
    current = { ...current, correction: value.correction, effectiveText: value.correction ?? current.transcript, revision: String(Number(current.revision) + 1) }; return { ...current };
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const mount = () => act(async () => root.render(<AttachmentTranscript id="audio" />));
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!;
const click = (text: string) => act(async () => button(text).click());
async function write(value: string) {
  await act(async () => {
    const input = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('shows loading before the first response, not an early failure state', async () => {
  let resolve!: (value: ApiAttachmentTranscript) => void;
  vi.mocked(fetchAttachmentTranscript).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); expect(host.textContent).toContain('Loading transcript'); expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => resolve({ ...current })); expect(host.textContent).toContain('Machine transcript');
});
it('saves corrected wording separately and preserves the original under disclosure', async () => {
  await mount(); await click('Edit transcript'); await write('The words I meant'); await click('Save changes');
  expect(correctAttachmentTranscript).toHaveBeenCalledWith('audio', { revision: '1', correction: 'The words I meant' }, expect.any(AbortSignal));
  expect(host.textContent).toContain('Your wording'); expect(host.querySelector('details')?.textContent).toContain('Machine transcript');
  expect(host.querySelector('textarea')).toBeNull();
});
it('keeps a failed edit and requires an explicit choice before replacing newer wording', async () => {
  await mount(); await click('Edit transcript'); await write('My unsaved wording');
  vi.mocked(correctAttachmentTranscript).mockImplementationOnce(async () => {
    current = { ...current, revision: '2', correction: 'Other tab wording', effectiveText: 'Other tab wording' };
    throw new ApiError({ status: 409, message: 'Changed' });
  });
  await click('Save changes');
  expect(host.querySelector('textarea')?.value).toBe('My unsaved wording');
  expect(host.textContent).toContain('Other tab wording'); expect(correctAttachmentTranscript).toHaveBeenCalledTimes(1);
  await click('Use my edit');
  expect(vi.mocked(correctAttachmentTranscript).mock.calls[1]?.[1]).toEqual({ revision: '2', correction: 'My unsaved wording' });
});
it('retains input on a network failure and never automatically resends it', async () => {
  await mount(); await click('Edit transcript'); await write('Keep these words');
  vi.mocked(correctAttachmentTranscript).mockRejectedValueOnce(new Error('offline'));
  await click('Save changes');
  expect(host.querySelector('textarea')?.value).toBe('Keep these words');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t save');
  expect(correctAttachmentTranscript).toHaveBeenCalledOnce();
});
it('offers an explicit transcription retry without revealing provider error text', async () => {
  current = { ...current, status: 'failed', effectiveText: null, transcript: null, canRetry: true, reason: 'private provider failure' };
  vi.mocked(retryAttachmentTranscript).mockImplementation(async () => { current = { ...current, status: 'pending', canRetry: false }; return current; });
  await mount(); expect(host.textContent).not.toContain('private provider'); expect(retryAttachmentTranscript).not.toHaveBeenCalled();
  await click('Retry transcription'); expect(retryAttachmentTranscript).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Transcribing');
});
it('does not offer editing to a read-only viewer', async () => {
  current.canEdit = false; await mount(); expect(button('Edit transcript')).toBeUndefined();
});
it('can show an owned transcript in a read-only review without losing edits to card navigation',async()=>{
  current={...current,canRetry:true};
  await act(async()=>root.render(<AttachmentTranscript id="audio" readOnly/>));
  expect(host.textContent).toContain('Machine transcript');expect(button('Edit transcript')).toBeUndefined();expect(button('Retry transcription')).toBeUndefined();
  expect(correctAttachmentTranscript).not.toHaveBeenCalled();expect(retryAttachmentTranscript).not.toHaveBeenCalled();
});
it('bounds background checks and offers a read-only check without auto-retrying work', async () => {
  vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  current = { ...current, status: 'pending', effectiveText: null, transcript: null };
  await mount(); await act(async () => vi.advanceTimersByTimeAsync(90_000));
  expect(fetchAttachmentTranscript).toHaveBeenCalledTimes(20);
  expect(button('Check transcript')).toBeDefined(); expect(retryAttachmentTranscript).not.toHaveBeenCalled();
});
it('ignores a previous owner view response after that view is replaced', async () => {
  let finish!: (row: ApiAttachmentTranscript) => void;
  vi.mocked(fetchAttachmentTranscript).mockImplementation((id) => id === 'audio'
    ? new Promise(done => { finish = done; })
    : Promise.resolve({ ...current, attachmentId: id, effectiveText: 'New owner view' }));
  await mount();
  const oldSignal = vi.mocked(fetchAttachmentTranscript).mock.calls[0]?.[1];
  await act(async () => root.render(<AttachmentTranscript key="new-owner" id="other" />));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finish({ ...current }));
  expect(host.textContent).toContain('New owner view'); expect(host.textContent).not.toContain('Machine transcript');
});
