import {t,formatMessage,type SupportedLocale} from '../lib/locales';

/** A count of available guides, not a confidence score. Unknown is not zero. */
export function PrinciplesShortcutLabel({locale,count}:{locale:SupportedLocale;count:number|null}){
  return <>
    <span className="jar-values-words">{t(locale,'worldPrinciplesShortcut')}</span>
    {count!==null?<><span className="jar-values-count" aria-hidden="true">{count}</span>
      <span className="sr-only">{formatMessage(locale,'worldPrinciplesAvailable',{count})}</span></>:null}
    <span className="jar-caret jar-caret--up" aria-hidden="true"/>
  </>;
}
