/** Familiar action shapes, decorative alongside their visible labels. */
/* THE `review` SHAPE IS GONE (2026-10-10) — a clipboard with two ruled lines,
   drawn for the review shortcut in the home corner, which went with the five
   components the founder folded into the claim queue's correction field.
   `chat` is left alone and is also unused: it belonged to the chat corner
   deleted in an earlier pass, and the conversation work is another session's.
   Noted here rather than quietly removed, because an icon nobody draws is the
   same kind of leftover as a verb nobody calls. (2026-10-18: drawn again, in
   front of the bottom bar's "Chat", with `plus` in front of "Inspiration".
   Founder: "add + icon in front of Inspiration, and chat icon in front of
   Chat at bottom bar.") */
/* `record` AND `photo` ARRIVED 2026-10-11, and they are the first two shapes
   in this product that stand WITHOUT a visible label beside them. Founder,
   with Apple Notes' blank note on screen: "copy this apple note experience",
   annotating its bottom toolbar — "2 icons: 1. record 2. image".
   The notepad is the one screen where that is right. It is a blank page whose
   entire argument is that nothing is on it, and three labelled buttons
   ("Photo", "Link", "Record") were the only furniture left — founder, on that
   row: "remove all." A word is louder than a glyph, and on this page quiet is
   the feature. Both carry an `aria-label` on the button, so the shape is
   decoration over a name rather than a name made of shape. */
/* `send` AND `stop` ARRIVED 2026-10-11, for the chat composer's one action.
   Founder, of the composer: "this is really ugly ... can you research some
   actual components that are used to design chat experiences?" Meta's
   The reference library ships its send control as a "circular icon-only
   Button" that
   "automatically toggles between send (primary) and stop (secondary) based
   on streaming state", and its first rule is that the translated Send-or-
   Stop accessible name survives any custom artwork, "the icon is decorative
   and must not be the only name source".

   AN ARROW, NOT A PAPER PLANE. A plane is a messaging metaphor; this is a
   question going to something that answers. The arrow is also the shape the
   stop square reads against — one fills, one points.

   `keep` ARRIVED 2026-10-11 — the one mark in the bar that ends a note.
   Founder, with "Save as draft" and "Save" standing side by side: "this is
   so confusing. Let's just have a save icon. There's no save as draft.
   There's just a save icon."
   NOT A DISK, AND NO LONGER A CHECK. A floppy means "write to storage" to
   people who used one and nothing at all to everybody else, so that was
   never in question. It was a CHECK until 2026-10-12, on the reasoning
   that a check means "done, which is what pressing it does" — and the
   founder, looking at it in the bar: "the save icon is a checkmark that I
   don't like."

   THE REASONING WAS WRONG, not just the taste. A check reports a state —
   this is confirmed, this is already true — and a save mark is a REQUEST,
   pressed on a note that is not saved yet. On a bar where the mark is dim
   until there is something to keep, a tick that is bright only when the
   work is NOT yet done says the opposite of what it means. It is now an
   arrow coming down onto a line: put this down, keep it. The same shape
   everything else in the product uses for a thing coming to rest.

   SAME WEIGHT AS THE REST OF THE SET, at 1.7. It was 2.1 "because it is
   the only glyph here that is a primary action — it sits in a filled pill
   and has to hold its weight against a solid ground". The pill is gone
   (see `.waka-dock-tool--keep` in `claims.css`), so there is no solid
   ground to hold weight against, and a heavier stroke beside six lighter
   ones would be the fill's argument surviving the fill.

   `erase` ARRIVED 2026-10-12, beside it. Founder: "let's just add delete
   icon next to the save icon." A LID AND A BODY, which is the one shape
   for discarding that needs no label — and it needs none here, because
   this product has no red to mark a destructive act with. Same 1.7
   stroke: the weight that separates it from Save is its distance along
   the bar and the confirm it opens, not its ink.

   `play` AND `pause` ARRIVED 2026-10-11, for the attachment tiles. Founder,
   of the browser's own audio player standing on a blank note: "I think it's
   a little ugly how files are added today." A `<audio controls>` is a white
   pill with a play triangle, a scrubber and a volume icon — the brightest
   object on the page, and three controls for a thing that needs one. The
   tile IS the control now, so it needs the two shapes a transport has.
   Solid rather than outlined: at 20px a stroked triangle reads as a chevron,
   and these sit inside a filled tile rather than beside a label.

   `share` ARRIVED 2026-10-15. Founder: "i also dont see option to share a
   specfici inspiration." An arrow leaving an open tray — the shape both
   phone systems already taught for "send this somewhere", so it needs no
   label beside it. (It was drawn as `keep` turned inside out; `keep` is a
   disk now — see its own note — and share keeps its tray.)

   `plus` AND `file` ARRIVED 2026-10-16. Founder, 2026-10-15: in a note the
   photo button "becomes ＋" with "Add photo" and "Add file", and the chat
   gets the same ＋. The plus is the bar's one door to a choice rather than
   an act, so it is the plainest mark there is; `file` is a page with its
   corner folded — the shape both phone systems use for "a document" — and
   it stands beside a name on every tile, so it never has to carry one. */
