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
/* THE ONE WAY THIS PAGE STILL COMMITS. Save is in the dock; Enter in the
   restored link field is what is left, and it runs the same `submit()` the
   button used to — including the link parse, which is why the two link cases
   below still belong to this file and not to `keep-ready`. */
const enterLink = () => host.querySelector<HTMLInputElement>('input[type=url]')!
  .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
/* ═══ THE PAGE DOES NOT COMMIT ANYTHING ANY MORE ═══════════════════════
   Founder: "the save button is very hard to see. Maybe the save button
   should be in the bottom bar as well. And then it should have save or save
   as draft."

   WHAT THIS CASE USED TO DO was press `.jar-note-save` and assert `onSubmit`
   was called with no arguments. The control is in the dock now, so pressing
   it here is impossible — and the two things it protected both survive
   somewhere better:

     THAT EXACTLY ONE THING COMMITS A SAVE is asserted below as zero on this
     page, which is the stronger form. A second Save growing back HERE is the
     regression; the dock's own is covered by `where-it-last-went`, which
     presses it end to end.

     THAT `onSubmit` TAKES NO ARGUMENTS — it once took a `reflect` boolean
     that only ever got `false` — is now held by the type and by the one
     remaining caller, the link field's Enter, asserted further down with
     `toHaveBeenCalledExactlyOnceWith()`.

   AND WHEN A SAVE IS BLOCKED is no longer a DOM question at all. It was
   written twice — here and in `keepIt` — and the two lists were never the
   same; `keep-ready.test.ts` enumerates the one list both now read. */
it('commits nothing itself, because keeping it is the bar\'s job',async()=>{
  props.text='A thought to come back to.';props.media=[];await mount();
  expect(host.querySelectorAll('.jar-note-save')).toHaveLength(0);
  expect(host.querySelector('[aria-label="Save inspiration"]')).toBeNull();
  expect(props.onSubmit).not.toHaveBeenCalled();
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
  /* THE WAY BACK SAYS WHERE IT GOES, in words, rather than carrying the
     destination in an `aria-label` that only a screen reader ever heard.
     Founder, with a screenshot of the boxed chevron this replaced: "why is
     this still here?" — it was the one back control in the product wearing
     a box and the one naming its destination invisibly. It is the same
     chevron-and-name the archive, the chats and an open note all use, and
     `worldBackToAll` is the archive's own words. */
  const back=host.querySelector<HTMLButtonElement>('.jar-note-back')!;
  /* THE NAME IS ON THE LABEL, NOT IN INK — which reverses what this line
     used to assert, and the reversal is the founder's: "remove the all
     inspirations thing here — actually, maybe just have a back button."
     Asserted BOTH ways round, because the thing that would be wrong is a
     chevron with no accessible name at all, and an empty-text assertion
     alone would pass for that. */
  expect(back.textContent?.trim()).toBe('');
  expect(back.getAttribute('aria-label')).toBe('All inspirations');
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
  /* NOTHING ON THIS PAGE ASKS, AND NOTHING ON IT COMMITS — the second half
     is new only because Save moved to the bar. `onVisibility` stays on the
     props because the world still decides what a save is. */
  expect(props.onVisibility).not.toHaveBeenCalled();
  expect(props.onSubmit).not.toHaveBeenCalled();
});
/* ═══ A FILE THE BROWSER CANNOT DRAW IS STILL A FILE ═══════════════════
   A HEIC on a browser with no decoder for it. The old rows said so in a
   sentence — "This browser can't preview this photo. The original can still
   be saved." — beside a "1 KB".

   THE TILE SAYS IT BY STILL BEING THERE, with the filename in it. Founder,
   of the rows: "I think it's a little ugly how files are added today."
   A paragraph explaining that an absent thumbnail is not a failure is a
   paragraph about the product's own limitation; a named tile in the shelf
   with the other four is the fact itself. What must not happen is the file
   vanishing, which is what this now asserts. */
it('keeps an unsupported browser preview saveable and gives the failed file its own retry', async () => {
  await mount();
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelectorAll('.jar-tile')).toHaveLength(1);
  expect(host.querySelector('.jar-tile-name')?.textContent).toBe('Photo.heic');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Try uploading Photo.heic again"]')!.click());
  expect(props.onRetryFile).toHaveBeenCalledWith('photo'); expect(props.onSubmit).not.toHaveBeenCalled();
  /* THAT IT IS STILL SAVEABLE is the point of the case and is now asserted
     where the decision is made: a file the browser cannot PREVIEW carries no
     `validationError`, so `whyNotKept` returns null for it. See
     `keep-ready.test.ts`. A preview failure is this page's business; whether
     it blocks a save is not. */
});
/* ═══ WHICH FILE IS IN FLIGHT, SHOWN RATHER THAN COUNTED ═══════════════
   "Uploading file 1 of 1… Keep this window open." is gone. A person cannot
   act on which of three files is moving, and the instruction asked them not
   to do a thing they were not doing. The BAR says that an upload is
   happening (founder: "states should show and disappear in the bottom bar
   only"); the tile that is actually uploading marks itself, which is the
   same fact in the place it belongs.

   AND IT CANNOT BE REMOVED OR RETRIED MID-FLIGHT, which is the half of this
   case that is about data rather than about words. */
