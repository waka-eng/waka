import type {ApiConversationMessage} from '../lib/api/conversations';
import {t,type SupportedLocale} from '../lib/locales';
import {ConversationSourceDate,conversationSourceDateLabel} from './ConversationSourceDate';

type Reference=NonNullable<ApiConversationMessage['citations']>[number];
/** Only server-linked readings are choices; model prose never invents IDs. */
export function ConversationReadingChoices({references,locale,disabled,hasDraft,opening,failed,onChoose}:{
  references:Reference[];locale:SupportedLocale;disabled:boolean;hasDraft:boolean;opening:number|null;failed:boolean;onChoose:(reference:Reference)=>void;
}){
  return <section className="chat-reading-choices" aria-label={t(locale,'worldChatReadingChoices')}>
    <p className="chat-muted">{t(locale,'worldChatReadingChoices')}</p>
    {references.map(reference=><button className="chat-reading-choice" type="button" key={reference.index}
      disabled={disabled||!reference.available} aria-busy={opening===reference.index||undefined}
      aria-label={`${t(locale,'worldChatExploreReading')}: ${reference.preview??`${t(locale,'worldConversationReadingRef')} ${reference.index+1}`}${reference.historical?` (${conversationSourceDateLabel({...reference,locale})})`:''}`}
      onClick={()=>onChoose(reference)}>
      <span className="chat-reading-choice-heading"><span>{t(locale,'worldConversationReadingRef')}</span><span aria-hidden="true">{reference.available?'→':t(locale,'worldConversationReferenceChanged')}</span></span>
      <ConversationSourceDate locale={locale} historical={reference.historical} recordedAt={reference.recordedAt}/>
      {reference.preview?<span className="chat-reading-choice-text">{reference.preview}{reference.preview.length===96?'…':''}</span>:null}
      {opening===reference.index?<span role="status">{t(locale,'worldChatOpeningReading')}</span>:null}
    </button>)}
    {hasDraft?<p className="chat-muted">{t(locale,'worldChatReadingDraft')}</p>:null}
    {failed?<p role="alert">{t(locale,'worldChatReadingSelectionFailed')}</p>:null}
  </section>;
}
