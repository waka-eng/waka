/**
 * ═══ ONE ＋, TWO ROWS: ADD PHOTO, ADD FILE ══════════════════════════════
 *
 * Founder, 2026-10-15/16: on a note "the photo icon becomes ＋. Pressing ＋
 * opens a small pop-up menu with two rows: 'Add photo' and 'Add file'" — and
 * the chat gets the same ＋, with "Add photos" and "Add file".
 *
 * ONE COMPONENT FOR THE THREE PLACES IT STANDS — the notepad's slot in the
 * bar, the archive note's slot (through `NoteTools`) and the chat's tools —
 * because three hand-built menus is how three slightly different menus
 * happen, and the founder's complaint about this bar has always been the
 * differences ("make sure it's using the exact same component").
 *
 * IT OPENS UPWARD, HANGING OFF THE ＋, the way the old `.waka-new` sheet hung
 * off the plus that used to stand in this bar: a child of the ＋'s own box,
 * centred on it by the box model, so it cannot drift from the thing that
 * opened it. (That sheet's note in `Home.tsx` has the measurement — two
 * pixels off, because it was centred on the viewport instead.)
 *
 * A MENU, SAID AS ONE. `role="menu"` with two `menuitem`s; the first takes
 * focus when it opens, the arrows walk it, Escape and a press anywhere else
 * close it, and focus goes back to the ＋ so a keyboard is left where it was.
 * Escape is stopped here: the chat page and the notepad both close on
 * Escape, and closing a menu must not also close the page under it.
 *
 * THE PICKERS LIVE HERE, AND THEY QUOTE THE RULES. `PHOTO_ACCEPT` and
 * `FILE_ACCEPT` are the doors (`one-photo-accept-list.test.ts`); the locks
 * belong to whoever receives the files — `inspectInspirationPhoto` for a
 * photo, `inspectAttachmentFile` for a file — because only the receiver
 * knows what it is about to do with them.
 */
import { useRef } from "react";

import { HomeActionIcon } from "./HomeActionIcon";
import { PHOTO_ACCEPT } from "../lib/inspiration-photo";
import { FILE_ACCEPT } from "../lib/api/file-accept";
import { useDockMenu } from "../lib/use-dock-menu";

export function AddMenu(props: {
  /** The ＋'s name, read in full: it is a glyph with no word beside it. */
  label: string;
  photoLabel: string;
  fileLabel: string;
  onPhotos: (files: File[]) => void;
  onFiles: (files: File[]) => void;
  /** The chat takes several at once; a saved note attaches one at a time. */
  multiple?: boolean;
  disabled?: boolean;
  /** Why it cannot be pressed, when it cannot — the reason belongs to the control. */
  title?: string;
  /** The ＋'s own class: `waka-dock-tool` in the bar, `chat-add` in a chat's own footer. */
  buttonClassName: string;
}): JSX.Element {
  /* THE KEYBOARD AND POINTER RULES ARE SHARED with the bar's ⋯ menu —
     focus on open, roving arrows, Escape back to the button, an outside
     press, a disabled ＋ closing its menu. See `lib/use-dock-menu.ts`. */
  const menu = useDockMenu(props.disabled);
  const { open, close } = menu;
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  /* THE CHOOSER OPENS INSIDE THE PRESS. A file input may only be clicked
     from a person's own gesture, so the row clicks it first and closes the
     menu second — the other order would hand the click to a re-render. */
  const choose = (input: HTMLInputElement | null) => { input?.click(); close(); };

  return (
    <span ref={menu.wrap} className="waka-add">
      <button {...menu.buttonProps} type="button" className={props.buttonClassName}
        aria-label={props.label} title={props.title}
        disabled={props.disabled}><HomeActionIcon kind="plus" /></button>
      {open ? (
        <div {...menu.menuProps} className="waka-add-menu" aria-label={props.label}>
          <button type="button" role="menuitem" className="waka-add-row" onClick={() => choose(photos.current)}>
            <HomeActionIcon kind="photo" /><span>{props.photoLabel}</span>
          </button>
          <button type="button" role="menuitem" className="waka-add-row" onClick={() => choose(files.current)}>
            <HomeActionIcon kind="file" /><span>{props.fileLabel}</span>
          </button>
        </div>
      ) : null}
      <input ref={photos} type="file" hidden multiple={props.multiple}
        accept={PHOTO_ACCEPT}
        onChange={(event) => { const picked = [...event.target.files ?? []]; event.target.value = ""; close(false);
          if (picked.length) props.onPhotos(picked); }} />
      <input ref={files} type="file" hidden multiple={props.multiple}
        accept={FILE_ACCEPT}
        onChange={(event) => { const picked = [...event.target.files ?? []]; event.target.value = ""; close(false);
          if (picked.length) props.onFiles(picked); }} />
    </span>
  );
}