it('marks the file in flight and disables remove and retry during upload', async () => {
  props.busy = true; props.uploadingId = 'photo'; await mount();
  expect(host.querySelector('.jar-tile')!.className).toContain('jar-tile--busy');
  expect(host.textContent).not.toContain('Uploading file');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove Photo.heic"]')!.disabled).toBe(true);
  expect(host.querySelector('[aria-label="Try uploading Photo.heic again"]')).toBeNull();
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
  await mount();
  /* THE BLOCKING MOVED, THE RETAINING DID NOT. What this page owes somebody
     who picked six files is that all six are still here, each marked, each
     removable — losing a selection to a validation error would be the real
     harm. Whether Save is pressable while one is marked is `whyNotKept`'s
     answer and is enumerated in `keep-ready.test.ts`, and the sentence
     "Keep up to five attachments…" that used to appear here is on that
     control's `title` now rather than pushing the shelf down the page. */
  expect(host.querySelectorAll('.jar-shelf > .jar-tile')).toHaveLength(6);
  /* THE ONE THAT IS WRONG SAYS SO, and only that one. A shelf where every
     tile is outlined would be no information at all. */
  expect(host.querySelectorAll('.jar-tile--wrong')).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove Photo 5.png"]')!.click());
  expect(props.onRemove).toHaveBeenCalledWith('5');
});
it('restores the separate link draft and includes it through the single Save action',async()=>{
  props.text='My note';props.linkText='https://example.test/unfinished';await mount();
  expect(host.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(props.linkText);
  expect(host.textContent).toContain('This link will be included when you save.');
  /* THROUGH ENTER IN THE FIELD, which is the composer's one remaining way to
     commit now that Save is in the bar — and the only one that was ever
     reachable without lifting your hands off the keyboard. It is the same
     `submit()`, so what it protects is unchanged: ONE call, no arguments,
     and the link neither rewritten into the words nor cleared on the way. */
  await act(async()=>enterLink());
  expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith();
  expect(props.onLinkText).not.toHaveBeenCalled();expect(props.onText).not.toHaveBeenCalled();
});
it('refuses unsafe link schemes without submitting or discarding the draft',async()=>{
  props.linkText='javascript:alert(1)';await mount();
  await act(async()=>enterLink());
  expect(props.onSubmit).not.toHaveBeenCalled();expect(props.onLinkText).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[type=url]')!.validationMessage).toContain('HTTP or HTTPS');
});

/**
 * ═══ ONE OF EACH CORNER, AND ONLY ONE ══════════════════════════════════
 *
 * Founder, with a screenshot of the notepad showing the record-and-photo
 * pair at the TOP left and again at the bottom left: "where did mic and
 * image attachment buttons go?" — reading the top pair as the real one and
 * the bottom pair as a replacement.
 *
 * IT COULD NOT BE REPRODUCED. The pair was measured at 1280x860, 720x980,
 * 720x1959, 390x844, 360x980 and in a full-page capture: one pair every
 * time, bottom-left, exactly where the notepad's specification puts it. The
 * likeliest explanation is the screenshot itself — a stitched long capture
 * duplicates `position: fixed` elements, and 1959 is almost exactly twice
 * that window's 980.
 *
 * "Likeliest" is not "proven", which is why this exists rather than a
 * shrug. The specification is one pair in one corner; a second would be a
 * real defect and nothing in the tree asserted there was only one. Now
 * something does, and if it ever genuinely doubles this fails instead of
 * being reported by screenshot.
 */
it('renders exactly one of each corner, never two', async () => {
  props.text = ''; props.media = []; await mount();
  const count = (selector: string) => host.querySelectorAll(selector).length;
  expect(count('.jar-note-back'), 'the way back is doubled').toBe(1);
  expect(count('.jar-note-when'), 'the moment is doubled').toBe(1);
  /* AND THE ATTACH CORNER IS NOT HERE AT ALL ANY MORE. Record and photo
     moved into the dock's making-slot — founder, of this corner, "I don't
     like this thing on the left", and of the shape of the bottom of the
     screen, "this double layer is so weird". Two glyphs floating beside a
     bar are a second bar with two buttons in it. Asserted as ZERO rather
     than deleted, because the corner reappearing is the regression this
     case now exists to catch. */
  expect(count('.jar-note-tools'), 'the attach corner came back beside the bar').toBe(0);
});
