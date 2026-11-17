import type {OpeningSelection} from '../../packages/web/src/lib/conversation-opening';
/** Loopback-only synthetic component harness. No App/auth/analytics bootstrap. */
import {Profiler,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationPanel} from '../../packages/web/src/components/ConversationPanel';
import type {ApiConversation} from '../../packages/web/src/lib/api/conversations';
import {DialogSurface} from '../../packages/web/src/components/DialogSurface';
import {SurfaceHeader} from '../../packages/web/src/components/SurfaceHeader';
import {ThumbnailProvider} from '../../packages/web/src/lib/thumbnail-reads';
import {SavedPhoto} from '../../packages/web/src/components/SavedPhoto';
import '../../packages/web/src/styles/layers.css';
import '../../packages/web/src/styles/global.css';
import '../../packages/web/src/styles/system.css';
import '../../packages/web/src/styles/chrome.css';
import '../../packages/web/src/styles/claims.css';
import '../../packages/web/src/styles/home.css';
import '../../packages/web/src/styles/chat.css';

declare const __QA_BUILD__:string;
declare global{interface Window{__WAKA_QA_FORMATS__?:number;__WAKA_CHAT_QA__?:{read:()=>unknown;reset:()=>void}}}
const build=__QA_BUILD__,scope={accountId:build==='baseline'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',profileId:'33333333-3333-4333-8333-333333333333'};
const originalFetch=window.fetch.bind(window);
let offline=false,commits:number[]=[],paints:number[]=[],scrollWrites=0,longTasks:number[]=[];
window.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input),location.href);
 if(url.origin!==location.origin)throw Error('QA blocks external requests');
 if(offline&&url.pathname.startsWith('/api/'))throw TypeError('Synthetic offline');
 const headers=new Headers(init?.headers);headers.set('X-WAKA-QA-Build',build);
 return originalFetch(input,{...init,headers});
};
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){if(this===sessionStorage&&key.includes('conversationScroll:'))scrollWrites++;return setItem.call(this,key,value);};
document.addEventListener('input',event=>{if(!(event.target instanceof HTMLTextAreaElement))return;const start=performance.now();requestAnimationFrame(()=>paints.push(performance.now()-start));},true);
try{new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});}catch{/* Not supported in every browser. */}
const resetMeasures=()=>{commits=[];paints=[];scrollWrites=0;longTasks=[];window.__WAKA_QA_FORMATS__=0;};
const stats=()=>({build,formatterCalls:window.__WAKA_QA_FORMATS__??0,renderCommits:commits.length,renderMs:commits,inputToNextFrameMs:paints,scrollStorageWrites:scrollWrites,longTaskMs:longTasks,realProviders:0,realDatabase:false});
window.__WAKA_CHAT_QA__={read:stats,reset:resetMeasures};

