import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readViewLocation, viewHref, type ViewLocation } from './view-location';

interface StoredView { scope: string; query: string; composerFrom?: string;shareFrom?:string;conversationFrom?:string;openFrom?:string }
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
    const before = readViewLocation(current.location.pathname, current.location.search);
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    const composerFrom = next.compose ? (!before?.compose && !options.replace ? previous
      : stored?.scope === current.scope ? stored.composerFrom : undefined) : undefined;
    const shareFrom=next.sharePrinciple?(!before?.sharePrinciple&&!options.replace?previous:stored?.scope===current.scope?stored.shareFrom:undefined):undefined;
    const conversationFrom=next.conversationId?(!before?.conversationId&&!options.replace?previous:stored?.scope===current.scope?stored.conversationFrom:undefined):undefined;
    /* WHERE THE WORLD WAS WHEN AN OVERLAY WENT UP. Remembered for the same
       reason the composer's origin is: dismissing has to be a RETURN through
       history, so the browser's own Back agrees with Escape and with the
       close. Writing `open:null` forward instead would leave a Back that
       reopens the thing you just dismissed. */
    const openFrom=next.open?(!before?.open&&!options.replace?previous:stored?.scope===current.scope?stored.openFrom:undefined):undefined;
    current.navigate(to, { replace: options.replace, state: { wakaView: { scope: current.scope, query: options.query ?? '', ...(composerFrom ? { composerFrom } : {}),...(shareFrom?{shareFrom}:{}),...(conversationFrom?{conversationFrom}:{}),...(openFrom?{openFrom}:{}) } } });
  }, []);
  const closeComposer = useCallback(() => {
    const current = latest.current;
    const before = readViewLocation(current.location.pathname, current.location.search);
    if (!before?.compose) return;
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    own.current = null;
    if (stored?.scope === current.scope && stored.composerFrom) current.navigate(-1);
    else current.navigate(viewHref({ ...before, compose: false }), { replace: true });
  }, []);
  /* `closeReview` and its `reviewFrom` origin are GONE (2026-10-10). The
     review was an overlay over the world and needed the same one-press return
     the composer and the share surface have; there is no review to close any
     more. `components/ReviewPanel.tsx` in git history is where it was used. */
  const closeShare=useCallback(()=>{
    const current=latest.current,before=readViewLocation(current.location.pathname,current.location.search);
    if(!before?.principleId)return;
    const to=viewHref({...before,sharePrinciple:false});
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    if(stored?.scope===current.scope&&stored.shareFrom===to)current.navigate(-1);
    else current.navigate(to,{replace:true});
  },[]);
  /**
   * PUTTING DOWN WHAT YOU HELD UP.
   *
   * Founder: "for your inspirations, this should just be a modal that you can
   * escape to go back to your top of mind." The whole point of the overlays
   * is that leaving one lands you exactly where you were, so this walks back
   * through history when it was this surface that pushed the overlay, and
   * only falls back to rewriting the address when it was not — a cold link
   * straight to `/?open=saves` has no history behind it to return to, and
   * there the world's own address IS the way back.
   */
  const closeOpen=useCallback(()=>{
    const current=latest.current,before=readViewLocation(current.location.pathname,current.location.search);
    if(!before?.open)return;
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    if(stored?.scope===current.scope&&stored.openFrom) current.navigate(-1);
    else current.navigate(viewHref({...before,open:null}),{replace:true});
  },[]);
  return { view, href, key: location.key, query, write, closeComposer,closeShare,closeOpen, own };
}
