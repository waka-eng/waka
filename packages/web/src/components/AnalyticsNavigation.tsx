import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { recordScreen, type Screen } from '../lib/analytics';

export function AnalyticsNavigation() {
  const { pathname } = useLocation();
  useEffect(() => {
    const screen: Screen = pathname === '/' ? 'home' : pathname.startsWith('/chat') ? 'chat' : pathname === '/settings' ? 'settings' : pathname === '/login' ? 'auth' : pathname.startsWith('/archive') ? 'memory' : 'other';
    recordScreen(screen);
  }, [pathname]);
  return null;
}
