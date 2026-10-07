import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isMobileBuild, mobileDiagnosticsEnabled, platformServices } from '../lib/platform';
import { readStoredLocale, t } from '../lib/locales';
import { parseAppLink } from '../lib/platform/links';

export function MobileShell() {
  const navigate = useNavigate();
  const navigation = useRef(navigate); navigation.current = navigate;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!isMobileBuild) return;
    let stopped = false, release: (() => void) | undefined;
    void platformServices().then(async services => {
      const identity = await services.identity();
      const cleanup = await services.listenForLinks(raw => {
        if (stopped) return;
        try {
          const link = parseAppLink(raw, import.meta.env.VITE_APP_ID as string);
          if (mobileDiagnosticsEnabled && (link.hostname === 'diagnostics' || link.hostname === 'auth')) {
            const params = new URLSearchParams();
            if (link.hostname === 'auth') { params.set('phase', 'callback'); params.set('callback', raw); }
            else params.set('phase', link.searchParams.get('phase') ?? 'read');
            navigation.current(`/mobile-check?${params.toString()}`);
          } else if (link.hostname === 'navigate' && /^\/(?:login|profile|inspirations|review|principles|chat)(?:\/|$)/.test(link.pathname)) {
            navigation.current(link.pathname + link.search);
          }
        } catch (error) {
          if (mobileDiagnosticsEnabled) void services.files.write('m1/navigation-error.json', JSON.stringify({ errorName: error instanceof Error ? error.name : 'Unknown navigation error' }));
        }
      });
      if (stopped) cleanup(); else release = cleanup;
      const health = await services.health();
      await services.files.write('runtime/readiness.json', JSON.stringify({ identity, health }));
      if (!stopped) setConnected(health.connected);
    }).catch(() => { if (!stopped) setConnected(false); });
    return () => { stopped = true; release?.(); };
  }, []);
  if (!isMobileBuild || connected !== false) return null;
  const locale = readStoredLocale();
  return <div role="status" style={{ position: 'fixed', zIndex: 20000, top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, padding: '12px 16px', background: '#171c26', color: '#e9e5db', fontSize: 14, textAlign: 'center' }}>
    <span>{t(locale, 'mobileConnectionUnavailable')}</span>{' '}
    <button type="button" disabled={retrying} style={{ padding: '10px 14px', marginLeft: 8, minHeight: 44, border: '1px solid #596273', borderRadius: 18, background: 'transparent', color: 'inherit', font: 'inherit' }} onClick={() => {
      setRetrying(true);
      void platformServices().then(services => services.health()).then(health => setConnected(health.connected)).catch(() => setConnected(false)).finally(() => setRetrying(false));
    }}>{t(locale, 'mobileRetryConnection')}</button>
  </div>;
}
