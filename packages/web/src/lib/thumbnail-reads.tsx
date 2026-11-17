import {createContext,useContext,useLayoutEffect,useMemo,type ReactNode} from 'react';
import {fetchAttachmentUrl} from './api/attachments';

const LIMIT=3,CACHE_LIMIT=64,FRESH_MS=4*60_000;
type Subscription={node:HTMLElement;id:string;visible:boolean;active:boolean;change:(url:string|null)=>void};
type Item={url:string|null;until:number;attempts:number;retryAt:number;imageFailures:number;controller?:AbortController;users:Set<Subscription>};
/** One authenticated scope, one observer and one bounded request queue. URLs
 * never leave this provider's memory; disposal fences even a late response. */
export class ThumbnailStore{
 private items=new Map<string,Item>();private nodes=new Map<HTMLElement,Subscription>();
 private observer:IntersectionObserver|null=null;private active=0;private closed=false;private timer:number|undefined;private frame:number|undefined;
 private fallbackListening=false;
 constructor(readonly owner:string,private read=fetchAttachmentUrl){}
 private visible(item:Item){return [...item.users].some(u=>u.active&&u.visible);}
 private emit(item:Item){for(const u of item.users)if(u.active)u.change(u.visible?item.url:null);}
 private item(id:string){let item=this.items.get(id);if(!item){item={url:null,until:0,attempts:0,retryAt:0,imageFailures:0,users:new Set()};this.items.set(id,item);}return item;}
 private visibility=(u:Subscription,visible:boolean)=>{
  if(this.closed||!u.active||u.visible===visible)return;u.visible=visible;const item=this.item(u.id);
  if(visible){item.imageFailures=0;if(!item.controller&&!item.url){item.attempts=0;item.retryAt=0;}if(item.until<=Date.now()){item.url=null;item.until=0;}u.change(item.url);}
  else u.change(null);
  this.pump();
 };
 private scan=()=>{
  this.frame=undefined;if(this.closed)return;
  for(const u of this.nodes.values()){
   let r=u.node.getBoundingClientRect(),top=Math.max(0,r.top),bottom=Math.min(window.innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(window.innerWidth,r.right);
   for(let p=u.node.parentElement;p&&bottom>top&&right>left;p=p.parentElement){const css=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(`${css.overflow} ${css.overflowX} ${css.overflowY}`)){r=p.getBoundingClientRect();top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);left=Math.max(left,r.left);right=Math.min(right,r.right);}}
   this.visibility(u,bottom>top&&right>left);
  }
 };
 private scheduleScan=()=>{if(this.frame===undefined)this.frame=window.requestAnimationFrame(this.scan);};
 private resume=()=>{for(const item of this.items.values())if(this.visible(item)&&!item.url&&!item.controller){item.attempts=0;item.retryAt=0;item.imageFailures=0;}this.pump();};
 observe(node:HTMLElement,id:string,change:Subscription['change']){
  if(this.closed)return()=>{};
  const u:Subscription={node,id,visible:false,active:true,change};this.nodes.set(node,u);this.item(id).users.add(u);change(null);
  if(typeof IntersectionObserver==='function'){
   this.observer??=new IntersectionObserver(entries=>{for(const entry of entries){const current=this.nodes.get(entry.target as HTMLElement);if(current)this.visibility(current,entry.isIntersecting&&entry.intersectionRatio>0);}},{threshold:0.01});
   this.observer.observe(node);
  }else{
   if(!this.fallbackListening){this.fallbackListening=true;window.addEventListener('scroll',this.scheduleScan,true);window.addEventListener('resize',this.scheduleScan);}
   this.scheduleScan();
  }
  if(this.nodes.size===1){window.addEventListener('online',this.resume);window.addEventListener('focus',this.resume);}
  return()=>{u.active=false;this.nodes.delete(node);this.observer?.unobserve(node);const item=this.items.get(id);item?.users.delete(u);if(!this.nodes.size)this.unlisten();this.pump();this.trim();};
 }
 invalidate(id:string){const item=this.items.get(id);if(!item||this.closed)return;item.url=null;item.until=0;item.imageFailures++;item.retryAt=Date.now()+1500;if(item.imageFailures>=2)item.attempts=2;this.emit(item);this.pump();}
 private trim(){
  for(const[id,item]of this.items)if(!item.users.size&&!item.controller&&!item.url)this.items.delete(id);
  let cached=[...this.items.values()].filter(item=>item.url).length;
  for(const[id,item]of this.items)if(cached>CACHE_LIMIT&&item.url&&!this.visible(item)&&!item.controller){item.url=null;item.until=0;cached--;if(!item.users.size)this.items.delete(id);}
 }
 start(){this.closed=false;}
 private unlisten(){
  window.removeEventListener('scroll',this.scheduleScan,true);window.removeEventListener('resize',this.scheduleScan);window.removeEventListener('online',this.resume);window.removeEventListener('focus',this.resume);this.fallbackListening=false;
  if(this.frame!==undefined){window.cancelAnimationFrame(this.frame);this.frame=undefined;}
 }
 private pump(){
  if(this.closed)return;window.clearTimeout(this.timer);this.timer=undefined;
  let wake=Infinity;
  for(const[id,item]of this.items){
   if(!this.visible(item)||item.url||item.controller||item.attempts>=2)continue;
   if(item.retryAt>Date.now()){wake=Math.min(wake,item.retryAt);continue;}
   if(this.active>=LIMIT)break;
   const controller=new AbortController();item.controller=controller;item.attempts++;this.active++;
   void this.read(id,controller.signal).then(url=>{
    if(this.closed||controller.signal.aborted)return;
    item.url=url;item.until=Date.now()+FRESH_MS;item.retryAt=0;item.attempts=0;this.emit(item);
   }).catch(()=>{
    if(this.closed)return;
    if(controller.signal.aborted){item.attempts=Math.max(0,item.attempts-1);item.retryAt=0;}
    else item.retryAt=Date.now()+1500;
   }).finally(()=>{if(item.controller===controller)item.controller=undefined;this.active--;this.trim();this.pump();});
  }
  // One bounded failure retry for visible tiles. No expiry/idle URL polling.
  if(Number.isFinite(wake))this.timer=window.setTimeout(()=>this.pump(),Math.max(1,wake-Date.now()));
 }
 dispose(){
  this.closed=true;this.observer?.disconnect();window.clearTimeout(this.timer);if(this.frame!==undefined)window.cancelAnimationFrame(this.frame);
  this.unlisten();
  for(const item of this.items.values())item.controller?.abort();this.items.clear();this.nodes.clear();
 }
}
const Context=createContext<ThumbnailStore|null>(null);
export function ThumbnailProvider({owner,children}:{owner:string|null;children:ReactNode}){
 const store=useMemo(()=>owner?new ThumbnailStore(owner):null,[owner]);
 useLayoutEffect(()=>{store?.start();return()=>store?.dispose();},[store]);
 return <Context.Provider value={store}>{children}</Context.Provider>;
}
export const useThumbnailStore=()=>useContext(Context);
