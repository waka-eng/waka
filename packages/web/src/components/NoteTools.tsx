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

import { HomeActionIcon } from "./HomeActionIcon";
import { PHOTO_ACCEPT } from "../lib/inspiration-photo";
import { supportedRecordingType, type useAudioRecording } from "../lib/use-audio-recording";

/** The id `Home` gives the dock slot this renders into. */
export const DOCK_SLOT = "waka-note-tools";

export function NoteTools(props: {
  attaching: boolean;
  saving: boolean;
  recording: ReturnType<typeof useAudioRecording>;
  /** Said in the bar when a write failed; empty is the success state. */
  failed: string;
  uploading: string;
  recordLabel: string;
  stopLabel: string;
  photoLabel: string;
  /** Named for the act, not the page: it is the notepad's word, on purpose. */
  keepLabel: string;
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
  /** The trash beside Save. Founder: "let's just add delete icon next to the
      save icon." Absent on the notepad, because a note that was never kept
      has nothing to erase — see `one-dock-two-notes.test.tsx`'s ledger. */
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
  onFile: (file: File) => void;
}): JSX.Element | null {
  const file = useRef<HTMLInputElement>(null);
  /* THE SLOT IS FOUND AFTER THE FIRST PAINT, NOT DURING RENDER. `Home`
     mounts it in the same commit this component first renders in, and the
     order of two siblings' effects is not something to rely on — so the
     target is read in an effect and kept in state, which re-renders once
     with it. A `querySelector` during render would be a one-frame miss on
     the first open and a correct result on every subsequent one, which is
     the worst kind of bug to find. */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(DOCK_SLOT)); });
  if (!slot) return null;

  const busy = props.attaching || props.saving;
  return createPortal(
    <>
      {supportedRecordingType() ? (
        props.recording.phase === "idle" ? (
          <button type="button" className="waka-dock-tool" disabled={busy}
            aria-label={props.recordLabel}
            onClick={() => void props.recording.start()}><HomeActionIcon kind="record" /></button>
        ) : (
          /* THE CLOCK IS THE STOP, as it is on the notepad: a red dot
             cannot say how long you have been talking, and two controls
             for one act is one too many in a slot this size. */
          <button type="button" className="waka-dock-tool waka-dock-tool--wide"
            aria-label={props.stopLabel}
            disabled={props.recording.phase === "finishing"}
            onClick={() => void props.recording.stop()}>
            {Math.floor(props.recording.seconds / 60)}:
            {String(props.recording.seconds % 60).padStart(2, "0")}
          </button>
        )
      ) : null}
      <button type="button" className="waka-dock-tool"
        disabled={busy || props.recording.phase !== "idle"}
        aria-label={props.photoLabel}
        onClick={() => file.current?.click()}><HomeActionIcon kind="photo" /></button>
      {/* WHAT THE CHOOSER MAY OFFER IS THE PHOTO RULE'S OWN BUSINESS, so it
          is quoted from where that rule lives rather than typed out here.
          This list was identical to `lib/inspiration-photo.ts`'s by hand, and
          identical-by-hand is the state a list is in just before it stops
          being identical: the same string existed at four file inputs and the
          fourth said `image/*`, so a TIFF was selectable from one picker in
          this product and refused with a sentence at the other three.

          AND IT IS STILL ONLY THE DOOR. `accept` greys out what the operating
          system's file chooser will not hand over; it is defeated by a
          rename, by a drag and by a paste, so nothing here is a check. The
          lock is `inspectInspirationPhoto`, which reads the first 64 bytes —
          and on THIS path that call belongs to the overlay's `attach`, not to
          this component, because the same `onFile` also carries the
          recorder's audio. See the note on `onFile` above. */}
      <input ref={file} type="file" hidden
        accept={PHOTO_ACCEPT}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) props.onFile(picked);
        }} />
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
      <button type="button" className="waka-dock-tool waka-dock-tool--keep"
        aria-label={props.keepLabel} disabled={!props.canKeep}
        onClick={props.onKeep}><HomeActionIcon kind="keep" /></button>
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
      {props.onShare && props.shareLabel ? (
        <button type="button" className="waka-dock-tool"
          aria-label={props.shareLabel} disabled={props.saving}
          onClick={props.onShare}><HomeActionIcon kind="share" /></button>
      ) : null}
      <button type="button" className="waka-dock-tool waka-dock-tool--erase"
        aria-label={props.erasePending && props.eraseConfirmLabel ? props.eraseConfirmLabel : props.eraseLabel}
        disabled={props.saving}
        onClick={props.onErase}><HomeActionIcon kind="erase" /></button>
      {/* ONE LINE, THE SAME SLOT THE NOTEPAD'S STATE USES. Founder: "states
          should show and disappear in the bottom bar only." */}
      {props.erasePending && props.eraseQuestion ? (
        <span className="waka-dock-state" role="status">
          {props.eraseQuestion}
          <button type="button" className="waka-dock-undo" onClick={props.onCancelErase}>
            {props.cancelEraseLabel}
          </button>
        </span>
      ) : props.failed || props.recording.error ? (
        <span className="waka-dock-state" role="alert">{props.failed || props.recording.error}</span>
      ) : props.attaching ? (
        <span className="waka-dock-state" role="status">{props.uploading}</span>
      ) : null}
    </>,
    slot,
  );
}
