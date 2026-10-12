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
      <input ref={file} type="file" hidden
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) props.onFile(picked);
        }} />
      {/* ONE LINE, THE SAME SLOT THE NOTEPAD'S STATE USES. Founder: "states
          should show and disappear in the bottom bar only." */}
      {props.failed || props.recording.error ? (
        <span className="waka-dock-state" role="alert">{props.failed || props.recording.error}</span>
      ) : props.attaching ? (
        <span className="waka-dock-state" role="status">{props.uploading}</span>
      ) : null}
    </>,
    slot,
  );
}
