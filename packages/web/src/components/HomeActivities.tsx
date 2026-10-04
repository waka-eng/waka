import {useId} from 'react';
import {t,type SupportedLocale} from '../lib/locales';

/** Activities are destinations, distinct from controls explaining a reading. */
export function HomeActivities({locale,reviewLabel,resuming,hasInspirations,onReview,onChat}:{locale:SupportedLocale;reviewLabel:string;resuming:boolean;hasInspirations:boolean;onReview:()=>void;onChat:()=>void}){
  const id=useId();
  return <nav className="jar-home-activities" aria-label={t(locale,'worldHomeActivities')} data-jar-chrome="1" data-jar-interactive="1">
    <button type="button" className="jar-activity-card" aria-labelledby={`${id}-review`} aria-describedby={`${id}-review-hint`} onClick={onReview}>
      <span className="jar-activity-title" id={`${id}-review`}>{reviewLabel}<span aria-hidden="true">↗</span></span>
      <span className="jar-activity-hint" id={`${id}-review-hint`}>{t(locale,!hasInspirations?'worldHomeReviewEmpty':resuming?'worldHomeResumeHint':'worldHomeReviewHint')}</span>
    </button>
    <button type="button" className="jar-activity-card" aria-labelledby={`${id}-chat`} aria-describedby={`${id}-chat-hint`} onClick={onChat}>
      <span className="jar-activity-title" id={`${id}-chat`}>{t(locale,'worldConversationTitle')}<span aria-hidden="true">↗</span></span>
      <span className="jar-activity-hint" id={`${id}-chat-hint`}>{t(locale,'worldHomeChatHint')}</span>
    </button>
  </nav>;
}
