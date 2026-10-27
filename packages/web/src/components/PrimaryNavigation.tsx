import { t, type SupportedLocale } from '../lib/locales';
import { HomeActionIcon } from './HomeActionIcon';

export type PrimaryDestination = 'home' | 'inspirations' | 'chats';

/** Destinations stay in place; creation belongs to the current page. */
export function PrimaryNavigation({ locale, current, onNavigate, onReselect, capture }: {
  locale: SupportedLocale;
  current: PrimaryDestination | null;
  onNavigate: (destination: PrimaryDestination) => void;
  onReselect: () => void;
  capture?: { label: string; onClick: () => void };
}) {
  const tabs = [
    { id: 'home', label: 'worldBackHome', icon: 'home' },
    { id: 'inspirations', label: 'worldNavInspirations', icon: 'capture' },
    { id: 'chats', label: 'worldNavChats', icon: 'chat' },
  ] as const;
  return <div className="waka-primary-navigation" data-jar-chrome="1" data-jar-interactive="1">
    {capture ? <button type="button" className="waka-primary-capture" onClick={capture.onClick}>
      <HomeActionIcon kind="plus" />{capture.label}
    </button> : null}
    <nav className="waka-dock waka-dock--tabs" aria-label={t(locale, 'worldMenuLabel')}>
      {tabs.map(tab => <button key={tab.id} type="button"
        className={`waka-dock-item${current === tab.id ? ' waka-dock-item--here' : ''}`}
        aria-current={current === tab.id ? 'page' : undefined}
        onClick={() => { if (current === tab.id) onReselect(); else onNavigate(tab.id); }}>
        <HomeActionIcon kind={tab.icon} />
        <span>{t(locale, tab.label)}</span>
      </button>)}
    </nav>
  </div>;
}
