/** Familiar action shapes, decorative alongside their visible labels. */
export function HomeActionIcon({kind,className}:{kind:'capture'|'review'|'chat';className?:string}){
  return <svg className={className} data-home-action-icon={kind} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind==='capture'?<><path className="jar-spark-core" d="m12 5 1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z" fill="currentColor" strokeWidth=".8"/>
        <g className="jar-spark-rays" strokeWidth="1.4"><path d="m3 3 2 2m14 14 2 2M3 21l2-2M19 5l2-2"/></g></>
      :kind==='review'?<><path d="M9 7V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><rect x="3" y="7" width="14" height="15" rx="2"/><path d="M7 12h6M7 16h4"/></>
      :<><path d="M20 11a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M10 18h7l4 3v-5"/><path d="M8 8h8"/></>}
  </svg>;
}
