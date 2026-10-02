import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readViewLocation, viewHref, type ViewLocation } from './view-location';

interface StoredView { scope: string; query: string }
/** Router owns browser history; the world owns rendering and restoration. */
export function useViewNavigation(scope: string | null) {
  const location = useLocation(), navigate = useNavigate();
  const href = location.pathname + location.search;
  const view = useMemo(() => readViewLocation(location.pathname, location.search), [href]);
  const own = useRef<string | null>(null);
  const latest = useRef({ location, navigate, scope }); latest.current = { location, navigate, scope };
  const query = (() => {
    const state = location.state as { wakaView?: StoredView } | null;
    return scope && state?.wakaView?.scope === scope && typeof state.wakaView.query === 'string' ? state.wakaView.query.slice(0, 200) : '';
  })();
  const write = useCallback((next: ViewLocation, options: { replace?: boolean; query?: string; observed?: boolean } = {}) => {
    const current = latest.current;
    if (!current.scope) return;
    const to = viewHref(next);
    const previous = current.location.pathname + current.location.search;
    if (to === previous && options.query === undefined) return;
    own.current = options.observed ? to : null;
    current.navigate(to, { replace: options.replace, state: { wakaView: { scope: current.scope, query: options.query ?? '' } } });
  }, []);
  return { view, href, key: location.key, query, write, own };
}
