/**
 * ═══ A NOTE'S TOOLS, RENDERED INTO THE BAR ══════════════════════════════
 *
 * Founder, of an opened saved inspiration: "the bottom bar should also
 * change." And, three times, of the corner these used to float in: "I don't
 * like this thing on the left", "this double layer is so weird", and then a
 * screenshot of the pair standing beside the dock, read as a duplicate.
 *
 * It was a duplicate, of the kind two copies of one layout always eventually
 * produce. The notepad's record-and-photo pair moved into the dock's middle
 * slot in an earlier pass; the archive's opened note, being a second
 * implementation of the same page, kept its own pair in the corner the first
 * one had vacated. Two bars at the bottom of one screen, and the second one
 * had two buttons in it.
 *
 * ── WHY A PORTAL, AND NOT PROPS ──────────────────────────────────────────
 *
 * The dock is rendered by `Home`; the upload queue, the recorder and the
 * open row all belong to `SavesOverlay`. Lifting them would put a second
 * copy of "which note is open" in the world — the exact duplicate-state
 * problem this pass is removing — and passing callbacks UP through a state
 * setter re-renders the whole world on every keystroke of a draft.
 *
 * So the bar lends a slot and the overlay fills it. Ownership does not move;
 * only the DOM does, which is what portals are for. `Home` renders an empty
 * `#waka-note-tools` in its middle slot whenever a saved note is open — it
 * learns that through one boolean — and this renders into it.
 *
 * ABSENT, NOT EMPTY, WHEN THERE IS NO SLOT. On a surface with no dock (a
 * narrow preview, a test mounting the overlay alone) the target does not
 * exist and this renders nothing rather than throwing. The note still reads
 * and still saves; it simply cannot take an attachment, which is honest —
 * there is nowhere to put the control.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AddMenu } from "./AddMenu";
import { HomeActionIcon } from "./HomeActionIcon";
import { LiveWord } from "./LiveWord";
import { clockWords } from "../lib/words";
import { supportedRecordingType, type useAudioRecording } from "../lib/use-audio-recording";
import { useDockMenu } from "../lib/use-dock-menu";

/** The id `Home` gives the dock slot this renders into. */
export const DOCK_SLOT = "waka-note-tools";
export const NOTE_ACTIONS_SLOT = "waka-note-actions";

