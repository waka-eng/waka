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
    onText: vi.fn(), onFiles: vi.fn(), onRetryFile: vi.fn(), onChooseRecording: vi.fn(), onRemove: vi.fn(), onVisibility: vi.fn(), onPast: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(), onKeyDown: vi.fn(), onForkDraft: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<InspirationComposer {...props} />));
it('saves once without asking the user to choose reflection, and blocks an unresolved save',async()=>{
  props.text='A thought to come back to.';props.media=[];await mount();
  /* SAVE IS A CORNER NOW, NOT A FOOTER ROW. `.jar-composer-actions` held it
     beside an audience pair and an explanatory line; the founder's ruling on
     that block was "remove all", so what is left is one control in the
     bottom-right. The assertion that matters is unchanged and is the reason
     this line counts rather than selecting: there is exactly ONE thing on
     this page that commits a save. */
  const actions=host.querySelectorAll<HTMLButtonElement>('.jar-note-save');expect(actions).toHaveLength(1);
  /* NO ARGUMENT, WHERE THERE USED TO BE `false` (2026-10-10). `onSubmit`
     took a `reflect` boolean and this control only ever passed `false` — so
     the parameter went with the question sheet it was meant to open, which
     nothing could reach. Asserting the EXACT argument list rather than just
     the call count is what keeps that from silently coming back. */
  await act(async()=>actions[0].click());expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith();
  props.save.pending={} as NonNullable<typeof props.save.pending>;await mount();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.disabled).toBe(true);
});
/* ═══ THE HEADING ROW IS GONE, AND SO IS ITS SPARK ═══════════════════════
   Founder, with Notion's new page on screen: "notion style - just blank
   page", and then Apple Notes: "copy this apple note experience."

   What this used to protect — a title, a decorative spark icon, a Close — was
   a dialog announcing itself in a bar, which is the one thing a note page
   does not do. The half of the old assertion that still matters is the half
   about a person rather than about chrome: the field names itself to a screen
   reader, and opening the page puts the caret in it. */
it('opens straight into the words, under the moment and the way back',async()=>{
  await mount();
  expect(host.querySelector('h2')).toBeNull();
  const back=host.querySelector<HTMLButtonElement>('.jar-note-back')!;
  expect(back.getAttribute('aria-label')).toBe('Past inspirations');
  await act(async()=>back.click());
  expect(props.onPast).toHaveBeenCalledOnce();
  /* The one fact a blank page can state. Not asserted to an exact string —
     it is the clock — but it must be a real stamp rather than an empty node,
     which is what a missing `momentStamp` would leave behind. */
  expect(host.querySelector('.jar-note-when')?.textContent).toMatch(/\d{4}/);
  expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('Capture inspiration');
  expect(document.activeElement).toBe(host.querySelector('textarea'));
  expect(props.onSubmit).not.toHaveBeenCalled();
});
/* ═══ AND THE AUDIENCE WENT WITH THE CONCEPT BEHIND IT ═══════════════════
   Founder: "I told you we got rid of the concept for room so there shouldn't
   be only me and share with rooms."

   This test asserted the pair existed, its pressed state and its explanatory
   line. Inverted rather than deleted, because a control offering two
   destinations when the product has one is worse than clutter — it teaches a
   model that is no longer true — and a deleted test would let it drift back
   in unnoticed. `onVisibility` stays on the props: the world still decides
   what a save is, and this page is simply no longer where it is asked. */
it('offers no audience choice, because there is nowhere else for a save to go', async () => {
  props.text='A thought to come back to.';await mount();
  expect(host.querySelector('[aria-label="Who can read this"]')).toBeNull();
  expect(host.querySelector('#capture-audience')).toBeNull();
  expect(host.textContent).not.toContain('Only me');
  expect(host.textContent).not.toContain('Share with rooms');
  await act(async()=>host.querySelector<HTMLButtonElement>('.jar-note-save')!.click());
  expect(props.onVisibility).not.toHaveBeenCalled();
  expect(props.onSubmit).toHaveBeenCalledOnce();
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
  expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith();
  expect(props.onLinkText).not.toHaveBeenCalled();expect(props.onText).not.toHaveBeenCalled();
});
it('refuses unsafe link schemes without submitting or discarding the draft',async()=>{
  props.linkText='javascript:alert(1)';await mount();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!.click());
  expect(props.onSubmit).not.toHaveBeenCalled();expect(props.onLinkText).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[type=url]')!.validationMessage).toContain('HTTP or HTTPS');
});
