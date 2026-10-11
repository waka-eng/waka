/** Familiar action shapes, decorative alongside their visible labels. */
/* THE `review` SHAPE IS GONE (2026-10-10) — a clipboard with two ruled lines,
   drawn for the review shortcut in the home corner, which went with the five
   components the founder folded into the claim queue's correction field.
   `chat` is left alone and is also unused: it belonged to the chat corner
   deleted in an earlier pass, and the conversation work is another session's.
   Noted here rather than quietly removed, because an icon nobody draws is the
   same kind of leftover as a verb nobody calls. */
export function HomeActionIcon({kind,className}:{kind:'capture'|'chat';className?:string}){
  return <svg className={className} data-home-action-icon={kind} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind==='capture'?<><path className="jar-spark-core" d="m12 5 1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z" fill="currentColor" strokeWidth=".8"/>
        <g className="jar-spark-rays" strokeWidth="1.4"><path d="m3 3 2 2m14 14 2 2M3 21l2-2M19 5l2-2"/></g></>
      :<><path d="M20 11a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M10 18h7l4 3v-5"/><path d="M8 8h8"/></>}
  </svg>;
}