export function NoteTools(props: {
  attaching: boolean;
  saving: boolean;
  recording: ReturnType<typeof useAudioRecording>;
  /** Record cannot start: another recorder on the page is running. */
  recordDisabled?: boolean;
  /** Delete cannot be pressed: a clip is still on its way to this note. */
  eraseDisabled?: boolean;
  /** Said in the bar when a write or the recorder failed, in the reader's
      language; empty is the success state. */
  failed: string;
  uploading: string;
  status?: string;
  /** THE NOTE'S FULL TEXT IS STILL BEING READ. A saved note is opened from a
      list row that carries only a 220-character preview, so the words are
      read in full before they can be edited (see `stored` in
      `SavesOverlay`). Empty once they are here, and on the notepad. */
  reading?: string;
  /** The full-text read failed: the note stays read-only and this says so,
      with Try again beside it. Empty is "nothing failed". */
  readFailed?: string;
  retryLabel?: string;
  onRetry?: () => void;
  /** The header menu keeps secondary actions away from Save on every screen. */
  moreLabel?: string;
  recordLabel: string;
  stopLabel: string;
  /** Announced once when a recording starts; the clock itself is not read out. */
  recordingLabel: string;
  /** The ＋'s name, and its two rows: "Add photo" and "Add file". */
  addLabel: string;
  photoLabel: string;
  fileLabel: string;
  /** Named for the act, not the page: it is the notepad's word, on purpose. */
  keepLabel: string;
  saveLabel?: string;
  /**
   * `canKeep(state)` FROM `lib/keep-ready.ts`, AND NOTHING ELSE.
   *
   * This prop said "whether the words on the note differ from the ones that
   * are stored" and was filled by a four-term expression `SavesOverlay` wrote
   * by hand — so one identifier, `canKeep`, meant the rule's enablement
   * predicate in one file and a dirty check in another, on one control. Both
   * callers ask the one function now. Named for it on purpose: the name was
   * already right, it was the meaning behind it that was missing.
   *
   * WHY THIS IS A BOOLEAN AND NOT A `KeepReadiness`. Letting the bar build
   * its own answer would be the tidier type and the wrong seam — the notepad
   * does not render this component (`Home` draws its own dock) and the press
   * has to re-ask with fresher fields at one of the two sites. The field list
   * stays with the page that knows its own state; what travels is the rule's
   * verdict. See `keepState` in `SavesOverlay` for which inputs a saved note
   * answers differently, each with its argument written beside it.
   */
  canKeep: boolean;
  onKeep: () => void;
  /** A saved note offers Delete in its header menu; a new note offers Discard. */
  eraseLabel: string;
  /* `erasing` WENT: delete is one press with an Undo now, so there is no
     armed state to report, and what it carried was always `saving`. */
  onErase: () => void;
  /** AN ARCHIVE WITH NO SHELF ASKS FIRST. An agent's archive keeps no
      deleted copies, so there the first press arms and the question sits in
      the bar's state slot; the caller clears it whenever the note changes. */
  eraseQuestion?: string;
  eraseConfirmLabel?: string;
  cancelEraseLabel?: string;
  erasePending?: boolean;
  onCancelErase?: () => void;
  /** Share this note as an image. Absent on the notepad: a note that was
      never kept has nothing yet to show anyone. */
  shareLabel?: string;
  onShare?: () => void;
  /** A chosen photo, OR a finished recording — `SavesOverlay` hands the same
      callback to the recorder, so one destination takes both kinds. That is
      why this component does not sniff the bytes before calling it even
      though its own picker offers `PHOTO_ACCEPT`: a check that refused
      everything the photo rule does not name would refuse the overlay's own
      `audio/webm` clip. Whoever owns the destination owns the check, and
      `SavesOverlay`'s `attach` is the one place that knows which of the two
      arrived. (As of this writing that function still classifies what it
      stored from `file.type` and never calls `inspectInspirationPhoto` —
      `Home`'s `attachTo`, the same shape, was fixed; this one is reported
      rather than edited because the file is under other hands.) */
  onFile: (file: File, door: "photo" | "file") => void;
}): JSX.Element | null {
  /* THE SLOT IS FOUND AFTER THE FIRST PAINT, NOT DURING RENDER. `Home`
     mounts it in the same commit this component first renders in, and the
     order of two siblings' effects is not something to rely on — so the
     target is read in an effect and kept in state, which re-renders once
     with it. A `querySelector` during render would be a one-frame miss on
     the first open and a correct result on every subsequent one, which is
     the worst kind of bug to find. */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(DOCK_SLOT)); setActionsSlot(document.getElementById(NOTE_ACTIONS_SLOT)); });
  /* AN ARMED DELETE TAKES FOCUS TO ITS CONFIRMATION. The press that armed
     it is gone from the bar (the group becomes the question), so focus
     would otherwise fall to the page; "Delete it anyway" is what a keyboard
     user is being asked about. */
  const confirm = useRef<HTMLButtonElement>(null);
  const armed = Boolean(props.erasePending && props.eraseQuestion);
  useEffect(() => { if (armed) confirm.current?.focus(); }, [armed, slot]);
  if (!slot) return null;

  /* THE WAY OUT OF A NOTE IS ALWAYS IN THE BAR. Delete needs only the
     note's id, so it is offered in every state below — loading and failed
     included (review, 2026-10-17: hiding it there left a note that would not
     open with no way to remove it). */
  const menu = <MoreMenu label={props.moreLabel ?? "More"} disabled={props.saving}
    rows={[
      ...(props.onShare && props.shareLabel ? [{ label: props.shareLabel, icon: "share" as const, act: props.onShare }] : []),
      { label: props.eraseLabel, icon: "erase" as const, act: props.onErase, disabled: props.eraseDisabled },
    ]} />;
  const actions = actionsSlot ? createPortal(menu, actionsSlot) : menu;
  /* ═══ AN ARMED DELETE IS THE WHOLE BAR FOR ITS MOMENT ═════════════════
     On an archive with no deleted shelf the first press asks. The question,
     the confirming press and "Not now" are the only three things in the
     group until it is answered: with the tools beside it the question was
     squeezed to ~15px on a 320px phone and "Not now" — a link inside the
     ellipsizing line — was clipped away (review, 2026-10-17). "Not now" is
     a real dock item with the 44px floor, outside the status line. */
  /* THE CLOCK THAT STOPS A RECORDING — one control, used in the row and,
     while a recording runs, kept beside an armed delete too, so the way to
     stop the microphone never leaves the bar (review, 2026-10-17). */
  /* STOP STANDS WHERE THE MICROPHONE WAS (audit f2afcbe2): a wide
     clock-button re-laid the centred bar under the pointer. So Stop is the
     microphone's own icon seat, lit while live, and the clock — words,
     because a red dot cannot say how long you have been talking — rides in
     a state line beside it: for eyes (aria-hidden), with "Recording"
     announced once (`LiveWord`). */
  const stopClock = props.recording.phase !== "idle" ? (
    <>
      <button type="button" className="waka-dock-tool waka-dock-tool--live"
        aria-label={props.stopLabel}
        disabled={props.recording.phase === "finishing"}
        onClick={() => void props.recording.stop()}><HomeActionIcon kind="stop" /></button>
      <span className="waka-dock-state">
        <LiveWord text={props.recordingLabel} />
        <span aria-hidden="true">{clockWords(props.recording.seconds)}</span>
      </span>
    </>
  ) : null;
  if (props.erasePending && props.eraseQuestion) {
    return createPortal(
      <>
        <span className="waka-dock-state" role="status">{props.eraseQuestion}</span>
        {stopClock}
        <button ref={confirm} type="button" className="waka-dock-tool waka-dock-tool--erase"
          aria-label={props.eraseConfirmLabel ?? props.eraseLabel}
          disabled={props.saving || props.eraseDisabled}
          onClick={props.onErase}><HomeActionIcon kind="erase" /></button>
        <button type="button" className="waka-dock-item waka-dock-retry" onClick={props.onCancelErase}>
          {props.cancelEraseLabel}
        </button>
      </>,
      slot,
    );
  }

  /* ═══ UNTIL THE NOTE IS READ, THE BAR SAYS THAT — AND KEEPS ITS EXITS ═══
     While the full text is on its way, or after it failed, the making tools
     have nothing to act on: Save cannot write what has not been read, and a
     photo aimed at a page that may never open is the wrong press to offer.
     So the group is one short line of state, Try again when the read failed,
     and Delete.

     TRY AGAIN IS ITS OWN CONTROL, NOT A LINK INSIDE THE SENTENCE. Inside the
     state span (which ellipsizes) it was clipped off-screen at every width,
     and inside `role="alert"` it was read out as part of the error. The
     alert holds the sentence only; the press is a dock item with the 44px
     floor beside it. */
  if (props.reading || props.readFailed) {
    return createPortal(
      <>
        {props.readFailed ? (
          <span className="waka-dock-state" role="alert">{props.readFailed}</span>
        ) : (
          <span className="waka-dock-state" role="status">{props.reading}</span>
        )}
        {/* AN EARLIER FAILURE IS STILL NEWS. A save, an upload or a recording
            that failed before this read began (Try again re-enters this
            state) keeps its line here rather than vanishing with the tools. */}
        {props.failed ? (
          <span className="waka-dock-state" role="alert">{props.failed}</span>
        ) : null}
        {/* a recording started on another note can still be running into
            this one's loading: its Stop never leaves the bar */}
        {stopClock}
        {props.readFailed && props.onRetry && props.retryLabel ? (
          <button type="button" className="waka-dock-item waka-dock-retry" onClick={props.onRetry}>
            {props.retryLabel}
          </button>
        ) : null}
        {actions}
      </>,
      slot,
    );
  }
  const busy = props.attaching || props.saving;
  return createPortal(
    <>
      {supportedRecordingType() ? (
        props.recording.phase === "idle" ? (
          <button type="button" className="waka-dock-tool" disabled={busy || props.recordDisabled}
            aria-label={props.recordLabel}
            onClick={() => void props.recording.start()}><HomeActionIcon kind="record" /></button>
        ) : (
          /* The same Stop and clock the other states keep (above). */
          stopClock
        )
      ) : null}
      {/* ═══ THE PHOTO BECAME ＋, HERE AS ON THE NOTEPAD (2026-10-16) ═════
          Founder: "the bar's PHOTO icon becomes ＋ … two rows: 'Add photo'
          and 'Add file'" — on a new note and on a saved one open in the
          archive, because the two are one page.

          WHAT THE CHOOSER MAY OFFER IS STILL THE RULES' OWN BUSINESS, quoted
          inside `AddMenu` from where each rule lives. And it is still only
          the door: the lock is `inspectInspirationPhoto` for a photo and
          `inspectAttachmentFile` for a file, and on THIS path both belong to
          the overlay's `attach`, not to this component, because the same
          `onFile` also carries the recorder's audio. One at a time: `attach`
          lands each file on the row before the next is chosen. */}
      <AddMenu buttonClassName="waka-dock-tool"
        label={props.addLabel} photoLabel={props.photoLabel} fileLabel={props.fileLabel}
        disabled={busy || props.recording.phase !== "idle"}
        onPhotos={(picked) => { if (picked[0]) props.onFile(picked[0], "photo"); }}
        onFiles={(picked) => { if (picked[0]) props.onFile(picked[0], "file"); }} />
      {/* ═══ AND THE SAVE, IN THE SAME SEAT IT HAS ON THE NOTEPAD ═════════
          Founder: "this button should appear when I'm editing old
          inspirations as well. So when I'm looking at past saved
          inspirations, as soon as I start typing, then that save button
          should be enabled."

          THIRD IN THE ROW, BECAUSE THAT IS WHERE IT IS ON THE OTHER NOTE
          PAGE. The notepad's middle slot runs mic, photo, Save, state, and
          these two pages are supposed to be one page — founder: "when
          clicking on a saved inspiration, it should go to the same exact UI
          as when I'm creating a new inspiration ... make sure it's using the
          exact same component." A control that is third on one and second on
          the other is the same class of difference this whole file exists to
          close, and it is the kind that costs a press every time because the
          hand goes where it went last time.

          SAME CLASS, SO SAME DIM. `.waka-dock-tool--keep` carries the fill
          and the disabled treatment the founder specified — lower opacity,
          no outline — in one place, so the two pages cannot drift into two
          appearances of one control. See that rule for why the dim is an
          opacity and never a border.

          PRESENT EVEN WITH NOTHING TO SAVE, for the reason written at the
          notepad's copy: a control that appears has to be discovered twice,
          and the second discovery is "what summons it", which here is typing
          — the act you are doing while not looking at the bar.

          BUSY DOES NOT BLOCK IT, and that is deliberate rather than an
          omission. `busy` disables the mic and the camera because a second
          upload while one is in flight is a real conflict; a text write is
          not in that queue — `attach` says so explicitly, "the write is
          independent of the note's words".

          THE CONFLICTS THAT DO EXIST ARE THE RULE'S, not this component's.
          `canKeep` is `lib/keep-ready.ts`'s verdict — `saving` among its
          eight inputs, and a running recorder ahead of it in the order. That
          sentence used to read "the caller's own `canKeep` already folds in
          `saving`", which was a statement about a contract that did not
          exist: the prop was a hand-written dirty check and the claim was
          true of it only by luck. It is a contract now. */}
      <button type="button" className="waka-dock-tool waka-dock-tool--keep waka-dock-save"
        aria-label={props.keepLabel} disabled={!props.canKeep}
        onClick={props.onKeep}><HomeActionIcon kind="keep" /><span>{props.saveLabel ?? props.keepLabel}</span></button>
      {/* ═══ AND THE WAY TO UNDO KEEPING IT, IN THE SAME BAR ══════════════
          Founder: "let's just add delete icon next to the save icon."

          IT CAME FROM THE NOTE'S TRAILING SLOT, which is where it had been
          since the two note pages were merged — and that slot styled
          nothing, so this control measured 59x32 against a product floor of
          44 for an act, on the one destructive thing a note can do. The
          dock gives it the floor every other tool has, and puts the two
          halves of a destructive act in the place the founder already
          ruled states belong: "states should show and disappear in the
          bottom bar only."

          ONE PRESS, AND THE WAY BACK IS UNDO. Founder, 2026-10-15, of the
          "Delete this? Not now" question this used to open: "just delete
          when user clicks on this, but give option to undo it." The caller
          takes the note off the page at once and offers Undo where the list
          is; nothing is final until that moment passes, and even then the
          deleted shelf holds it for a month. A question before every delete
          was the cost of an act that could not be taken back, and it can
          now. */}
      {/* ═══ SHARE SITS BETWEEN KEEPING AND ERASING ══════════════════════
          Founder: "i also dont see option to share a specfici inspiration."
          The note is the one place a single inspiration is fully on screen,
          so it is where showing it to somebody starts — the same image the
          top of mind makes, from the same sheet. */}
      {/* ═══ ON A NARROW PHONE, SHARE AND DELETE FOLD INTO ONE ⋯ ═══════════
          Measured 2026-10-17: Back, five 44px tools, Close and two rules are
          319px, and a 320px phone's dock holds 296. Narrowing the tools to
          fit put every act under the 44px floor — beside a one-press
          Delete. So below 360px the two verbs ABOUT the note (as opposed to
          the three that make it) move into an overflow, and every control
          left in the row keeps the full target. Both copies are rendered and
          the stylesheet chooses (`.waka-dock-roomy` / `.waka-dock-more`), so
          the switch is a width, not a script. */}
      {actions}
      {/* ONE LINE, THE SAME SLOT THE NOTEPAD'S STATE USES. Founder: "states
          should show and disappear in the bottom bar only." */}
      {/* the recorder's own problem arrives inside `failed`, already said:
          `recording.error` is a catalogue key and this has no locale (dev,
          #443). An armed delete is its own branch above. */}
      {props.failed ? (
        <span className="waka-dock-state" role="alert">{props.failed}</span>
      ) : props.attaching ? (
        <span className="waka-dock-state" role="status">{props.uploading}</span>
      ) : props.status ? (
        <span className="waka-dock-state" role="status">{props.status}</span>
      ) : null}
    </>,
    slot,
  );
}

