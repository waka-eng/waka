import {useMemo,useRef} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {useAuth} from '../lib/auth-context';
import {normalizeSupportedLocale} from '../lib/locales';
import {chatReturnPath} from '../lib/chat-navigation';
import {ConversationPanel} from '../components/ConversationPanel';
import type {ApiConversation} from '../lib/api/conversations';
import '../styles/chat.css';

/** Chat does not mount or fetch the canvas world's rooms and memory lists. */
export default function ChatPage(){
  const auth=useAuth(),navigate=useNavigate(),location=useLocation(),params=useParams();
  // One immediately committed response, not persistent or cross-owner memory.
  const committed=useRef<{owner:string;row:ApiConversation}|null>(null);
  const scope=useMemo(()=>auth.account&&auth.profile?{accountId:auth.account.id,profileId:auth.profile.id}:null,[auth.account?.id,auth.profile?.id]);
  if(!scope){committed.current=null;return null;}
  const id=params.conversationId==='new'||params.conversationId==='list'?null:params.conversationId??null;
  const principleId=!id?new URLSearchParams(location.search).get('principle')??undefined:undefined;
  const owner=`${scope.accountId}:${scope.profileId}`;
  if(committed.current&&(committed.current.owner!==owner||committed.current.row.id!==id))committed.current=null;
  const from=chatReturnPath(location.state,`${scope.accountId}:${scope.profileId}`);
  return <ConversationPanel key={`${scope.accountId}:${scope.profileId}:${id??'new'}:${principleId??''}`}
    scope={scope} id={id} initialPrincipleId={principleId} initialConversation={committed.current?.row} locale={normalizeSupportedLocale(auth.profile?.preferredLocale)}
    onCreated={row=>{if(row.profileId===scope.profileId)committed.current={owner,row};}}
    onChoose={next=>{if(next!==id||principleId)navigate(`/chat/${next??'new'}`,{replace:!id&&Boolean(next),state:location.state});}}
    onClose={()=>navigate(from)}
    onOpenSource={(kind,sourceId)=>navigate(kind==='principle'?`/principles/${encodeURIComponent(sourceId)}`:`/inspirations/${encodeURIComponent(sourceId)}`)}/>;
}