function Harness(){
 const [row,setRow]=useState<ApiConversation|null>(null),[version,setVersion]=useState(0),[photos,setPhotos]=useState(false),[snapshot,setSnapshot]=useState(''),[locale,setLocale]=useState<'en-US'|'ko-KR'>('en-US'),[openingMode,setOpeningMode]=useState('none');
 const reset=async(event?:React.FormEvent<HTMLFormElement>)=>{
  event?.preventDefault();const form=document.querySelector<HTMLFormElement>('#qa-controls')!,data=new FormData(form);
  const response=await fetch('/__qa/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:Number(data.get('messages')),delayMs:Number(data.get('delay')),ackMs:Number(data.get('ack')),failure:String(data.get('failure')),opening:String(data.get('opening')??'none')})});
  for(const key of Object.keys(localStorage))if(key.includes(scope.accountId))localStorage.removeItem(key);
  setOpeningMode(String(data.get('opening')??'none'));setRow(await response.json());setVersion(v=>v+1);resetMeasures();
 };
 return <>
  <details className="qa-tools" open={!row}><summary>Synthetic chat QA · {build}</summary>
   <form id="qa-controls" onSubmit={event=>void reset(event)}>
    <label>Messages <select name="messages" defaultValue="120"><option>0</option><option>30</option><option>120</option></select></label>
    <label>Reply delay <select name="delay" defaultValue="10000"><option value="5000">5s</option><option value="10000">10s</option><option value="15000">15s</option></select></label>
    <label>Save acknowledgement <select name="ack" defaultValue="800"><option value="0">0ms</option><option value="800">800ms</option><option value="5000">5s</option></select></label>
    <label>Next send <select name="failure"><option value="none">Success</option><option value="reply">Reply fails</option><option value="429">429 refusal</option><option value="lost">Commit / lost response</option></select></label>
    <label>Opening <select name="opening"><option value="none">None</option><option value="prompt">Companion question</option><option value="why">Reading + Why</option><option value="photo">Photo only</option></select></label>
    <button>Reset synthetic case</button>
   </form>
   <button onClick={()=>{resetMeasures();setSnapshot('Counters reset');}}>Reset measures</button>
   <button onClick={()=>void fetch('/__qa/state').then(r=>r.json()).then(server=>setSnapshot(JSON.stringify({client:stats(),server},null,2)))}>Read counters</button>
   <button onClick={()=>{offline=!offline;setSnapshot(`Synthetic offline ${offline}`);}}>Toggle offline</button>
   <button onClick={()=>void fetch('/__qa/change-opening',{method:'POST'}).then(()=>setSnapshot('Synthetic source changed; no model call'))}>Change opening source</button>
   <button onClick={()=>void fetch('/__qa/current').then(r=>r.json()).then(current=>{setRow(current.row);setOpeningMode(current.config.opening??'none');setVersion(v=>v+1);})}>Reopen saved conversation</button>
   <button onClick={()=>setPhotos(v=>!v)}>{photos?'Chat':'50 photo tiles'}</button>
   <button onClick={()=>setLocale(v=>v==='en-US'?'ko-KR':'en-US')}>English / 한국어</button>
   <pre>{snapshot}</pre>
  </details>
  {photos?<div className="qa-photos">{Array.from({length:50},(_,i)=><div key={i}><span>Synthetic photo {i+1}</span><SavedPhoto id={`photo-${i}`}/></div>)}</div>
   :row?<div className="waka-page"><DialogSurface className="waka-over waka-over--talk" modal={false} focusFirst={false} escapeLeavesAsModal={false} onClose={()=>setRow(null)} aria-label="Chat"><SurfaceHeader locale={locale} back={{kind:'close',onBack:()=>setRow(null)}} srTitle="Chat"/><Profiler id="chat" onRender={(_id,_phase,ms)=>commits.push(ms)}><ConversationPanel key={`${build}:${version}`} scope={scope} id={row.revision?row.id:null} initialConversation={row.revision?row:undefined} opener={!row.revision&&openingMode!=='none'?{selection:{locale:'en-US',text:openingMode==='prompt'?'Want to chat about what’s on your mind?':openingMode==='photo'?'':'A synthetic reading: protect a quiet hour.',...(openingMode==='prompt'?{}:{source:{kind:openingMode==='photo'?'inspiration':'top_of_mind_entry',id:'55555555-5555-4555-8555-555555555555',why:openingMode==='why'}})} as OpeningSelection}:undefined} locale={locale} onChoose={id=>{if(id)void fetch(`/api/conversations/${id}?profile=${scope.profileId}`).then(r=>r.json()).then(body=>setRow(body.conversation));}}/></Profiler></DialogSurface></div>:<p className="qa-intro">Choose a synthetic case. No account, database, telemetry or model service is connected.</p>}
 </>;
}
createRoot(document.getElementById('root')!).render(<ThumbnailProvider owner={`${scope.accountId}:${scope.profileId}`}><Harness/></ThumbnailProvider>);
