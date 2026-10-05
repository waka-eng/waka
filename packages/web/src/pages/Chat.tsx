import {useMemo} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {useAuth} from '../lib/auth-context';
import {normalizeSupportedLocale} from '../lib/locales';
import {chatReturnPath} from '../lib/chat-navigation';
import {ConversationPanel} from '../components/ConversationPanel';
import '../styles/chat.css';

/** Chat does not mount or fetch the canvas world's rooms and memory lists. */
export default function ChatPage(){
  const auth=useAuth(),navigate=useNavigate(),location=useLocation(),params=useParams();
  const scope=useMemo(()=>auth.account&&auth.profile?{accountId:auth.account.id,profileId:auth.profile.id}:null,[auth.account?.id,auth.profile?.id]);
  if(!scope)return null;
  const id=params.conversationId==='new'||params.conversationId==='list'?null:params.conversationId??null;
  const principleId=!id?new URLSearchParams(location.search).get('principle')??undefined:undefined;
  const from=chatReturnPath(location.state,`${scope.accountId}:${scope.profileId}`);
  return <ConversationPanel key={`${scope.accountId}:${scope.profileId}:${id??'new'}:${principleId??''}`}
    scope={scope} id={id} initialPrincipleId={principleId} locale={normalizeSupportedLocale(auth.profile?.preferredLocale)}
    onChoose={next=>{if(next!==id||principleId)navigate(`/chat/${next??'new'}`,{replace:!id&&Boolean(next),state:location.state});}}
    onClose={()=>navigate(from)}
    onOpenSource={(kind,sourceId)=>navigate(kind==='principle'?`/principles/${encodeURIComponent(sourceId)}`:`/inspirations/${encodeURIComponent(sourceId)}`)}/>;
}
