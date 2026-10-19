/**
 * ═══ THE NOTEPAD ══════════════════════════════════════════════════════════
 *
 * Founder, with Apple Notes open on a blank note: "copy this apple note
 * experience." The annotations on that screenshot are the whole specification:
 * a chevron top-left — "go back to list of past inspirations" — the moment the
 * note was begun printed in grey beside it, an empty page, and one floating
 * pill in the bottom-left corner holding "2 icons: 1. record 2. image".
 *
 * WHAT LEFT, AND WHY IT WAS NOT A TRIM. Founder on the block that used to sit
 * under the field — Photo, Link and Record as three outlined buttons, then the
 * audience pair, then Save, then a line explaining the audience: "remove all."
 *
 * Five controls stacked under a blank page is a form, and a form is the one
 * thing this surface must not be. Everything that survives is either a) the
 * words, or b) in a corner:
 *
 *   the way back, top-left, where a phone puts it
 *   when this note is, top-middle, because on an empty page that is the only
 *     fact that exists yet
 *   who may read it, top-right, where the reference keeps its "⋯"
 *   attaching, bottom-left, two glyphs in one pill
 *   keeping it, bottom-right, opposite the pill
 *
 * The middle of the screen is yours. Nothing is in it.
 *
 * LINK LOST ITS BUTTON AND NOT ITS SUPPORT. A url pasted into the words is
 * already read as one by `inspirationWithPendingLink`; the field below only
 * still renders for a draft that was restored carrying one, so nothing a
 * person already typed is stranded by a button going away.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { DialogSurface } from './DialogSurface';
import { HomeActionIcon } from './HomeActionIcon';
import { NotePage } from './NotePage';
import { AuthoredSaveNotice } from './AuthoredSaveNotice';
import {inspirationWithPendingLink} from '../lib/inspiration-input';
import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import { fileSizeWords } from '../lib/api/file-accept';
import { formatMessage, isMessageKey, t, type SupportedLocale } from '../lib/locales';
import { attachmentLabel } from '../lib/attachment-label';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import type { useAuthoredSave } from '../lib/use-authored-save';
import type { useAudioRecording } from '../lib/use-audio-recording';

/* `fileSize` WENT WITH THE ROWS. It printed "142 KB" under every
   attachment — a fact about storage rather than about the thing, and the
   limit it was implicitly warning about is enforced by `validationError`,
   which says so in words when it is actually reached. */
/**
 * ═══ ONE ATTACHMENT, AS A TILE ══════════════════════════════════════════
 *
 * Founder, with a recording and a screenshot stacked under a blank note:
 * "when a user drops an image, can we just show the image at the bottom as
 * a grid rather than like this? I think it's a little ugly how files are
 * added today."
 *
 * WHAT WAS UGLY, AND IT WAS NOT THE ARRANGEMENT. Each file was a full-width
 * ROW: a browser-chrome `<audio controls>` — a white pill with a play
 * triangle and a volume icon, the single brightest object on a dark page
 * whose whole argument is quiet — then the filename, then "34 KB · In this
 * draft — not saved yet.", then a bordered × in its own box. Four pieces of
 * furniture per file, three of which restate what the fourth already shows.
 *
 * A TILE SHOWS THE THING INSTEAD OF DESCRIBING IT. A photo is its own
 * label; nobody reads "Screenshot 2026-10-11 at 4.49.54 PM.png" to find out
 * which picture it is. A recording has no picture, so it gets the one fact
 * a picture cannot carry — how long it is — and plays on a press.
 *
 * WHAT WENT WITH THE ROWS:
 *
 *   THE FILE SIZE. "142 KB" is a fact about storage, not about the thing;
 *   the limit it was implicitly warning about is enforced by
 *   `validationError`, which says so in words when it is actually hit.
 *
 *   "IN THIS DRAFT — NOT SAVED YET." Printed under every attachment, on a
 *   page whose bar says "Save" and "Save as draft". It is Law 4 in minature:
 *   a sentence restating the state the whole surface is in.
 *
 *   THE BROWSER'S AUDIO PLAYER. Replaced by the tile itself — one press,
 *   play or pause, the same shape as every other tile.
 */
