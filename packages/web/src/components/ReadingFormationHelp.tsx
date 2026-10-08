import {t,type SupportedLocale} from '../lib/locales';

/** This explanation is available before and after a processing receipt. */
export function ReadingFormationHelp({locale}:{locale:SupportedLocale}){
  return <details className="jar-reading-help" data-jar-chrome="1" data-jar-interactive="1" onKeyDown={event=>{
    if(event.key==='Escape'&&event.currentTarget.open&&!event.nativeEvent.isComposing){
      event.preventDefault();event.stopPropagation();event.currentTarget.open=false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }}>
    <summary>{t(locale,'worldFormationHelp')}</summary>
    <div className="jar-reading-help-body">
      <section><h3>{t(locale,'worldPersonalInspirations')}</h3><p>{t(locale,'worldFormationInspirations')}</p></section>
      <section><h3>{t(locale,'worldReadingTitle')}</h3><p>{t(locale,'worldFormationReading')}</p></section>
      <section><h3>{t(locale,'worldPrinciplesShortcut')}</h3><p>{t(locale,'worldFormationPrinciples')}</p></section>
      <p className="jar-reading-help-note">{t(locale,'worldFormationKeep')}</p>
    </div>
  </details>;
}
