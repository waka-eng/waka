/**
 * YOUR INSPIRATIONS — the archive, OVER the world rather than instead of it.
 *
 * THIS WAS A PAGE AND IT IS NOT ANY MORE. Founder: "for your inspirations,
 * after I click on it, I feel like I'm lost how to go back to the previous
 * screen, and I didn't realise clicking on top of mind would leave me there.
 * So maybe for your inspirations, this should just be a modal that you can
 * escape to go back to your top of mind."
 *
 * WHY THE PAGE COULD NOT BE FIXED IN PLACE. Being lost was not a missing
 * back button — a page had been given everything a page can have: an
 * address, a browser Back, a switcher naming the view. The problem was that
 * reaching it UNMOUNTED THE WORLD. Once the world is gone there is nothing
 * to return to, only somewhere else to navigate, and every control that
 * could take you back necessarily reads as a trip rather than a return.
 * "Top of mind" in the switcher was the proof: pressing it did exactly what
 * it said and still felt like being moved, because it was moving you.
 *
 * An overlay cannot have that bug. The world is still mounted and still
 * visible behind the scrim, so leaving is dismissal — Escape, the scrim, the
 * close — and dismissal always lands you exactly where you were, with the
 * camera where you left it. See `ViewOpen` in `lib/view-location`: this is a
 * parameter on the world's address, not an address of its own.
 *
 * IT NAMES ITSELF NOW. As a page it deliberately did not, because the
 * switcher above it printed the view's name and two namers disagreed. An
 * overlay has no switcher above it and the world behind it is showing
 * someone's top of mind, so without a title the archive would be an
 * unlabelled grid floating over an unrelated statement.
 *
 * THE TILE IS UNIFORM WHETHER OR NOT THERE IS A PICTURE. A card is for
 * "discrete, self-contained items — things you could reorder, remove, or
 * interact with independently", which is exactly what one kept thing is. The
 * grid's whole readability comes from the tiles being the same size, so a
 * text-only keep fills the picture's space with its own words rather than
 * collapsing to a shorter card and breaking the rows.
 *
 * NOTHING IS TRUNCATED INTO A LIE. A long keep clips with a fade rather than
 * an ellipsis mid-word, and the full text is one press away on the item
 * itself — the grid is for finding the thing, not for reading it.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { DialogSurface } from "./DialogSurface";
import { NotePage } from "./NotePage";
import { NoteTools } from "./NoteTools";
import {
  attachmentPreviewImageUrl,
  deleteInspiration,
  finalizeAttachment,
  presignAttachment,
  updateInspiration,
  uploadToPresignedUrl,
} from "../lib/api";
import { useFirstVisit } from "../lib/first-visit";
import { useAudioRecording } from "../lib/use-audio-recording";
import { archiveChapter, dateWords } from "../lib/words";
/* THE SAME DOOR THE WORLD USES. `loadInspirations` is the archive's own
   reader — it pages, it carries the total the server reports, and it holds
   the invariant that a total is never smaller than what arrived. Reaching
   past it to the HTTP layer would have been a second way to read one thing,
   with its own pagination and its own idea of what the archive holds. */
import { loadInspirations, type Inspiration } from "../lib/data";
import { t, type SupportedLocale } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

/** How many kept things it takes before finding one is a real act rather
    than a glance. Roughly a screenful at the archive's row height. */
const SEARCHABLE = 12;

/** The first image on a keep, if it has one. Links and audio do not qualify:
    a tile's picture has to be a picture, not a favicon standing in for one. */
function pictureOf(row: Inspiration): string | null {
  const image = row.attachments?.find((item) => item.type === "image");
  return image ? attachmentPreviewImageUrl(image.id) : null;
}

