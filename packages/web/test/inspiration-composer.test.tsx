// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `URL` supplies `URL.createObjectURL` and
 * `URL.revokeObjectURL` for jsdom's missing blob transport. Hook results
 * are passed as props; the composer, event handling and controls run unchanged. */
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InspirationComposer } from '../src/components/InspirationComposer';

let host: HTMLDivElement, root: Root, props: ComponentProps<typeof InspirationComposer>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:photo'; } static revokeObjectURL() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { text: '', linkText:'',onLinkText:vi.fn(),media: [{ id: 'photo', type: 'image', name: 'Photo.heic', blob: new Blob(['photo'], {type:'image/heic'}), uploadError: 'Upload didn’t finish.' }],
    locale: 'en-US', public: false, ready: true, fileDraftsAvailable: true, busy: false, error: '', uploadingId: null, inputRef: null,
    save: { phase: 'idle', pending: null, busy: false, start: vi.fn(), retry: vi.fn(), check: vi.fn(), dismiss: vi.fn(), resetInvalid: vi.fn(), editRejected: vi.fn() },
    recording: { phase: 'idle', seconds: 0, error: '', notice: '', start: vi.fn(), stop: vi.fn(), cancel: vi.fn() },
    onText: vi.fn(), onFiles: vi.fn(), onRetryFile: vi.fn(), onChooseRecording: vi.fn(), onRemove: vi.fn(), onVisibility: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(), onKeyDown: vi.fn(), onForkDraft: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<InspirationComposer {...props} />));
it('saves once without asking the user to choose reflection, and blocks an unresolved save',async()=>{
  props.text='A thought to come back to.';props.media=[];await mount();
  const actions=host.querySelectorAll<HTMLButtonElement>('.jar-composer-actions button');expect(actions).toHaveLength(1);
  await act(async()=>actions[0].click());expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(false);
  props.save.pending={} as NonNullable<typeof props.save.pending>;await mount();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(true);
});
it('opens with a decorative spark without changing focus, the action name or save semantics',async()=>{
  await mount();
  const heading=host.querySelector('h2')!;
  expect(heading.textContent).toBe('Capture inspiration');
  expect(heading.querySelector('[data-home-action-icon="capture"]')).not.toBeNull();
  expect(heading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(heading.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('Capture inspiration');
  expect(document.activeElement).toBe(host.querySelector('textarea'));
  expect(props.onSubmit).not.toHaveBeenCalled();
});
it('describes the selected audience visibly and accessibly without publishing on selection', async () => {
  await mount();
  const group=host.querySelector('[aria-label="Who can read this"]')!;
  expect([...group.querySelectorAll('button')].map(row=>row.textContent)).toEqual(['Only me','Share with rooms']);
  expect(group.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  expect(group.getAttribute('aria-describedby')).toBe('capture-audience');
  expect(host.querySelector('#capture-audience')?.textContent).toContain('Only you');
  props.public=true;await mount();
  expect(host.querySelector('#capture-audience')?.textContent).toContain('People in your rooms');
  expect(host.querySelector('#capture-audience')?.textContent).toContain('Reflections stay private');
  expect(props.onSubmit).not.toHaveBeenCalled();
});
it('keeps an unsupported browser preview saveable and gives the failed file its own retry', async () => {
  await mount();
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('original can still be saved'); expect(host.textContent).toContain('1 KB');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Retry upload for Photo.heic"]')!.click());
  expect(props.onRetryFile).toHaveBeenCalledWith('photo'); expect(props.onSubmit).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(false);
});
it('disables remove and retry during upload and distinguishes upload from final save', async () => {
  props.busy = true; props.uploadingId = 'photo'; await mount();
  expect(host.textContent).toContain('Uploading file 1 of 1');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="remove Photo.heic"]')!.disabled).toBe(true);
  expect(host.querySelector('[aria-label="Retry upload for Photo.heic"]')).toBeNull();
});
it('routes pasted and dropped files through the same validation callback, never during an upload', async () => {
  await mount(); const file = new File(['bytes'], 'photo.png', {type:'image/png'});
  const paste = () => { const event = new Event('paste', {bubbles:true,cancelable:true}); Object.defineProperty(event,'clipboardData',{value:{files:[file]}}); host.querySelector('textarea')!.dispatchEvent(event); };
  const drop = () => { const event = new Event('drop', {bubbles:true,cancelable:true}); Object.defineProperty(event,'dataTransfer',{value:{files:[file]}}); host.querySelector('[role="dialog"]')!.dispatchEvent(event); };
  await act(async () => { paste(); drop(); }); expect(props.onFiles).toHaveBeenCalledTimes(2);
  expect(props.onFiles).toHaveBeenCalledWith([file]);
  props.busy = true; await mount(); await act(async () => { paste(); drop(); }); expect(props.onFiles).toHaveBeenCalledTimes(2);
});
it('retains invalid/extra selections with removal controls and blocks saving until resolved', async () => {
  props.media = Array.from({length:6}, (_, index) => ({id:String(index), type:'image', name:`Photo ${index}.png`,
    blob:new Blob(['photo']), ...(index === 5 ? {validationError:'This photo is over 25 MB.'} : {})}));
  await mount(); expect(host.textContent).toContain('selections are still here');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="remove Photo 5.png"]')!.click());
  expect(props.onRemove).toHaveBeenCalledWith('5');
  props.media = props.media.slice(0,5); await mount();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(false);
});
it('restores the separate link draft and includes it through the single Save action',async()=>{
  props.text='My note';props.linkText='https://example.test/unfinished';await mount();
  expect(host.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(props.linkText);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(false);
  expect(host.textContent).toContain('This link will be included when you save.');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.click());
  expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(false);
  expect(props.onLinkText).not.toHaveBeenCalled();expect(props.onText).not.toHaveBeenCalled();
});
it('refuses unsafe link schemes without submitting or discarding the draft',async()=>{
  props.linkText='javascript:alert(1)';await mount();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.click());
  expect(props.onSubmit).not.toHaveBeenCalled();expect(props.onLinkText).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[type=url]')!.validationMessage).toContain('HTTP or HTTPS');
});
