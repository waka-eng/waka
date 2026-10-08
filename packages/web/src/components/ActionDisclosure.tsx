import type {ReactNode} from 'react';
import {t,type SupportedLocale} from '../lib/locales';

/** Native disclosure keeps occasional actions reachable by keyboard and touch. */
export function ActionDisclosure({locale,label,children}:{locale:SupportedLocale;label:string;children:ReactNode}){
  return <details className="jar-item-actions" onKeyDown={event=>{
    if(event.key==='Escape'&&event.currentTarget.open&&!event.nativeEvent.isComposing){
      event.preventDefault();event.stopPropagation();event.currentTarget.open=false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }} onClickCapture={event=>{
    if((event.target as HTMLElement).closest('button')){
      event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();
    }
  }}>
    <summary aria-label={label}>{t(locale,'worldMoreActions')}</summary>
    <div className="jar-item-actions-options">{children}</div>
  </details>;
}
