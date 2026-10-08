import {formatMessage,t,type SupportedLocale} from '../lib/locales';

/** Labeled routes supplement the world's spatial controls; no data is prefetched. */
export function PersonalNavigation({locale,section,hidden,count,shown,loading,failed,onHome,onInspirations,onPrinciples,onFind}:{
  locale:SupportedLocale;section:'top'|'field'|'sky';hidden:boolean;count:number|null;shown:number;loading:boolean;failed:boolean;
  onHome:()=>void;onInspirations:()=>void;onPrinciples:()=>void;onFind:()=>void;
}){
  return <nav className="jar-personal-navigation" aria-label={t(locale,'worldPersonalNavigation')} hidden={hidden} data-jar-chrome="1">
    {loading||failed?<p className="jar-navigation-status" role={failed?'alert':'status'}>{t(locale,loading?'worldOpeningInspirations':'worldRetryInspirations')}</p>:null}
    <button type="button" aria-current={section==='top'?'page':undefined} onClick={onHome}>{t(locale,'worldPersonalHome')}</button>
    <button type="button" className="jar-navigation-inspirations" disabled={loading} aria-label={failed?t(locale,'worldRetryInspirations'):undefined} aria-current={section==='field'?'page':undefined} onClick={onInspirations}>
      {t(locale,'worldPersonalInspirations')}{loading||failed?<span className="sr-only"> · {t(locale,loading?'worldOpeningInspirations':'worldRetryInspirations')}</span>:null}
      {count!==null?<span className="sr-only jar-saved-count">{count>shown?formatMessage(locale,'worldInspirationCountCapped',{shown,total:count}):formatMessage(locale,'worldInspirationCount',{count})}</span>:null}
    </button>
    <button type="button" aria-current={section==='sky'?'page':undefined} onClick={onPrinciples}>{t(locale,'worldPrinciplesShortcut')}</button>
    <button type="button" aria-label={t(locale,'worldFindInspiration')} onClick={onFind}>{t(locale,'worldPersonalFind')}</button>
  </nav>;
}
