import { useEffect, useState } from 'react';
import { useDockMenu } from '../lib/use-dock-menu';
import { ProfilePortrait } from './ProfilePortrait';

export function ProfileSwitcher({ label, options, onSelect }: {
  label: string;
  options: Array<{ id: string | null; name: string; selected: boolean }>;
  onSelect: (id: string | null) => void;
}) {
  const menu = useDockMenu();
  // Measured in the audit: three names clip at 320px. Wider screens retain
  // direct switching while phones and larger rosters use the full-name menu.
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 480px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 480px)');
    const update = () => setCompact(media?.matches ?? false);
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  useEffect(() => menu.close(false), [compact, menu.close]);
  const current = options.find(option => option.selected) ?? options[0]!;
  if (!compact && options.length <= 4) return <span className="jar-char-form" role="group" aria-label={label}>
    {options.map(option => <button key={option.id ?? 'human'} type="button"
      className={`jar-char-face jar-label${option.selected ? ' jar-char-face--standing' : ''}`}
      aria-pressed={option.selected} onClick={() => { if (!option.selected) onSelect(option.id); }}>
      <ProfilePortrait agentId={option.id ?? undefined} />{option.name}
    </button>)}
  </span>;
  return <span ref={menu.wrap} className="waka-profile-switcher">
    <button {...menu.buttonProps} type="button" className="jar-char-face jar-char-face--standing jar-label"
      aria-label={`${label}: ${current.name}`}>
      <ProfilePortrait agentId={current.id ?? undefined} /><span>{current.name}</span><span aria-hidden="true">⌄</span>
    </button>
    {menu.open ? <div {...menu.menuProps} className="waka-profile-menu" aria-label={label}>
      {options.map(option => <button key={option.id ?? 'human'} type="button" role="menuitemradio"
        aria-checked={option.selected} onClick={() => { menu.close(true); if (!option.selected) onSelect(option.id); }}>
        <ProfilePortrait agentId={option.id ?? undefined} /><span>{option.name}</span>
        {option.selected ? <span aria-hidden="true">✓</span> : null}
      </button>)}
    </div> : null}
  </span>;
}