export function SavesOverlay({ locale, profileId, title, focus, onClearFocus, onNoteOpen, onClose }: {
  locale: SupportedLocale;
  /** Whose archive. The caller already knows whose world is on screen; this
      surface should never work it out a second way and risk disagreeing. */
  profileId?: string | null;
  /** Named by the caller, because only the caller knows whether the world
      behind is yours or your agent's. */
  title: string;
  /**
   * WHETHER A NOTE IS OPEN IN HERE, AND HOW TO LEAVE IT.
   *
   * Founder, of an opened saved inspiration: "the bottom bar should also
   * change." It transforms while a NEW note is being written — the plus
   * becomes record and photo — and an opened saved note is the same page,
   * so it has to do the same thing.
   *
   * IT HANDS UP A CLOSER, NOT THE NOTE. Two things need it. The dock swaps
   * its middle slot while this is non-null, and — since the chevron went
   * (founder: "I can just go to all the inspirations using the bottom
   * panel") — pressing Inspirations in the bar IS the way back out of an
   * open note, so the bar has to be able to close one.
   *
   * AND CLOSING IS NOT `setOpen(null)`. It is `leaveNote`, which commits
   * what was typed on the way out — the autosave this page is built around.
   * Handing up a boolean and letting the world clear its own flag would
   * have been the version of this that silently discards edits.
   *
   * WHAT IS NOT HANDED UP is which note, or its words, or anything else the
   * world could form a second opinion with.
   */
  onNoteOpen?: (close: (() => void) | null) => void;
  /**
   * WHOSE ARCHIVE THIS COULD BE INSTEAD — asked in the corner, not here.
   *
   * Founder: "From the inspirations modal, it should always let the user
   * switch between your inspirations and your agent's inspirations as well.
   * And if the user changes it in the modal, then the page behind it should
   * also change."
   *
   * The second sentence is the design and it is unchanged: switching moves
   * the world and this surface together. What went is this surface's OWN
   * pair of buttons. `ME / MY AGENT` already stands in the top-left corner
   * of every screen in the product doing the identical thing, so the two of
   * them were one act offered twice in two registers — and this overlay's
   * own left edge was cutting the corner one in half, so it read "MY AGE".
   * One control, uncut, on every surface rather than on one of four.
   */
  /**
   * WHICH SAVES THIS CLAIM WAS READ FROM, when you arrived by asking.
   *
   * Founder: "how do we help the user deep dive into what inspirations led
   * to this top of mind?" — and, of a chat for it, "I feel like somehow
   * taking to the chat is the best but I don't know."
   *
   * The interpretive half went to a chat, which is right for "that's not
   * quite me". This is the other half, and it is the half a chat is wrong
   * for: WHICH saves a claim came from is a FACT, known exactly, sitting in
   * `claim.from`. A generated sentence about it can paraphrase or name the
   * wrong one, and the product's whole proposition is that its account of
   * you is checkable. It is also prose — you cannot open the four things
   * from a paragraph.
   *
   * So it is the archive, filtered. No new surface: this list already
   * scrolls, already groups by chapter, already opens a row into the whole
   * note. You land somewhere you know, holding exactly what made the
   * sentence.
   */
  focus?: { label: string; ids: readonly string[] } | null;
  onClearFocus?: () => void;
  onClose: () => void;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  /* Scoped to whose archive this is: being new to your own is not being new
     to your agent's. */
  const newHere = useFirstVisit(profileId ? { accountId: "p", profileId } : null, "saves");
  const [rows, setRows] = useState<Inspiration[]>([]);
  /* FIND IS A THING YOU DO TO YOUR INSPIRATIONS, so it lives on the page that
     holds them rather than as a destination of its own. It was a row in the
     menu — a verb among places — and the one entry there that did not go
     anywhere. Filtering happens here, over what is already loaded, so typing
     narrows in place with no round trip and no empty frame between keys. */
  const [query, setQuery] = useState("");
  /* THE FIELD ITSELF, so the clear control can hand focus back to it.
     The reference library's text-input component anatomy defines the clear as the thing that "resets
     the value AND RETURNS FOCUS TO THE INPUT" — without the ref, pressing it
     would empty the field and leave the caret nowhere, so the next search
     costs a click the person should not have had to make. A ref rather than
     `autoFocus` or a `document.querySelector`: this surface can hold a second
     field once a note is open, and a lookup by selector would be a second way
     to name a thing we already have a handle on. */
  const field = useRef<HTMLInputElement | null>(null);
  /**
   * WHICH CATEGORY IS BEING LOOKED AT, with `null` meaning all of them.
   *
   * Founder: "for the inspirations that I saved, I want to add tabs. So it's
   * like all and then we create categories based on the inspirations."
   *
   * BASED ON THEM, NOT IMPOSED ON THEM. There is no folder to file a keep
   * into and no tag to remember to apply — saving must cost nothing, and a
   * taxonomy you maintain is a cost paid at exactly the moment the product
   * promises not to charge one. The category is read off what was saved,
   * the same way a claim is.
   *
   * THE ROW ONLY APPEARS WHEN IT DIVIDES SOMETHING. One tab is not a choice,
   * and two tabs where one holds everything is a control that looks like it
   * does something and does not. See `categories` below.
   */
  const [category, setCategory] = useState<string | null>(null);
  /* HOW MUCH IS BEHIND THIS DOOR. The archive's size was announced on the
     menu row that used to lead here; it is a fact about this page, so it
     moved onto it when the row stopped carrying one. `total` is what the
     archive holds, which is not the same as how many arrived — an older
     server omits it, and then the length of what came is the best there is. */
  const [total, setTotal] = useState<number | null>(null);
  /* THE WORDS BEING WRITTEN, which is every word on the open note — there is
     no "editing" flag any more because there is no mode to be in. `draft` is
     seeded when a note opens and written back when it closes. */
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  /* Erasing asks first, the same way the chats list does. Page-level rather
     than per-row because exactly one note is open at a time. */
  const [asking, setAsking] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState<Inspiration | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const field = await loadInspirations(profileId ?? undefined);
      if (!mounted.current) return;
      /* Newest first here: a grid is read from the top left, and the archive's
         own order is oldest first because the ground lays them down that way. */
      setRows([...field.inspirations].reverse());
      /* NEVER A NUMBER SMALLER THAN WHAT IS ON SCREEN. A stale or wrong total
         coming back below the count of cards would print "4 of 2" — the page
         contradicting itself in one line, which is worse than saying nothing.
         `loadInspirations` already holds this; holding it here too means the
         page cannot be made to lie by a reader that stops holding it. */
      setTotal(Math.max(field.total, field.inspirations.length));
      setPhase("ready");
      /* RETURNED, SO A CALLER CAN RE-POINT AT A ROW IT WAS HOLDING. `open`
         is a snapshot of one row taken when it was pressed; a reload
         replaces `rows` and leaves that snapshot stale, which is how the
         first attachment uploaded correctly and then did not appear — the
         note on screen was the row as it had been a second earlier. */
      return field.inspirations;
    } catch {
      if (!mounted.current) return [];
      setPhase("failed");
    }
    return [];
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * LEAVING THE NOTE IS WHAT SAVES IT.
   *
   * Founder: "just let the user edit it directly and then just going back
   * saves it automatically like Apple Notes does."
   *
   * NOT ON A TIMER, and that is the whole of why this is honest. A
   * keystroke-debounced write puts a round trip behind every pause in
   * somebody's thinking, and then it has to SAY so — a spinner, a "saved"
   * receipt — which is more chrome than the Save button it replaced. The
   * chevron is a moment a person chose; committing there needs no
   * announcement because the act already has one.
   *
   * A FAILED WRITE DOES NOT LET GO. The note stays open with the words
   * still in it and says what happened, because the alternative is closing
   * a surface and silently discarding what somebody just wrote — which is
   * the one thing this product is for.
   *
   * Unchanged words close immediately: there is nothing to send, and a
   * round trip to write what is already there would make reading a note
   * cost the same as editing one.
   */
  const leaveNote = useCallback(async () => {
    const note = open;
    const words = draft.trim();
    if (!note || saving) return;
    if (!words || words === note.preview) { setOpen(null); setAsking(false); return; }
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateInspiration(note.id, { text: words });
      if (!mounted.current) return;
      /* The list holds what the page loaded, so it has to agree without a
         refetch — otherwise going back reveals the old first line. */
      setRows((all) => all.map((row) => (row.id === note.id ? { ...row, preview: words } : row)));
      setOpen(null);
      setAsking(false);
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [draft, open, saving]);

  /**
   * ═══ AND NOW THERE IS A SAVE TO PRESS, WITH THE NET STILL UNDER IT ═════
   *
   * Founder: "this button should appear when I'm editing old inspirations as
   * well. So when I'm looking at past saved inspirations, as soon as I start
   * typing, then that save button should be enabled."
   *
   * THE AUTOSAVE STAYS, AND IS NOT WHAT THIS REPLACES. `leaveNote` above is
   * still what the chevron and the dock's other exits call, and the long
   * note there is still right about why it fires on the way OUT rather than
   * on a timer. What it was wrong about is the sentence "there is nothing
   * for a button to disambiguate". There is one thing, and it is the only
   * thing a person actually wants to know while editing something they wrote
   * months ago: HAS IT TAKEN. An autosave that is correct and silent is
   * indistinguishable, from the chair, from an edit that is about to be
   * lost — and this is a product whose whole claim is that its account of
   * you is checkable. A control that brightens when there is an unsaved
   * change answers that without a spinner, a receipt or a timer.
   *
   * SO ITS DISABLED STATE IS THE RECEIPT. This writes and then re-points
   * `open` at the words it just stored, which makes `draft` equal
   * `open.preview` again, which dims the button. Nothing has to say "saved":
   * the control that was lit is not lit any more, and that is the same
   * single channel — light — the rest of this product reports with. It is
   * also why this does NOT close the note. Closing would make Save a second
   * way out standing beside the chevron, which is the "Save / Save as draft"
   * pair the founder already rejected once ("this is so confusing"); staying
   * put makes it a statement about the words instead of a door.
   *
   * THE SAME PREDICATE THE WRITE USES, which the caller's `canKeepOpenNote`
   * reads. The obvious enablement test is `draft !== open.preview`, and it
   * is subtly wrong: trailing whitespace makes those differ while the write
   * below trims and returns early, so a single typed space would light the
   * button and pressing it would do nothing. That exact failure — a control
   * that looks pressable and silently refuses — is the one `whyNoSend` was
   * written for on the chat composer and `keep-ready.ts` for the notepad.
   * One condition, read by both.
   *
   * A FAILED WRITE KEEPS EVERYTHING, like `leaveNote`: the words stay, the
   * note stays open, the bar says what happened through `saveFailed`, and
   * the button stays lit because there is still an unsaved change. Pressing
   * again retries, which is the whole recovery.
   */
  const keepOpenNote = useCallback(async () => {
    const note = open;
    const words = draft.trim();
    if (!note || saving || !words || words === note.preview) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateInspiration(note.id, { text: words });
      if (!mounted.current) return;
      /* Both copies, for the reason `leaveNote` gives about the list and the
         reason `attach` gives about the snapshot: the grid behind must not
         show the old first line, and the note in front must agree that it is
         saved or the button never dims. */
      setRows((all) => all.map((row) => (row.id === note.id ? { ...row, preview: words } : row)));
      setOpen((card) => (card && card.id === note.id ? { ...card, preview: words } : card));
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [draft, open, saving]);

  /** Whether the open note holds words that are not the stored ones yet. */
  const canKeepOpenNote = Boolean(open) && !saving
    && draft.trim().length > 0 && draft.trim() !== open?.preview;

  /**
   * ═══ A SAVED THOUGHT CAN STILL TAKE A RECORDING OR A PICTURE ═══════════
   *
   * Founder, looking at an opened note: "where did mic and image attachment
   * buttons go?"
   *
   * They had never been here. The notepad — the page you write a NEW thought
   * on — keeps record and photo in its bottom-left corner, and this page,
   * which is the same page for a thought you wrote earlier, had nothing
   * there. For a while it had DELETE there instead, which is how the
   * question got asked: the same corner meaning "add something" on one note
   * page and "destroy this" on the other.
   *
   * NONE OF THIS IS NEW MACHINERY, which is worth saying because it looked
   * like backend work and is not. `presign → upload → finalize` with an
   * `inspirationId` has existed and been in use all along — the world's own
   * memory panel attaches to an already-saved capture with exactly these
   * three calls. What was missing was a door.
   *
   * THE WRITE IS INDEPENDENT OF THE NOTE'S WORDS. An attachment lands on the
   * row immediately rather than waiting for the autosave on the way out: it
   * is a file that has already been uploaded, there is nothing to batch it
   * with, and holding it until somebody presses back would mean a photo
   * could be lost by closing a tab. The text keeps its own rule.
   */
  const [attaching, setAttaching] = useState(false);
  const [attachFailed, setAttachFailed] = useState(false);
  /* THE FILE INPUT WENT WITH THE CORNER IT LIVED IN. It belongs beside
     the button that opens it, and that button is in the bar now — see
     `NoteTools`, which owns both. */
  const attach = useCallback(async (file: File) => {
    const note = open;
    if (!note) return;
    setAttaching(true);
    setAttachFailed(false);
    try {
      const pre = await presignAttachment(
        { filename: file.name, contentType: file.type || "application/octet-stream", size: file.size },
        undefined,
        ...(profileId ? [{ profile: profileId }] as const : []),
      );
      await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
      await finalizeAttachment({
        type: file.type.startsWith("image/") ? "image" : "file",
        inspirationId: note.id,
        key: pre.key,
        name: file.name,
        ...(file.type ? { contentType: file.type } : {}),
      });
      if (!mounted.current) return;
      /* The open note is a snapshot, so it is re-pointed at the row that
         now carries the attachment — otherwise the upload lands, the list
         knows, and the page somebody is looking at does not. */
      const fresh = (await load()) ?? [];
      if (!mounted.current) return;
      setOpen((card) => (card ? fresh.find((row) => row.id === card.id) ?? card : card));
    } catch {
      if (mounted.current) setAttachFailed(true);
    } finally {
      if (mounted.current) setAttaching(false);
    }
  }, [load, open, profileId]);
  /* The same recorder the notepad uses, handed a different destination. */
  const recording = useAudioRecording(attach);

  /* TELL THE BAR, AND UNTELL IT ON THE WAY OUT. The cleanup matters more
     than the call: an archive unmounted with a note open would leave the
     dock holding a mic — and a way out — for a page that is no longer on
     screen.

     IT RE-RUNS WHEN `leaveNote` CHANGES, which is on every keystroke,
     because that callback closes over the draft. That is the point rather
     than a cost: the bar must hold the CURRENT closer, or pressing
     Inspirations would commit the words as they were when the note opened. */
  const openId = open?.id ?? null;
  useEffect(() => {
    onNoteOpen?.(openId === null ? null : () => void leaveNote());
    return () => onNoteOpen?.(null);
  }, [openId, onNoteOpen, leaveNote]);

  /* Case-folded substring over the preview, which is what a person reading the
     grid can actually see. Matching text they cannot read would return cards
     with no visible reason for being there. */
  const needle = query.trim().toLowerCase();

  /* Ordered by how much each holds, largest first: the tab you are most
     likely to want is the one with the most behind it, and an alphabetical
     row would put that wherever its first letter happened to fall. */
  const categories = (() => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row.category) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  })();

  /* A chosen category that no longer exists — the last keep in it was edited
     or deleted — shows everything rather than an empty grid under a tab that
     is no longer in the row to press again. */
  const active = category && categories.includes(category) ? category : null;

  const focused = focus ? new Set(focus.ids) : null;
  const shown = rows.filter(
    (row) =>
      (!needle || row.preview.toLowerCase().includes(needle)) &&
      (!active || row.category === active) &&
      (!focused || focused.has(row.id)),
  );
  /* Newest first, so the first row carries the largest number — the archive
     counts up as it grows, the way a person counts their own. Built from the
     unfiltered list so a search never renames anything. */
  const ordinals = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, at) => map.set(row.id, rows.length - at));
    return map;
  }, [rows]);

  /**
   * NOW, READ ONCE PER LOAD RATHER THAN PER ROW.
   *
   * Every chapter heading and every date is relative to a single moment. Read
   * fresh inside the loop, a list straddling a midnight or a seven-day
   * boundary could put the same save in two chapters, or date two neighbours
   * from two different "today"s. One clock for the whole render.
   */
  const now = useMemo(() => Date.now(), [rows]);

  /* BY AGE, IN THE ORDER THE ROWS ALREADY HAVE. `rows` is newest first, so
     walking it in order produces the chapters in order too — no sort, and no
     second opinion about which of two saves is more recent. */
  const chapters = useMemo(() => {
    const out: Array<{ key: string; words: string; rows: Inspiration[] }> = [];
    for (const row of shown) {
      const chapter = archiveChapter(row.capturedMs, now, locale);
      const last = out[out.length - 1];
      if (last && last.key === chapter.key) last.rows.push(row);
      else out.push({ ...chapter, rows: [row] });
    }
    return out;
  }, [shown, now, locale]);

  return (
    /* THE PAGE STOPS RESERVING THE CORNER ROW WHILE A NOTE IS OPEN.
       `.waka-page` holds 60px at the top for `ME / MY AGENT` and the gear,
       which are fixed to the viewport and would otherwise sit on the
       archive's title. At this depth those corners are HIDDEN — the notepad
       hides them too, and `Home` is told through `onNoteOpen` — so the
       reserve is holding room for nothing, and holding it was the last 60px
       between this page and the one the founder prefers. */
    <div className={`waka-page${open ? " waka-page--note" : ""}`}>
      <DialogSurface
        /* ═══ AN OPEN NOTE IS A PAGE, NOT A COLUMN IN THE ARCHIVE ════════
           Founder: "it should go to the same exact UI as when I'm creating
           a new inspiration."

           `NotePage` made the two tops identical and that was not enough:
           the archive is a 650px column — the reading measure a list of
           sentences wants — and the notepad is the whole window with its
           words in a 34rem column inside it. So the chevron sat 300px in
           from the left on one and at the page's margin on the other, and
           the words started at two different x. Same component, two boxes.

           The modifier gives this depth the notepad's geometry. The archive
           keeps its own at the list depth, where it is right. */
        className={`waka-over${open ? " waka-over--note" : ""}`}
        aria-label={title}
        /* ═══ A PAGE, NOT A DIALOG ══════════════════════════════════════
           This surface is the one the audit names: "A keyboard user
           standing in the inspirations archive cannot Tab to the dock —
           and the dock is the documented way out." It was `role="dialog"`
           with `aria-modal` and a Tab trap, while `claims.css` said the
           dock "is how you leave one" and `test/way-out.test.ts` excused
           this file from Law 2 on exactly that ground. Both could not be
           true, and the one that was false was the one a keyboard meets.

           Measured here before the change: open the archive from the bar
           with the keys, then press Tab sixty times and Shift+Tab sixty
           times. The bar was never reached once. `modal={false}` is the
           whole fix — see `DialogSurface`'s header for what a page keeps
           (focus on arrival, focus return, Escape) and what it gives up
           (the trap, and `aria-modal`'s claim that nothing else exists).

           IT IS THE BIGGEST SURFACE IN THE PRODUCT, which is why it is
           also the worst place to be held: a search field, a category
           row and a chapter-grouped list of everything you have ever
           kept, and the way out of all of it was a key nobody can see. */
        modal={false}
        onClose={onClose}
        >
        {open ? null : <header className="waka-over-head">
          {/* THE NAME, THEN WHAT IS BEHIND IT. Founder: "Just write the
              number 36 next to your inspirations so that the search bar is
              taking up the full space." The count was sharing a row with the
              search, which left the field a stub on a surface whose only
              other control is that field. It is a fact ABOUT the archive, so
              it belongs with the archive's name.

              The owner switch sits beside the title rather than replacing
              it, which is a correction: replacing it read as "Me / My agent"
              with nothing saying what of theirs you were looking at. The
              overlay has to name itself — there is no switcher above it and
              the world behind is showing somebody's top of mind. */}
          {/* THE NAME BECOMES THE WAY BACK. Founder: "with a button to go
              back to all." It replaces the title rather than sitting beside
              it, because at this depth the title would be naming a place you
              are not in — and two controls that both lead out is the stack
              this change exists to remove. */}
          {/* ═══ THE HEADER IS ABSENT ON AN OPEN NOTE ════════════════
              Founder: "make sure that when I'm entering from create new
              inspiration or my past inspiration, it's using the exact same
              component."

              This used to render the archive's own header with the way back
              inside it, which is why an opened note looked like a page of
              the archive rather than like a note. `NotePage` carries the
              chevron and the moment now, in the positions the notepad puts
              them in — so there is nothing left for a header to hold at this
              depth, and it is gone rather than emptied. */}
          {open ? null : (
          <span className="waka-over-name">
            <h2 className="waka-over-title">{focus ? focus.label : title}</h2>
            {/* THE WAY OUT OF THE FILTER, WHICH IS NOT THE WAY OUT OF THE
                PAGE. A filtered archive with no visible way back to all of
                it is the trap Law 2 is about, and the dock cannot do this
                one — pressing Inspirations from here is where you already
                are. It takes the count's place rather than sitting beside
                it, because while a subset is showing, how many the whole
                archive holds is not the fact this line is for. */}
            {/* ═══ THE COUNT IS PART OF THE NAME, NOT A LINE UNDER IT ══
                Founder, with "Your inspirations" over a second line reading
                "36 inspirations": "just say Your Inspirations (36)."

                The second line said the noun twice and spent a whole row of
                the page doing it. In parentheses after the title it is what
                it always was — a fact about the thing just named — and the
                archive starts one line higher.

                A NUMERAL SURVIVES "STATES RENDER, NUMERALS NEVER" HERE for
                the same reason the ordinal beside a row does: that ruling is
                against METRICS, things a person can do better or worse at.
                How many inspirations exist is the size of a list you are
                about to scroll, which is navigation. */}
            {focus && onClearFocus ? (
              <button type="button" className="waka-over-count waka-over-unfocus" onClick={onClearFocus}>
                {say("worldBackToAll")}
              </button>
            /* ═══ AND THE COUNT COUNTS WHAT IS ACTUALLY ON SCREEN ═════
                The reference library's power-search component says it as a rule: "Provide a result
                count to give users feedback on how their filters affect the
                data set." We do not need its tokenised filter bar — that page
                itself sends simple keyword search away ("Use PowerSearch for
                simple keyword searches" is listed under Don't) — but the
                feedback rule applies to any filter, and this line was failing
                it in the worst available way: it kept printing the UNFILTERED
                number. Search for something three of thirty-six saves match
                and the title said `(36)` over three rows. Not merely unhelpful
                — WRONG, and wrong in a product whose whole claim is that its
                account of you is checkable.

                SO IT IS `shown`, WHICH IS EVERY FILTER AND NOT JUST THE
                SEARCH. Law 7: a ruling lands on the class, not the instance
                it was pointed at. `shown` is already the one place the needle,
                the category tab and a claim's focus are reconciled, so reading
                it here means the count follows a category press for free
                instead of waiting to be reported as its own bug.

                NO NEW ELEMENT AND NO NEW WORD. The `(n/total)` shape was
                already here for a half-loaded page, and "how many of the whole
                are showing" is the same sentence whether the rest is unloaded
                or filtered out. A separate "3 results" line under the field
                would have been a second numeral saying one fact.

                A NUMERAL STILL SURVIVES "STATES RENDER, NUMERALS NEVER" for
                the reason the note above gives: that ruling is against
                METRICS. This is the length of the list you are about to
                scroll, which is navigation — and under a filter it is the only
                way to learn the filter did something without scrolling to the
                bottom to find out. */
            ) : total !== null ? (
              <span className="waka-over-count jar-saved-count">
                {shown.length < total ? `(${shown.length}/${total})` : `(${total})`}
              </span>
            ) : null}
          </span>
          )}
        </header>}
        {/* THE TWO FACTS A GRID NEEDS BEFORE IT CAN BE SEARCHED: how much is
            behind it, and a way to narrow it. Both were in the page's header
            and both still belong together — the count tells you whether
            searching is worth it, and the field is the thing you search with.

            FINDING IS A THING YOU DO TO YOUR INSPIRATIONS, so it lives on the
            surface that holds them rather than as a destination of its own.
            It was once a row in the menu — a verb among places, and the only
            entry there that did not go anywhere. Filtering happens over what
            is already loaded, so typing narrows in place with no round trip
            and no empty frame between keys. */}
        {/* THE FIELD TAKES THE ROW, because it is the only thing on it and
            because finding is a thing you do TO your inspirations — it lives
            on the surface that holds them rather than as a destination of its
            own. Filtering happens over what is already loaded, so typing
            narrows in place with no round trip and no empty frame between
            keys. */}
        {/* ═══ WHAT THIS PLACE IS, SAID ONCE ══════════════════════════
            Founder: "how to add the descriptions for like this without
            overwhelming the space we have?"

            The answer is not to find room for it. A description is read
            ONCE, by one person, on one visit, and then stepped over by
            every eye afterwards — including theirs, which is why the three
            permanent explainer paragraphs went out earlier under "only the
            most absolutely necessary things should be shown".

            So it is temporal rather than spatial. The line is here the
            first time you open this place and never again; nothing has to
            be dismissed, and the space it occupies is borrowed for one
            visit rather than spent forever. `firstVisit` writes the flag
            on mount, so it is one visit and not one render.

            IT IS NOT A TOUR. One line, on the surface it describes, at the
            moment somebody is standing on it and might wonder — which is
            the same argument that moved it off the switcher originally:
            three info icons answered the question "in the one place it is
            least useful, before you arrive, about a thing you have not
            seen". */}
        {newHere && !open ? <p className="waka-over-what">{say("worldFieldWhatIs")}</p> : null}
        {/* THE FIELD APPEARS WHEN THERE IS SOMETHING TO FIND IN.
            It rendered from the first save — a full-width search bar, in the
            input register, directly under the title, above three rows a
            person can read in one glance. Founder: "only the most absolutely
            necessary things should be shown." Searching an archive you can
            see all of is not a thing anybody does, and it was the second
            thing the eye hit on the surface.

            The threshold is the same argument the category row already makes
            one block down — "the row only appears when it divides something"
            — and the number is a screenful: past about a dozen rows the list
            stops being glanceable and finding becomes a real act. */}
        {/* ═══ THE FIELD IS A SURFACE WITH THINGS IN IT, NOT A BARE INPUT ══
            Founder, pointing at this field: "search bar can also utilize some
            reference from [a design system]." Its text-input page lists the anatomy a text field is allowed to have
            — Label, Description, Start icon, Placeholder, Clear button,
            Spinner, Status icon — and two of its rules name this exact field:

              "Always provide a visible label so users know what the field is
              for. Only hide the label when surrounding context makes it
              obvious, LIKE A SEARCH BAR WITH A MAGNIFYING-GLASS ICON."

              "Add a clear button for search and filter inputs so users can
              quickly reset without selecting all text."

            And its `CommandPalette` — the one component in that system that
            exists only to search — marks the glyph *Required*: "Search glyph:
            Required: Search symbol rendered by Icon in the default Input."

            WHAT THIS FIELD WAS DOING WRONG, in those terms. It had a hidden
            label and no icon, which means its entire claim to being a search
            box was the placeholder — and the placeholder is the one part of
            the anatomy that DISAPPEARS ON FOCUS. The moment you clicked it to
            type, the only thing on screen saying what it was went away, and
            what was left was an empty rounded box above a list. The reference states
            the prohibition directly: "Don't use placeholder text as a
            replacement for a label."

            So the box becomes the painted surface and the input moves inside
            it — which is the reference library's own typeahead anatomy, where the "Input
            surface" is the "Painted control surface containing the editable
            input" and the glyph and the clear sit on that surface rather than
            on the input. The border, the corner and the focus edge all move
            up to the wrapper; the input keeps only the typing.

            THE GLYPH IS NOT AN ICON FILE. This product has one typeface, no
            accent colour, and light as its only meaning channel — an imported
            icon set would be a second material (Law 5). It is a circle and a
            stem drawn in CSS out of the ink already on this surface, at the
            muted tier the placeholder uses, so it reads as the same breath as
            the words beside it.

            WHAT WAS NOT ADOPTED, and why, so the next person does not add it:
            Description (the founder removed the permanent explainers from
            this surface under "only the most absolutely necessary things
            should be shown", and the one line that survived is `newHere`
            above, shown once); Spinner (filtering runs over rows already in
            memory — there is no round trip for a spinner to describe, and one
            that spun on a keystroke would be inventing latency); Status icon
            (a search query cannot be invalid, and the error/warning tiers are
            built on a red this product does not have). */}
        {!open && rows.length > SEARCHABLE ? (
          <div className="waka-over-find">
            {/* Decorative in the exact sense `aria-hidden` is for: it says
                "search", and `aria-label` on the input below already says
                "search" to anyone who cannot see it. Announcing it twice is
                the duplication Law 4 is about. */}
            <span className="waka-over-find-glyph" aria-hidden="true" />
            <input
              ref={field}
              type="search"
              className="waka-over-search"
              value={query}
              placeholder={say("worldInspirationsSearch")}
              aria-label={say("worldInspirationsSearch")}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* ═══ THE WAY OUT OF A SEARCH, AT ONE PRESS ═══════════════════
                Law 2: "every surface you can enter has a visible way out, and
                it costs one press." Typing here enters a filtered archive, and
                until now the only way back to the whole of it was to select
                the text and delete it — a two-handed act with no affordance on
                screen pointing at it. The header's `(3/36)` tells you a filter
                is on; it is a fact, not a door.

                IT IS ONLY HERE WHILE THERE IS SOMETHING TO CLEAR, which is
                what keeps it inside the founder's standing rule — "only the
                most absolutely necessary things should be shown. minimalistic
                and simplism is the key to our design principle." The resting
                field gains nothing at all; the control appears as a
                consequence of something the person did and leaves with it.
                `query` rather than `needle`, so a field holding only spaces
                can still be emptied — `needle` trims, and a space you cannot
                see is still a value you have to get rid of.

                AND IT RETURNS FOCUS, which is the reference library's wording and not a
                flourish: "a trailing × button that RESETS THE VALUE AND
                RETURNS FOCUS TO THE INPUT." Clearing is almost always the
                start of a different search, and a cleared field you then have
                to click again is a second press for the same intent. */}
            {query ? (
              <button
                type="button"
                className="waka-over-find-clear"
                aria-label={say("worldInspirationsSearchClear")}
                onClick={() => {
                  setQuery("");
                  field.current?.focus();
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* The row divides nothing until there are two things to divide into. */}
        {phase === "ready" && categories.length > 1 ? (
          <div className="waka-tabs" role="tablist" aria-label={say("worldInspirationsCategories")}>
            <button
              type="button"
              role="tab"
              aria-selected={active === null}
              className={`waka-tab${active === null ? " waka-tab--on" : ""}`}
              onClick={() => setCategory(null)}
            >
              {say("worldInspirationsAll")}
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={active === name}
                className={`waka-tab${active === name ? " waka-tab--on" : ""}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        {open ? <NoteTools
          attaching={attaching}
          saving={saving}
          recording={recording}
          failed={attachFailed ? say("worldComposerUploadFailed") : saveFailed ? say("worldClaimCorrectFailed") : ""}
          uploading={say("worldComposerUploading")}
          recordLabel={say("worldComposerRecord")}
          stopLabel={say("worldComposerStop")}
          photoLabel={say("worldComposerPhoto")}
          /* THE NOTEPAD'S OWN WORDS, not a second string meaning the same
             thing. One act, one name — and `worldSaveInspiration` is already
             what a screen reader hears for this on the other note page. A
             separate "Save changes" here would be the product admitting the
             two pages are two pages. */
          keepLabel={say("worldSaveInspiration")}
          canKeep={canKeepOpenNote}
          onKeep={() => { void keepOpenNote(); }}
          onFile={(file) => void attach(file)}
        /> : null}
        {open ? (
          /* ═══ IT IS A NOTE, NOT A RECORD WITH AN EDIT MODE ═══════════════
             Founder: "when looking at an inspiration, don't have a separate
             button that says edit, just let the user edit it directly and
             then just going back saves it automatically like Apple Notes
             does, but there should be an option to delete an inspiration."

             WHAT WENT. An `Edit wording` button, a `Save`, a `Cancel`, and a
             mode the surface could be in. Four controls and a state machine
             for the act of changing your own sentence — on a product whose
             composer is a blank page with no Save on it until there is
             something to keep. The archive and the notepad disagreed about
             what writing is, and the notepad was right.

             WHY "SAVING" CAN STOP BEING A CONTROL. The write is idempotent
             and already scoped to one row, the words are on screen the whole
             time, and leaving is the only exit — so the moment to commit is
             unambiguous and there is nothing for a button to disambiguate.
             A Save here was asking a person to confirm a decision they had
             already finished making.

             AND IT IS AN HONEST AUTOSAVE, which is the part that is easy to
             get wrong. It fires on the way OUT rather than on a timer: a
             keystroke-debounced write would put a round trip behind every
             pause in somebody's thinking and would have to say so, and a
             product whose whole claim is that its account of you is
             checkable cannot have a save that happens at a moment nobody can
             name. If the write fails the surface says so and keeps you on
             the note with your words — see `saveFailed`.

             DELETE IS HERE AND ASKS FIRST, in the same two-press shape the
             chats list uses for the same act, because erasing one of your
             own things is the one move in this product that cannot be
             undone. `deleteInspiration` has existed in the client for
             months with no caller; this is the first door onto it. */
          <article className="waka-over-one">
            {/* ═══ THE SAME PAGE A NEW NOTE IS ═════════════════════════════
                Founder: "when clicking on a saved inspiration, it should go
                to the same exact UI as when I'm creating a new inspiration
                ... the title should be the same position at like middle
                center ... and the bottom bar should also change ... make
                sure it's using the exact same component, and I'm liking the
                new inspiration component a lot more."

                `NotePage` is that component. What it took over from here:

                  THE WAY BACK, which was in the archive's header above this
                  article rather than on the note — so an opened note read as
                  a page of the list instead of as a note.

                  WHEN IT IS, which was left-aligned in a row shared with
                  Delete. It is centred now, which is where the page the
                  founder prefers puts it.

                  THE ATTACH CORNER, which is the half of this that was an
                  actual bug. The notepad's mic-and-photo pair moved into the
                  dock in an earlier pass — founder, of that corner, "I don't
                  like this thing on the left", and of the bottom of the
                  screen, "this double layer is so weird" — and this page,
                  being a second copy of the same layout, kept its pair. The
                  founder photographed it as a stray pair floating beside the
                  bar and read it as a duplicate, which it was. Two layouts
                  for one object is how that happens; there is one now.

                DELETE IS THE TRAILING VERB, which is the slot `NotePage`
                reserves for a verb ABOUT the note. It asks first, in the
                same two-press shape the chats list uses, because erasing one
                of your own things is the one move here that cannot be
                undone. */}
            <NotePage
              locale={locale}
              whenMs={open.capturedMs}
              trailing={asking ? (
                <>
                  <button type="button" className="waka-note-erase" disabled={saving}
                    onClick={() => {
                      setSaving(true);
                      void deleteInspiration(open.id)
                        .then(() => {
                          setRows((all) => all.filter((row) => row.id !== open.id));
                          setAsking(false);
                          setOpen(null);
                        })
                        .catch(() => setSaveFailed(true))
                        .finally(() => setSaving(false));
                    }}>
                    {say(saving ? "worldDeleting" : "worldDeleteItAnyway")}
                  </button>
                  <button type="button" onClick={() => setAsking(false)}>{say("worldNotNow")}</button>
                </>
              ) : (
                <button type="button" className="waka-note-erase" onClick={() => setAsking(true)}>
                  {say("worldDelete")}
                </button>
              )}
            >
              {pictureOf(open) ? (
                <img className="waka-sheet-picture" src={pictureOf(open)!} alt="" />
              ) : null}

              {/* THE WORDS ARE THE PAGE. No border, no fill, no label — the
                  same blank-page treatment the notepad gives a new one, so a
                  thing you wrote reads the same whether it is ten seconds or
                  ten months old. */}
              <textarea
                className="jar-panel-text waka-note-page"
                value={draft}
                readOnly={saving}
                aria-label={say("worldCaptureInspiration")}
                onChange={(event) => { setDraft(event.target.value); setSaveFailed(false); }}
              />

              {/* ═══ AND ITS STATE GOES TO THE BAR WITH EVERYTHING ELSE'S ══
                  Founder: "states should show and disappear in the bottom
                  bar only." They are in the bar below, beside the tools
                  they belong to, rather than in the middle of the words. */}
            </NotePage>
          </article>
        ) : phase === "loading" ? (
          <p className="waka-over-status" role="status">
            {say("worldInspirationsLoad")}
          </p>
        ) : phase === "failed" ? (
          <>
            <p className="waka-over-status" role="alert">
              {say("worldInspirationsFail")}
            </p>
            <button type="button" className="waka-over-retry" onClick={() => void load()}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          <p className="waka-over-status">{say("worldInspirationsEmpty")}</p>
        ) : shown.length === 0 ? (
          /* A FILTER MUST NOT BE A TRAP — this file's own standing rule, one
             block up: "a chosen category that no longer exists shows
             everything rather than an empty grid under a tab that is no
             longer in the row to press again". A claim's saves are the one
             filter that cannot fall back that way, because falling back
             would silently answer a different question from the one asked.
             So it says what happened, and the way out of the filter is in
             the header where it always is. */
          <p className="waka-over-status">
            {say(focus ? "worldClaimFromGone" : "worldInspirationsNoHits")}
          </p>
        ) : (
          /* ═══ THE ARCHIVE READS AS A NOTES LIST ════════════════════════
             Founder, with the Apple Notes list on screen: "copy this for
             saved inspirations."

             WHAT THAT LIST ACTUALLY DOES, and all three parts matter:

               IT BREAKS INTO CHAPTERS BY AGE — Previous 7 Days, Previous 30
               Days, then a heading per month. A long archive becomes readable
               without a single row having to be compared against its
               neighbour, and the break is coarse on purpose: recent things
               are remembered by how long ago, older ones by which month.

               EACH CHAPTER IS ONE ROUNDED GROUP, with hairlines between its
               rows rather than around them. The group is the object; the rows
               are inside it. A list of separately-bordered cards is the
               wireframe look this product keeps removing.

               A ROW IS A LEAD LINE AND THEN ITS META. The first line of what
               you wrote is the title you never had to give it, and under it
               sit the ordinal, the date and the rest of the words — the
               second line is the one that tells you whether this is the one
               you are looking for.

             THE PICTURE GOES WITH THE GRID. A tile wall needed a thumbnail to
             be scannable; a list of lead lines does not, and an image column
             would make every text-only save look like a row with something
             missing. An attachment still opens with its keep. */
          <div className="waka-list">
            {chapters.map((chapter) => (
              <section key={chapter.key} className="waka-list-chapter">
                <h3 className="waka-list-when">{chapter.words}</h3>
                <ul className="waka-list-rows">
                  {chapter.rows.map((row) => {
                    const words = row.preview.trim();
                    const breakAt = words.indexOf("\n");
                    const lead = (breakAt > 0 ? words.slice(0, breakAt) : words).trim();
                    const rest = (breakAt > 0 ? words.slice(breakAt + 1) : "").trim();
                    return (
                      <li key={row.id}>
                        <button type="button" className="waka-list-row"
                          onClick={() => { setOpen(row); setDraft(row.preview); setAsking(false); setSaveFailed(false); }}>
                          <span className="waka-list-lead">{lead}</span>
                          <span className="waka-list-meta">
                            {/* WHICH ONE THIS IS, AND IT IS A NAME RATHER THAN
                                A MEASUREMENT. Founder, on the reference's
                                numbered list: "it works well with ours too
                                because it's like your fifth inspiration, your
                                100th inspiration."

                                That is why it survives "states render,
                                numerals never". The ruling is against METRICS
                                — a score, a count, a progress number, anything
                                that invites a person to perform against it. An
                                ordinal does not measure the thing it sits
                                beside; it NAMES it, and you cannot do better
                                or worse at having a hundredth inspiration.

                                FROM THE WHOLE ARCHIVE, NOT THE VISIBLE LIST,
                                so a search never renames anything. */}
                            {/* WITH A HASH. Founder, pointing at the bare
                                "36" beside a date: "add # in front."

                                It is the mark that turns a figure into a
                                NAME, which is the whole argument for this
                                number surviving "states render, numerals
                                never" — see the note above. Beside "Oct 8",
                                a bare 36 reads as another measurement of
                                the same kind; "#36" reads as which one this
                                is. */}
                            <span className="waka-list-index" aria-hidden="true">
                              #{ordinals.get(row.id)}
                            </span>
                            <span className="waka-list-date">{dateWords(row.capturedMs, now, locale)}</span>
                            {rest ? <span className="waka-list-rest">{rest}</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* ONE SURFACE, TWO STATES — NOT A SHEET OVER A SHEET.
            Founder: "modal and a modal is bad, so when user clicks on a box,
            then switch this whole page to that inspiration with a button to
            go back to all."

            Right, and the second layer was never earning its separateness. A
            dialog inside a dialog has two scrims, two Escapes and two ways
            out, and a person who presses Escape has to know which of the two
            they are dismissing — the cost of a stack is paid every time, by
            everyone, for a depth nobody asked for. The archive and one kept
            thing are the same surface at two depths, so the surface simply
            goes to that depth and offers the way back.

            The grid keeps its scroll position because it is not unmounted —
            `open` only decides which half renders — so coming back lands you
            where you were rather than at the top of a reloaded page. */}
      </DialogSurface>
    </div>
  );
}
