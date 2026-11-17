/** Build a frozen baseline/current component snapshot and serve fake API on loopback. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(root+'/package.json'),{build}=require('esbuild');
const args=process.argv.slice(2),mode=args[0]??'serve',snapshot=args[1]??'candidate',out=process.env.WAKA_QA_OUTPUT??'/tmp/waka-chat-flow-20261113/qa',port=Number(process.env.WAKA_QA_PORT??3012);
if(mode==='build'){
 if(!['baseline','candidate'].includes(snapshot))throw Error('Unknown snapshot');await mkdir(join(out,snapshot),{recursive:true});
 await build({entryPoints:[root+'/tools/chat-flow-qa/client.tsx'],outdir:join(out,snapshot),entryNames:'chat',nodePaths:[root+'/packages/web/node_modules'],bundle:true,format:'esm',jsx:'automatic',platform:'browser',target:'es2022',define:{__QA_BUILD__:JSON.stringify(snapshot),'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'dataurl','.png':'dataurl'},plugins:[{name:'qa-format-counter',setup(b){b.onLoad({filter:/\/ConversationText\.tsx$/},async({path})=>({contents:(await readFile(path,'utf8')).replace('function ConversationText({text}:{text:string}){','function ConversationText({text}:{text:string}){globalThis.__WAKA_QA_FORMATS__=(globalThis.__WAKA_QA_FORMATS__??0)+1;'),loader:'tsx'}));}}]});
 console.log(JSON.stringify({built:snapshot,realComponents:true,react:'development profiling build',providers:false,database:false}));process.exit(0);
}
if(mode!=='serve'||!Number.isInteger(port)||port<1024)throw Error('Invalid QA invocation');
const profile='33333333-3333-4333-8333-333333333333',conversation='44444444-4444-4444-8444-444444444444',states=new Map();
const sourceId='55555555-5555-4555-8555-555555555555',photoId='66666666-6666-4666-8666-666666666666';
const openingFor=mode=>mode==='none'?null:mode==='prompt'?{available:true,provenance:'application',ask:'Want to chat about what’s on your mind?',binding:{version:1,locale:'en-US',kind:'prompt',key:'worldCompanionChatPrompt',hash:'a'.repeat(64)}}:{available:true,provenance:'application',...(mode==='photo'?{quote:'',photoId,wordless:true}:{ask:'A synthetic reading: protect a quiet hour.',sources:[{id:sourceId,preview:'A synthetic saved example.',photoId,wordless:false}]}),binding:{version:1,locale:'en-US',kind:'source',source:{kind:mode==='photo'?'inspiration':'top_of_mind_entry',id:sourceId,hash:'synthetic-proof'},why:mode==='why',supports:mode==='why'?[{kind:'inspiration',id:sourceId,hash:'synthetic-support'}]:[],hash:'b'.repeat(64)}};
const stamp=()=>new Date().toISOString(),message=(s,role,content,id=randomUUID())=>({id,profileId:profile,conversationId:s.row.id,position:++s.row.revision,role,content,createdAt:stamp(),attachments:[]});
function fresh(config={}){const s={config:{messages:120,delayMs:10000,ackMs:800,failure:'none',opening:'none',...config},row:{id:conversation,profileId:profile,revision:0,createdAt:stamp(),updatedAt:stamp(),messages:[],generationEnabled:true,messageWindowStart:1},reply:{phase:'idle',requestId:null,messageId:null},timer:null,counts:{requests:0,saves:0,replyPolls:0,urlReads:0,urlActive:0,urlPeak:0,stops:0,modelCalls:0}};
 for(let i=0;i<s.config.messages;i++)s.row.messages.push(message(s,i%2?'assistant':'user',`Synthetic turn ${i+1}. A careful decision has trade-offs.\n\n**What matters**\n- Time for a small experiment\n- Clear ownership\n- A quiet hour to think\n\n${'A useful answer can leave room for uncertainty. '.repeat(14)}`));if(s.config.messages&&s.config.opening!=='none')s.row.opening=openingFor(s.config.opening);return s;}
const state=key=>{if(!states.has(key))states.set(key,fresh());return states.get(key);};
const response=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(body));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const body=async req=>{let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw Error('Body too large');}return text?JSON.parse(text):{};};
const reply=s=>({profileId:profile,conversationId:s.row.id,generationEnabled:true,revision:s.row.revision,canRetry:s.reply.phase==='failed',runAfter:null,retryAfter:null,...s.reply});
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),key=req.headers['x-waka-qa-build']==='baseline'?'baseline':'candidate';let s=state(key);
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'");
 if(url.pathname==='/__qa/reset'&&req.method==='POST'){if(s.timer)clearTimeout(s.timer);const config=await body(req);if(![0,30,120].includes(config.messages)||![5000,10000,15000].includes(config.delayMs)||![0,800,5000].includes(config.ackMs)||!['none','reply','429','lost'].includes(config.failure)||!['none','prompt','why','photo'].includes(config.opening??'none'))return response(res,400,{error:'Invalid fixture'});s=fresh(config);states.set(key,s);return response(res,200,s.row);}
 if(url.pathname==='/__qa/current')return response(res,200,{row:s.row,config:s.config});
 if(url.pathname==='/__qa/change-opening'&&req.method==='POST'){s.changed=true;if(s.row.opening)s.row.opening={binding:s.row.opening.binding,available:false,provenance:'application'};return response(res,200,{changed:true});}
 if(url.pathname==='/__qa/state')return response(res,200,{config:s.config,counts:s.counts,revision:s.row.revision,replyPhase:s.reply.phase});
 if(url.pathname.startsWith('/api/'))s.counts.requests++;
 if(/^\/api\/attachments\/photo-\d+\/url$/.test(url.pathname)||url.pathname===`/api/attachments/${photoId}/url`){s.counts.urlReads++;s.counts.urlActive++;s.counts.urlPeak=Math.max(s.counts.urlPeak,s.counts.urlActive);await sleep(500);s.counts.urlActive--;const id=url.pathname.split('/')[3];return response(res,200,{attachmentId:id,url:`/photo.svg?id=${id}`.replace(/^\//,`http://127.0.0.1:${port}/`)});}
 if(url.pathname==='/api/conversations/opening'&&req.method==='POST'){const input=await body(req);s.counts.openingReads=(s.counts.openingReads??0)+1;if(s.changed)return response(res,409,{error:'Synthetic source changed',code:'conversation_opening_unavailable'});const opening=openingFor(s.config.opening);return response(res,opening?200:409,{opening:opening?{...opening,binding:input.binding??opening.binding}:undefined});}
 if(url.pathname==='/api/conversations'&&req.method==='GET')return response(res,200,{profileId:profile,conversations:s.row.revision?[{id:conversation,profileId:profile,revision:s.row.revision,preview:'Synthetic careful decisions',createdAt:s.row.createdAt,updatedAt:s.row.updatedAt}]:[],generationEnabled:true});
 if(/^\/api\/conversations\/[^/]+\/reply$/.test(url.pathname)){s.counts.replyPolls++;return response(res,200,reply(s));}
 if(/^\/api\/conversations\/[^/]+\/replies\/[^/]+\/stop$/.test(url.pathname)){s.counts.stops++;clearTimeout(s.timer);s.reply.phase='stopped';return response(res,200,reply(s));}
 if((/^\/api\/conversations\/[^/]+\/messages$/.test(url.pathname)||url.pathname==='/api/conversations')&&req.method==='POST'){
  const data=await body(req),sent=data.firstMessage??data;s.counts.saves++;
  if(s.config.failure==='429')return response(res,429,{error:'Please wait before sending again.',code:'chat_rate_limited',retryAfterSeconds:10},{'Retry-After':'10'});
  if(url.pathname==='/api/conversations'){if(data.opening&&s.changed)return response(res,409,{error:'Synthetic source changed',code:'conversation_opening_unavailable'});s.row.id=data.id;s.row.opening=data.opening?openingFor(s.config.opening):null;}
  if(!s.row.messages.some(m=>m.id===sent.id)){s.row.messages.push(message(s,'user',sent.content,sent.id));s.row.updatedAt=stamp();s.reply={phase:'running',requestId:randomUUID(),messageId:sent.id};
   s.timer=setTimeout(()=>{if(s.reply.phase!=='running')return;if(s.config.failure==='reply'){s.reply.phase='failed';return;}s.row.messages.push(message(s,'assistant','Here is the complete synthetic answer, shown as soon as it is ready.\n\n**A small next step**\n- Keep the decision reversible.\n- Notice what changes after one quiet hour.'));s.reply.phase='ready';},s.config.delayMs);}
  await sleep(s.config.ackMs);if(s.config.failure==='lost'){res.destroy();return;}return response(res,200,{conversation:s.row,generationEnabled:true});
 }
 if(url.pathname.startsWith('/api/conversations/'))return response(res,200,{conversation:s.row,generationEnabled:true});
 if(url.pathname==='/api/runtime')return response(res,200,{conversationReplies:true});
 if(url.pathname.startsWith('/api/'))return response(res,404,{error:'Synthetic endpoint not implemented'});
 if(url.pathname==='/photo.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><rect width="80" height="60" fill="#729889"/><circle cx="50" cy="20" r="9" fill="#f1e8cd"/></svg>');return;}
 if(url.pathname.startsWith('/assets/')){const relative=url.pathname.slice(8);if(relative.includes('..')||!/^\w+\/[\w.-]+$/.test(relative))return response(res,404,{});const bytes=await readFile(join(out,relative));res.writeHead(200,{'content-type':relative.endsWith('.css')?'text/css':relative.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(bytes);return;}
 const selected=url.searchParams.get('build')==='baseline'?'baseline':'candidate';res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/${selected}/chat.css"><style>body{margin:0;background:#06080d}.qa-tools{position:fixed;z-index:1000;top:4px;left:4px;max-width:95vw;background:#10171f;padding:6px;color:#ddd;font:12px system-ui}.qa-tools form{display:flex;gap:8px;flex-wrap:wrap}.qa-tools button,.qa-tools select{font:12px system-ui}.qa-tools pre{max-height:180px;overflow:auto;max-width:90vw}.qa-photos{padding:100px 20px}.qa-photos>div{display:flex;align-items:center;height:110px;gap:20px}.qa-saved-photo{width:80px;height:60px}.qa-intro{padding:100px 20px}</style><div id="root"></div><script type="module" src="/assets/${selected}/chat.js"></script></html>`);
 }catch(error){if(!res.headersSent)response(res,500,{error:'Synthetic fixture error',kind:error.name});else res.destroy();}});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({qa:`http://127.0.0.1:${port}/?build=baseline`,candidate:`http://127.0.0.1:${port}/?build=candidate`,externalRequests:false,realModels:0,realDB:false,pid:process.pid})));
for(const signal of['SIGTERM','SIGINT'])process.on(signal,()=>{for(const s of states.values())clearTimeout(s.timer);server.close(()=>process.exit(0));});
