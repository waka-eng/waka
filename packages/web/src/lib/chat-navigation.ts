import {readViewLocation} from './view-location';

/** Return metadata is scoped like drafts and never opens an external URL. */
export function chatReturnPath(state:unknown,scope:string):string{
  if(!state||typeof state!=='object')return '/';
  const stored=(state as {wakaView?:{scope?:unknown;conversationFrom?:unknown}}).wakaView;
  const from=stored?.conversationFrom;
  if(stored?.scope!==scope||typeof from!=='string'||from.length>2048||!from.startsWith('/')||from.startsWith('//')||from.includes('\\'))return '/';
  const url=new URL(from,'https://waka.invalid');
  const view=readViewLocation(url.pathname,url.search);
  return url.origin==='https://waka.invalid'&&view&&!view.conversationId?url.pathname+url.search:'/';
}