export function HomeActionIcon({kind,className}:{kind:'capture'|'chat'|'record'|'photo'|'plus'|'file'|'play'|'pause'|'keep'|'erase'|'send'|'stop'|'share'|'more';className?:string}){
  return <svg className={className} data-home-action-icon={kind} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind==='capture'?<><path className="jar-spark-core" d="m12 5 1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z" fill="currentColor" strokeWidth=".8"/>
        <g className="jar-spark-rays" strokeWidth="1.4"><path d="m3 3 2 2m14 14 2 2M3 21l2-2M19 5l2-2"/></g></>
      :kind==='record'?<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></>
      :kind==='send'?<path d="M4.5 12h14m0 0-5.5-5.5M18.5 12 13 17.5" fill="none" stroke="currentColor" strokeWidth="1.9"/>
      :kind==='stop'?<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>
      :kind==='share'?<><path d="M12 14.2V4.4"/><path d="m8.6 7.6 3.4-3.4 3.4 3.4"/><path d="M7.5 10.5H6.2a1.4 1.4 0 0 0-1.4 1.4v6.4a1.4 1.4 0 0 0 1.4 1.4h11.6a1.4 1.4 0 0 0 1.4-1.4v-6.4a1.4 1.4 0 0 0-1.4-1.4h-1.3"/></>
      /* `keep` IS A SAVE, NOT A DOWNLOAD. Founder, 2026-10-15: "instead of
         download have a save icon." The arrow into a tray read as a file
         landing on your disk; this is the one shape everyone already reads
         as Save — a disk, its shutter at the top, its label below. */
      :kind==='keep'?<><path d="M6 4.5h10.4L19.5 7.6V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z"/><path d="M8.2 4.5v4h7v-4"/><rect x="7.6" y="12.6" width="8.8" height="6.9" rx=".8"/></>
      :kind==='erase'?<><path d="M4.8 6.8h14.4"/><path d="M9.6 6.8V5.1a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.7"/>
        <path d="m6.6 6.8.85 11.3a1.7 1.7 0 0 0 1.7 1.6h5.7a1.7 1.7 0 0 0 1.7-1.6l.85-11.3"/></>
      :kind==='play'?<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>
      :kind==='pause'?<><rect x="7.5" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.1" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/></>
      :kind==='more'?<><circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/></>
      :kind==='plus'?<path d="M12 5v14M5 12h14"/>
      :kind==='file'?<><path d="M13.8 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.7z"/><path d="M13.8 3.5v4.2H18"/></>
      :kind==='photo'?<><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17"/><path d="m14 15 1.6-1.6a2 2 0 0 1 2.8 0L20 15"/></>
      :<><path d="M20 11a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M10 18h7l4 3v-5"/><path d="M8 8h8"/></>}
  </svg>;
}
