import {useMemo,useRef} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {useAuth} from '../lib/auth-context';
import {normalizeSupportedLocale} from '../lib/locales';
import {ConversationPanel} from '../components/ConversationPanel';
import {Menu} from '../components/Menu';
import {WallSwitch} from '../components/WallSwitch';
import {usePageMenu} from '../lib/page-menu';
import type {ApiConversation} from '../lib/api/conversations';
import '../styles/chat.css';

/** Chat does not mount or fetch the canvas world's rooms and memory lists. */
export default function ChatPage(){
  const auth=useAuth(),navigate=useNavigate(),location=useLocation(),params=useParams();
  /* THE CORNERS ARE THE NAVIGATION, HERE AS EVERYWHERE. What stood on this
     page was an app header — a back arrow, a title, and a hamburger opening a
     list no other screen has. The founder removed Back from every page
     because the menu is always there; it is always there on this page now
     too, and it is the same menu, in the same two corners. */
  const locale=normalizeSupportedLocale(auth.profile?.preferredLocale);
  const menu=usePageMenu(locale, auth.account?.id);
  // One immediately committed response, not persistent or cross-owner memory.
  const committed=useRef<{owner:string;row:ApiConversation}|null>(null);
  const scope=useMemo(()=>auth.account&&auth.profile?{accountId:auth.account.id,profileId:auth.profile.id}:null,[auth.account?.id,auth.profile?.id]);
  if(!scope){committed.current=null;return null;}
  const id=params.conversationId==='new'||params.conversationId==='list'?null:params.conversationId??null;
  const principleId=!id?new URLSearchParams(location.search).get('principle')??undefined:undefined;
  const owner=`${scope.accountId}:${scope.profileId}`;
  if(committed.current&&(committed.current.owner!==owner||committed.current.row.id!==id))committed.current=null;
  return <><Menu locale={locale} items={menu.items} current={menu.current} left={<WallSwitch menu={menu} locale={locale} />} label="worldMenuTalk" onSettings={menu.onSettings}/><ConversationPanel key={`${scope.accountId}:${scope.profileId}:${id??'new'}:${principleId??''}`}
    scope={scope} id={id} initialPrincipleId={principleId} initialConversation={committed.current?.row} locale={locale}
    onCreated={row=>{if(row.profileId===scope.profileId)committed.current={owner,row};}}
    onChoose={next=>{if(next!==id||principleId)navigate(`/chat/${next??'new'}`,{replace:!id&&Boolean(next),state:location.state});}}
    onOpenSource={(kind,sourceId)=>navigate(kind==='principle'?`/principles/${encodeURIComponent(sourceId)}`:`/inspirations/${encodeURIComponent(sourceId)}`)}/></>;
}