/**
 * THE OVERFLOW, for the verbs about a note on a phone too narrow to show
 * them at full size. The same pattern and the same classes as `AddMenu`'s
 * ＋ (a button, a lifted column of 44px rows, Escape and an outside press
 * close it), because it is the same kind of object in the same bar.
 */
function MoreMenu(props: {
  label: string;
  disabled?: boolean;
  rows: Array<{ label: string; icon: "share" | "erase"; act: () => void; disabled?: boolean }>;
}): JSX.Element {
  const menu = useDockMenu(props.disabled);
  return (
    <span ref={menu.wrap} className="jar-note-actions">
      <button {...menu.buttonProps} type="button" className="jar-note-actions-trigger" aria-label={props.label}
        disabled={props.disabled}>
        <HomeActionIcon kind="more" />
      </button>
      {menu.open ? (
        /* ANCHORED TO THE BUTTON'S RIGHT EDGE, not centred on it like the ＋'s:
           the ⋯ sits near the end of the row, and centring ran the menu off
           the right of the screen (`.waka-more-menu`). */
        <div {...menu.menuProps} className="waka-add-menu jar-draft-menu" aria-label={props.label}>
          {props.rows.map((row) => (
            <button key={row.icon} type="button" role="menuitem" className="waka-add-row" aria-label={row.label} disabled={row.disabled}
              /* FOCUS GOES BACK TO ⋯ FIRST, then the row acts: Share opens
                 its sheet from there, and Delete takes the note (and the ⋯)
                 away, after which the archive puts focus on its Undo line. */
              onClick={() => { menu.close(true); row.act(); }}>
              <HomeActionIcon kind={row.icon} /><span>{row.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
