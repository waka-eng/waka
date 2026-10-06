import {t,type SupportedLocale} from '../lib/locales';

export function conversationSourceDateLabel({historical,recordedAt,locale}:{historical?:boolean;recordedAt?:string;locale:SupportedLocale}){
  if(!historical)return null;
  const date=recordedAt&&Number.isFinite(Date.parse(recordedAt))?new Date(recordedAt).toLocaleDateString(locale,{dateStyle:'medium',timeZone:'UTC'}):null;
  return t(locale,'worldChatEarlierReading')+(date?` · ${date}`:'');
}
export function ConversationSourceDate(props:{historical?:boolean;recordedAt?:string;locale:SupportedLocale}){
  const label=conversationSourceDateLabel(props);
  return label?<small className="chat-muted chat-source-date">{label}</small>:null;
}
