import type {ConversationSummary} from '../lib/api/conversations';
import {t,type SupportedLocale} from '../lib/locales';
import {DialogSurface} from './DialogSurface';

export function ConversationHistory({rows,id,locale,open,failed,onRetry,onClose,onChoose}:{rows:ConversationSummary[];id:string|null;locale:SupportedLocale;open:boolean;failed:boolean;onRetry:()=>void;onClose:()=>void;onChoose:(id:string|null)=>void}){
  /* A SHEET AT EVERY WIDTH. This was a 240px column standing open beside
     every conversation on a desk-sized window — attention spent on a list of
     talks you are not having. It opens when it is asked for, and not before. */
  if(!open)return null;
  const choose=(value:string|null)=>{onClose();onChoose(value);};
  const content=<><header><h2>{t(locale,'worldConversationHistory')}</h2><button type="button" onClick={onClose}>{t(locale,'worldClose')}</button></header>
    <button className="chat-new" type="button" onClick={()=>choose(null)}>{t(locale,'worldConversationNew')}</button>
    {failed?<p role="alert">{t(locale,'worldChatHistoryFailed')} <button type="button" onClick={onRetry}>{t(locale,'worldRoomHistoryRetry')}</button></p>:null}
    <nav aria-label={t(locale,'worldConversationHistory')}><ul>{rows.map(row=><li key={row.id}><button type="button" aria-current={row.id===id?'page':undefined} onClick={()=>choose(row.id)}>
      <span>{row.preview.trim()?row.preview.split(/\r?\n/).find(line=>line.trim())!.replace(/[*`]/g,'').slice(0,80):t(locale,'worldConversationNew')}</span><time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleDateString(locale,{month:'short',day:'numeric'})}</time>
    </button></li>)}</ul></nav></>;
  return <DialogSurface className="chat-sidebar" aria-label={t(locale,'worldConversationHistory')} onClose={onClose}>{content}</DialogSurface>;
}