function MediaTile({
  item, name, disabled, recording, uploading, onRemove, onRetry,
  removeLabel, retryLabel, playLabel, pauseLabel, uploadFailedLabel, problemLabel,
}: {
  item: InspirationDraftMedia;
  /** What to call it: its own name, or "Photo" / "File" / "Recording" when
      it has none (`attachmentLabel`) — said here, never stored on `item`. */
  name: string;
  disabled: boolean;
  /** A running recorder pauses playback: two audio streams at once is noise. */
  recording: boolean;
  uploading: boolean;
  onRemove: () => void;
  onRetry: () => void;
  /* WHOLE SENTENCES, NOT A VERB AND A FILENAME CONCATENATED. The caller
     formats them, because joining `say('worldRetry')` to a name produces
     "Try again Photo.heic" in English and worse in Korean, where the verb
     goes last. These are the only two labels on this tile, and they are the
     only thing a screen reader has to tell three photos apart. */
  removeLabel: string;
  retryLabel: string;
  /* ═══ AND THE PRESS SAYS WHAT PRESSING DOES ════════════════════════════
     The reference's `Thumbnail` — its component for exactly this tile —
     makes its one rule about the name: "Always provide a `label` prop with
     the file name so the thumbnail AND ITS REMOVE BUTTON are accessible to
     screen readers and show a tooltip on hover." Ours named the remove
     button and left the tile itself anonymous, and named the audio tile
     with the bare filename — so a recording announced as "ambience.m4a,
     button" and a listener had to press it to find out it was a transport.
     Two labels, in the same whole-sentence shape as the two above and for
     the same reason: Korean puts the verb last. */
  playLabel: string;
  pauseLabel: string;
  /** What a failed upload says, already in the reader's language. */
  uploadFailedLabel: string;
  /** Why this file cannot be kept (`validationError`), already said in the
      reader's language; empty when nothing is wrong with it. */
  problemLabel: string;
}) {
  const [url, setUrl] = useState('');
  const [failedPreview, setFailedPreview] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (recording) { audio.current?.pause(); setPlaying(false); } }, [recording]);
  useEffect(() => {
    if (!item.blob) return;
    const value = URL.createObjectURL(item.blob);
    setUrl(value); setFailedPreview(false);
    return () => URL.revokeObjectURL(value);
  }, [item.blob]);

  /* THE ONE THING WRONG WITH IT, IF ANYTHING IS — in priority order, so a
     tile never carries two marks. A file the server refused and a file too
     large are both "this one needs attention"; which it is belongs in the
     tooltip, not in a second badge. */
  /* `uploadError` is a flag, said in the reader's language (see
     `lib/inspiration-media-upload`), never printed as stored. */
  const wrong = problemLabel || (item.uploadError ? uploadFailedLabel : '');
  const retryable = Boolean(item.uploadError) && !item.validationError && !uploading;
  const clock = seconds === null ? '' :
    `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

  return (
    /* THE NAME IS ON THE TILE, NOT PRINTED UNDER IT. The filename row was
       most of what made the old list a wall, and nobody reads
       "Screenshot 2026-10-11 at 4.49.54 PM.png" to find out which picture
       it is — but on the one occasion you DO want it, hovering is where
       the reference puts it. Nothing is shown until you ask. */
    <li className={`jar-tile${wrong ? ' jar-tile--wrong' : ''}${uploading ? ' jar-tile--busy' : ''}`}
      title={name}>
      {item.type === 'image' && url && !failedPreview ? (
        <img src={url} alt={name} onError={() => setFailedPreview(true)} />
      ) : item.type === 'audio' && url ? (
        <>
          {/* THE TILE IS THE PLAYER. No `controls`, so the browser draws
              nothing of its own — see the note above about the white pill. */}
          <audio ref={audio} src={url} preload="metadata" aria-hidden="true"
            onLoadedMetadata={event => {
              const length = event.currentTarget.duration;
              setSeconds(Number.isFinite(length) ? length : null);
            }}
            onEnded={() => setPlaying(false)} />
          <button type="button" className="jar-tile-face" disabled={recording}
            aria-label={playing ? pauseLabel : playLabel}
            onClick={() => {
              const node = audio.current;
              if (!node) return;
              if (node.paused) { void node.play(); setPlaying(true); }
              else { node.pause(); setPlaying(false); }
            }}>
            <HomeActionIcon kind={playing ? 'pause' : 'play'} />
            {clock ? <span className="jar-tile-clock">{clock}</span> : null}
          </button>
        </>
      ) : item.type === 'file' ? (
        /* ═══ A FILE IS ITS NAME AND ITS SIZE (2026-10-16) ════════════════
           Founder: a file shows "as a small tile (icon + name + size) where
           image thumbnails show". A PDF has no picture to stand in for it,
           so the tile says what it is — the page glyph, the name, and how
           big — which is the one place the size note above is overruled:
           for a photo the size was storage trivia; for a document it is
           the difference between a letter and a report. */
        <span className="jar-tile-face jar-tile-file">
          <HomeActionIcon kind="file" />
          <span className="jar-tile-file-name">{name}</span>
          {item.blob?.size ? <span className="jar-tile-clock">{fileSizeWords(item.blob.size)}</span> : null}
        </span>
      ) : item.type === 'link' && item.url ? (
        <a className="jar-tile-face jar-tile-link" href={item.url} target="_blank" rel="noreferrer">
          {name}
        </a>
      ) : (
        /* A FILE THIS BROWSER CANNOT DRAW — a HEIC on a browser with no
           decoder for it, most often. It still uploads and still saves, so
           the tile says what it is rather than disappearing. */
        <span className="jar-tile-face jar-tile-name">{name}</span>
      )}

      {retryable ? (
        <button type="button" className="jar-tile-retry" disabled={disabled}
          title={wrong} aria-label={retryLabel} onClick={onRetry}>↻</button>
      ) : null}
      <button type="button" className="jar-tile-x" disabled={disabled}
        title={wrong || undefined}
        aria-label={removeLabel} onClick={onRemove}>
        {/* the 28px corner you SEE; the button around it is the 44px press
            (see `.jar-tile-x` in chrome.css) */}
        <span className="jar-tile-x-face" aria-hidden="true">×</span>
      </button>
    </li>
  );
}

function MediaPreview({ item, recording = false, label }: { item: InspirationDraftMedia; recording?: boolean; label?: string }) {
  const [url, setUrl] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (recording) audio.current?.pause(); }, [recording]);
  useEffect(() => {
    if (!item.blob || item.validationError) return;
    const value = URL.createObjectURL(item.blob); setUrl(value); setImageFailed(false);
    return () => URL.revokeObjectURL(value);
  }, [item.blob, item.validationError]);
  if (item.validationError) return null;
  if (item.type === 'image' && url) return imageFailed
    ? <p className="jar-composer-storage-note">This browser can’t preview this photo. The original can still be saved.</p>
    : <img src={url} alt={item.name} onError={() => setImageFailed(true)} />;
  if (item.type === 'audio' && url) return <audio ref={audio} controls={!recording} src={url} preload="metadata" aria-label={label ?? item.name} />;
  return null;
}
export function InspirationComposer(props: {
  text: string; media: InspirationDraftMedia[]; locale: SupportedLocale;
  linkText: string; onLinkText: (value:string)=>void;
  ready: boolean; fileDraftsAvailable: boolean; busy: boolean; error: string; uploadingId: string | null;
  save: ReturnType<typeof useAuthoredSave>; recording: ReturnType<typeof useAudioRecording>;
  inputRef: Ref<HTMLTextAreaElement>;
  /** When the draft under this page was last touched, so a note restored
      tomorrow is not stamped with tomorrow. Absent for a blank one. */
  draftUpdatedMs?: number;
  recordingCandidate?: InspirationDraftMedia | null; onChooseRecording: (useNew: boolean) => void;
  onText: (text: string, caret: number) => void; onFiles: (files: File[]) => void;
  onRetryFile: (id: string) => void;
  onRemove: (id: string) => void;
  /* `onPast` IS GONE, AND IT WAS NEVER CALLED. It was the chevron's — "the
     archive this note is about to join" — and the chevron went three
     rounds of being made quieter before the founder removed it outright:
     "I still don't get why you have this carrot button when I do new
     inspiration, because I can just go to all the inspirations using the
     bottom panel." `NotePage` carries that whole argument.

     What survived the removal was the PROP: declared here, documented here,
     passed from `Home` with a three-line comment about a navigation race,
     stubbed in two suites — and reached by nothing. That is worse than dead
     code, because every part of it reads as live: a prop with a doc comment
     is a contract, and the next person to open this file would have gone
     looking for the control that honours it. The way out of this page is
     the dock, which `way-out.test.ts` is the gate for. */
  onClose: () => void; onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onForkDraft: () => void;
  /** True when the draft changed in another tab — the one state the "keep as
      a separate draft" button answers. A flag, not a match on the error's
      words: those are said in the reader's language, and Korean never
      contained "another tab". */
  draftConflict: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const [addingLink, setAddingLink] = useState(Boolean(props.linkText));
  /** Whether a file is being held over this page right now. See the drop
      note on the surface below for why the page has to answer. */
  const [overhead, setOverhead] = useState(false);
  const link = props.linkText;
  /* WHEN THIS NOTE IS, read once. Taking it from the draft's own `updatedAt`
     live would reprint the minute under somebody's hand on every keystroke,
     which is the world moving without them moving it. */
  const when = useRef<number | null>(null);
  if (when.current === null) when.current = (props.text.trim() && props.draftUpdatedMs) ? props.draftUpdatedMs : Date.now();
  useEffect(()=>{if (props.linkText) setAddingLink(true);},[props.linkText]);
  /* ═══ `blocked` IS A DISABLING CONDITION, NOT THE SAVE RULE ══════════
     It asks whether this page can take INPUT right now — a file, a typed
     url, a press on Cancel — and it is the right question for all three.
     It is not the save rule, and it used to be read as one: `Enter` in the
     link field below called `submit()` only `if (!blocked)`, which made
     this the THIRD hand-written copy of a condition `lib/keep-ready.ts`
     exists to state once. It disagreed with the other two in both
     directions: it has no idea whether a file is marked or whether the
     microphone is open, and it refuses a save during an upload the rule
     would also refuse but for reasons it words differently.

     THE GATE IS `keepIt`, which asks `whyNotKept` at the moment of the
     press and reads the draft store's current contents to do it. So the
     field hands the press up and lets the rule answer — and when the rule
     refuses, the bar says WHY, which the silent `if (!blocked)` could not.
     The check was also already redundant for most of what it covered: the
     input is `disabled={blocked}`, and a disabled input has no keydown to
     gate. */
  const blocked = props.busy || Boolean(props.save.pending) || !props.ready || props.recording.phase !== 'idle';
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  /* `invalidFiles` AND `empty` WENT WITH THE SAVE BUTTON. Both existed only
     to decide whether that button was there and whether it was pressable;
     the bar asks the same two questions now and asks them of the draft
     directly — `composerHasWords` and `composerCanKeep` in `Home.tsx`,
     which is also where `keepIt`'s own guards live, so there is one copy of
     each condition instead of two that can disagree. */
  const submit = () => {
    try {
      inspirationWithPendingLink(props.text,link);props.onSubmit();
    } catch {linkInput.current?.setCustomValidity(say('worldComposerInvalidLink'));linkInput.current?.reportValidity();}
  };
  useEffect(()=>{if(addingLink)linkInput.current?.focus();},[addingLink]);
  /* ═══ THE PAGE ANSWERS A FILE HELD OVER IT ════════════════════════════
     The reference's `FileInput` calls the drop target a required part of
     its anatomy — "Drop zone: Required: the clickable area for file selection;
     in dropzone mode, also accepts dragged files" — and spends a Don't on
     it: "Don't avoid dropzone mode unless space is constrained;
     drag-and-drop is the expected interaction for file uploads."

     This page already took drops and said nothing about it. Dragging a
     photo across it looked exactly like dragging a photo across a page
     that would reject it, and the only way to learn otherwise was to let
     go and see. A target that gives no sign is not a target.

     WHAT IT ANSWERS WITH IS LIGHT, because that is the only channel this
     product has: the whole page lifts one step while something is held
     over it. Not an outline, not a dashed rectangle, not "Drop files
     here" — the reference's own drop zone draws a box with an upload icon
     and a line of hint text in it, and all three are furniture on the one
     surface whose specification is that there is none. The page is the
     drop zone, so the page is what lights.

     AND IT ANSWERS ONLY WHEN IT WOULD ACCEPT. `blocked` is the same guard
     the drop itself uses, so a page mid-save does not promise to take a
     file it is about to refuse.

     `relatedTarget` IS WHY THIS IS NOT A COUNTER. `dragleave` fires every
     time the pointer crosses into a child — the textarea, a tile, the
     link field — so the naive version flickered off and on down the whole
     page. Leaving for somewhere still inside the surface is not leaving;
     dragging out of the WINDOW gives a null `relatedTarget`, which
     `contains` reports as outside, so that case still clears. */
  const overheadOff = () => setOverhead(false);
  return <DialogSurface className="jar-seek jar-inspiration-composer" motion="modal" aria-label={say('worldCaptureInspiration')} onClose={props.onClose} data-jar-chrome="1"
    data-dropping={overhead ? '1' : undefined}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setOverhead(!blocked);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) overheadOff(); }}
    onDragEnd={overheadOff}
    onDrop={event => { overheadOff(); if (event.dataTransfer.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.dataTransfer.files]); } }}>
    {/* ═══ THE TOP IS `NotePage`'S NOW, AND SO IS THE SAVED NOTE'S ═══════
        Founder: "make sure that when I'm entering from create new
        inspiration or my past inspiration, it's using the exact same
        component, and I'm liking the new inspiration component a lot more."

        The way back and the moment were written out here and again in
        `SavesOverlay`, and the two copies had drifted apart in every
        particular — see that component's header for the inventory. This
        page is the one the founder prefers, so it is this page's chrome
        that both now render.

        NO TRAILING VERB HERE. A note that does not exist yet cannot be
        deleted; the slot is for a verb ABOUT the note and a new one has
        none. */}
    <NotePage locale={props.locale} whenMs={when.current}>
    <div className="jar-composer-body">
    <textarea ref={props.inputRef} className="jar-mouth-field jar-composer-text" autoFocus rows={4} value={props.text} readOnly={props.busy || !props.ready || props.recording.phase !== 'idle'}
      aria-label={say('worldCaptureInspiration')} placeholder={say('worldCapturePrompt')}
      onChange={event => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={props.onKeyDown}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.clipboardData.files]); } }} />
    {/* THE ACCEPTED SET COMES FROM THE RULE, NOT FROM HERE. It was this
        string, typed out, in the third of four places that had their own
        copy — and the fourth copy (the memory card's picker in `Home.tsx`)
        said `image/*`, so one of the product's four pickers offered files
        the sniffer refuses. See `PHOTO_ACCEPT` for why the list belongs
        beside `inspectInspirationPhoto` and why the picker is the door
        rather than the lock. */}
    <input ref={fileInput} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={event => {
      const files = [...event.target.files ?? []]; if (files.length) props.onFiles(files); event.target.value = '';
    }} />
    {props.ready && !props.fileDraftsAvailable ? <p className="jar-composer-storage-note">{say('worldComposerFilesUnavailable')}</p> : null}
    {addingLink ? <div className="jar-composer-link">
      <input ref={linkInput} type="url" value={link} disabled={blocked} aria-label={say('worldPasteTheLink')} placeholder="https://" onChange={event => { event.target.setCustomValidity(''); props.onLinkText(event.target.value); }}
        onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&!event.repeat){event.preventDefault();event.stopPropagation();submit();}}} />
      <button type="button" disabled={blocked} onClick={()=>{props.onLinkText('');setAddingLink(false);}}>{say('worldComposerCancelLink')}</button>
    </div> : null}
    {link.trim() ? <p className="jar-composer-storage-note">{say('worldComposerLinkReady')}</p> : null}
    {/* ═══ THE SHELF ═══════════════════════════════════════════════════
        Founder: "when a user drops an image, can we just show the image at
        the bottom as a grid rather than like this?"

        A GRID, AND AT THE BOTTOM. Both halves were asked for and the second
        is the one with a reason beyond taste: attachments used to push the
        words down the page as they arrived, so dropping a third photo moved
        the sentence somebody was in the middle of writing. The shelf is
        pinned under the field now and the words never move.

        See `MediaTile` for what each tile shows and what the rows it
        replaces were saying that nothing needed to say.

        ═══ THE SHELF IS A GROUP, AND IT SAYS SO WHERE SAYING IT COSTS
        NOTHING ═══════════════════════════════════════════════════════
        The reference's `ChatComposerDrawer` is its pattern for a tray of
        attachments beside a writing field, and its first rule is about the
        name: "Give `label` a concrete plural noun such as 'Attachments' so
        the expand and collapse actions have a useful accessible name."
        Its `List` says the same thing from the other side — "List title:
        Required: Heading that labels the list", "provide a header to label
        the list and give context to screen readers".

        WE TOOK THE NOUN AND REFUSED THE HEADING. A visible "Attachments"
        over three visible attachments is Law 4 — a label restating what is
        already on screen — on the one page whose specification is that
        nothing is on it. So the plural noun is the list's accessible name
        and draws no pixels.

        AND WE REFUSED THE BADGE. The drawer's collapsed summary is "the
        default count Badge and label"; `Badge`'s own page forbids exactly
        that use — "Don't use badges for metadata. Durations, counts, dates
        and descriptions are not statuses or categories." It is coherent
        there because a COLLAPSED drawer has hidden its contents and the
        count stands in for them. This shelf never collapses, so a "3"
        beside three tiles counts something you are looking at.

        `role="list"` IS NOT REDUNDANT HERE. Safari drops list semantics
        from a `ul` with `list-style: none`, which this one has, so without
        it the group name above would be announced over three loose items
        rather than over a set of three. */}
    {props.media.length ? <ul className="jar-shelf" role="list"
      aria-label={say('worldComposerAttachments')}>{props.media.map(item => {
      const name = attachmentLabel(props.locale, item.type, item.name);
      return <MediaTile key={item.id} item={item} name={name} disabled={blocked}
        recording={props.recording.phase !== 'idle'}
        uploading={props.uploadingId === item.id}
        removeLabel={formatMessage(props.locale, 'worldComposerRemoveFile', { name })}
        retryLabel={formatMessage(props.locale, 'worldComposerRetryFile', { name })}
        playLabel={formatMessage(props.locale, 'worldComposerPlayFile', { name })}
        pauseLabel={formatMessage(props.locale, 'worldComposerPauseFile', { name })}
        uploadFailedLabel={say('worldComposerUploadFailed')}
        /* stored as a key; a draft from before that still holds a sentence */
        problemLabel={!item.validationError ? '' : isMessageKey(item.validationError) ? say(item.validationError) : item.validationError}
        onRemove={() => props.onRemove(item.id)}
        onRetry={() => props.onRetryFile(item.id)} />;
    })}</ul> : null}
    {/* ═══ AND THE TWO SENTENCES UNDER THE ROWS ARE IN THE BAR ══════════
        Founder: "states should show and disappear in the bottom bar only."

        "Keep up to five attachments…" was an alert that appeared the moment
        a sixth arrived and pushed the whole shelf down; it is
        `worldComposerTooManyFiles` on the bar's Save now, which is the
        control it actually blocks — see `keep-ready.ts`.

        "Uploading file 2 of 3… Keep this window open." lost its count on
        purpose. A person cannot act on which of three files is in flight,
        the instruction was asking them not to do something they were not
        doing, and the bar says `worldComposerUploading` while any of them
        is moving. The tile that is actually uploading dims, which is the
        same fact where it belongs. */}
    {props.recording.phase !== 'idle' && props.media.some(item => item.type === 'audio') ? <p className="jar-composer-storage-note">Your earlier recording stays until you choose.</p> : null}
    {props.recordingCandidate ? <section className="jar-recording-choice" aria-label="Choose a recording">
      <p>New recording</p><MediaPreview item={props.recordingCandidate} label="New recording" />
      <div className="jar-composer-actions"><button type="button" disabled={blocked} onClick={() => props.onChooseRecording(true)}>Use new recording</button>
        <button type="button" disabled={blocked} onClick={() => props.onChooseRecording(false)}>{props.media.some(item => item.type === 'audio') ? 'Keep previous recording' : 'Discard recording'}</button></div>
    </section> : null}
    {/* ═══ THE STATE LINES ARE IN THE BAR NOW ═══════════════════════════
        Founder, with "Recording canceled." printed across an empty note:
        "states should show and disappear in the bottom bar only."

        What stood here: the recorder's notice, the error, and "Opening…".
        Each appeared and vanished in the middle of the page somebody was
        writing on, pushing the words below it. See `composerState` in
        `Home.tsx`, which is where all three are now assembled and where the
        dock renders them.

        THE ONE THING THAT STAYS IS A CONTROL, not a state: the fork button
        below is the only way out of the one error that has an action, and a
        button cannot live in a status line. It renders only with that
        error, so it is absent from every normal note. */}
    {props.draftConflict ? <button type="button" onClick={props.onForkDraft}>{say('worldComposerSeparateDraft')}</button> : null}
    </div>
    </NotePage>
    {/* THE PILL IN THE BOTTOM-LEFT CORNER IS GONE, AND SO IS THE CORNER.
        Founder, twice, about that corner — "I don't like this thing on the
        left" — and about the shape of the bottom of the screen: "this
        double layer is so weird."

        Record and photo moved into the DOCK, into the slot the plus
        occupies when you are not already making something. The argument
        for them being here was the reference's own floating toolbar, and
        it was right while the dock did not exist; with a bar on screen,
        two glyphs floating beside it are a second bar with two buttons in
        it. The bar is the only object at the bottom of any screen again,
        and the middle of this page is emptier than it has ever been, which
        is this surface's whole specification.

        See the note at `waka-dock-making` in `Home.tsx` for why only this
        one slot transforms and the four places never move. */}
    {/* ═══ AND KEEPING IT IS IN THE BAR TOO ═════════════════════════════
        Founder: "the save button is very hard to see. Maybe the save button
        should be in the bottom bar as well. And then it should have save or
        save as draft."

        It was a pale pill in the bottom-right corner — the only control on
        the page, with nothing beside it to be read against. The dock renders
        both endings now; see the long note at `waka-dock-making` in
        `Home.tsx`. `onSubmit` is unchanged and is what that button calls, so
        Enter in the link field and the bar's Save are still one path.

        KEPT: "only once there is something to keep", which the bar also
        obeys through `composerHasWords`. */}
    <AuthoredSaveNotice save={props.save} locale={props.locale} />
  </DialogSurface>;
}
