import {useId} from 'react';
import {t,type SupportedLocale} from '../lib/locales';
import {HomeActionIcon} from './HomeActionIcon';

/** Activities are destinations, distinct from controls explaining a reading. */
export function HomeActivities({locale,reviewLabel,resuming,hasInspirations,onReview,onChat}:{locale:SupportedLocale;reviewLabel:string;resuming:boolean;hasInspirations:boolean;onReview:()=>void;onChat:()=>void}){
  const id=useId();
  return <nav className="jar-home-activities" aria-label={t(locale,'worldHomeActivities')} data-jar-chrome="1" data-jar-interactive="1">
    {hasInspirations?<button type="button" className="jar-activity-card" aria-labelledby={`${id}-review`} aria-describedby={`${id}-review-hint`} onClick={onReview}>
      <span className="jar-activity-icon"><HomeActionIcon kind="review"/></span>
      <span className="jar-activity-copy"><span className="jar-activity-title" id={`${id}-review`}>{reviewLabel}</span>
        <span className={`jar-activity-hint${hasInspirations?' sr-only':''}`} id={`${id}-review-hint`}>{t(locale,!hasInspirations?'worldHomeReviewEmpty':resuming?'worldHomeResumeHint':'worldHomeReviewHint')}</span></span>
      <svg className="jar-activity-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>
    </button>:null}
    <button type="button" className="jar-activity-card" aria-labelledby={`${id}-chat`} aria-describedby={`${id}-chat-hint`} onClick={onChat}>
      <span className="jar-activity-icon"><HomeActionIcon kind="chat"/></span>
      <span className="jar-activity-copy"><span className="jar-activity-title" id={`${id}-chat`}>{t(locale,'worldConversationTitle')}</span>
        <span className="jar-activity-hint sr-only" id={`${id}-chat-hint`}>{t(locale,'worldHomeChatHint')}</span></span>
      <svg className="jar-activity-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>
    </button>
  </nav>;
}
