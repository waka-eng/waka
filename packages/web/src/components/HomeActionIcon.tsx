/** Familiar action shapes, decorative alongside their visible labels. */
/* THE `review` SHAPE IS GONE (2026-10-10) — a clipboard with two ruled lines,
   drawn for the review shortcut in the home corner, which went with the five
   components the founder folded into the claim queue's correction field.
   `chat` is left alone and is also unused: it belonged to the chat corner
   deleted in an earlier pass, and the conversation work is another session's.
   Noted here rather than quietly removed, because an icon nobody draws is the
   same kind of leftover as a verb nobody calls. */
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
export function HomeActionIcon({kind,className}:{kind:'capture'|'chat'|'record'|'photo';className?:string}){
  return <svg className={className} data-home-action-icon={kind} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind==='capture'?<><path className="jar-spark-core" d="m12 5 1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z" fill="currentColor" strokeWidth=".8"/>
        <g className="jar-spark-rays" strokeWidth="1.4"><path d="m3 3 2 2m14 14 2 2M3 21l2-2M19 5l2-2"/></g></>
      :kind==='record'?<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></>
      :kind==='photo'?<><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17"/><path d="m14 15 1.6-1.6a2 2 0 0 1 2.8 0L20 15"/></>
      :<><path d="M20 11a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M10 18h7l4 3v-5"/><path d="M8 8h8"/></>}
  </svg>;
}
