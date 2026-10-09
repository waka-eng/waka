import type {ConversationContext} from '../lib/api/conversations';
import {t,type SupportedLocale} from '../lib/locales';
import {DialogSurface} from './DialogSurface';
import {ConversationSourceDate} from './ConversationSourceDate';

export function ConversationMemory({context,startingPrinciple,locale,busy,error,canRead,onRead,onClose}:{context:ConversationContext|null;startingPrinciple?:{statement:string;state:string}|null;locale:SupportedLocale;busy:boolean;error:boolean;canRead:boolean;onRead:()=>void;onClose:()=>void}){
  const content=<><header><h2>{t(locale,'worldChatMemory')}</h2><button type="button" onClick={onClose}>{t(locale,'worldClose')}</button></header>
    <p className="chat-muted">{t(locale,'worldChatMemoryExplanation')}</p>
    {!canRead?<p>{t(locale,'worldChatMemoryOnSend')}</p>:<button type="button" disabled={busy} onClick={onRead}>{t(locale,'worldConversationMemoryCheck')}</button>}
    {!canRead&&startingPrinciple?<section><h3>{t(locale,'worldConversationStartingFrom')}</h3><blockquote>{startingPrinciple.statement}</blockquote>{startingPrinciple.state==='contested'?<p>{t(locale,'worldConversationContested')}</p>:null}</section>:null}
    {busy?<p role="status">{t(locale,'worldChatMemoryLoading')}</p>:null}
    {error?<p role="alert">{t(locale,'worldConversationMemoryFailed')}</p>:null}
    {context?<>{([['worldConversationPrincipleRef',context.principles],['worldConversationReadingRef',context.reading],['worldConversationInspirationRef',context.inspirations]] as const).map(([key,rows])=>rows.length?<section key={key}><h3>{t(locale,key)}</h3><ul>{rows.map(row=><li key={row.id}>{'historical' in row?<ConversationSourceDate locale={locale} historical={row.historical} recordedAt={row.recordedAt}/>:null}<p>{row.text}{row.truncated?'…':''}</p>
      {'state' in row&&row.state==='contested'?<small>{t(locale,'worldConversationContested')}</small>:null}
      {'supportCurrent' in row&&!row.supportCurrent?<small>{t(locale,'worldConversationUnconfirmed')}</small>:null}
    </li>)}</ul></section>:null)}{![...context.principles,...context.reading,...context.inspirations].length?<p>{t(locale,'worldChatMemoryEmpty')}</p>:null}</>:null}</>;
  /* A sheet at every width, for the same reason the history is one. */
  return <DialogSurface className="chat-memory" aria-label={t(locale,'worldChatMemory')} onClose={onClose}>{content}</DialogSurface>;
}
