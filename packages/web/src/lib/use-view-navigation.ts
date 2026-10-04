import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readViewLocation, viewHref, type ViewLocation } from './view-location';

interface StoredView { scope: string; query: string; composerFrom?: string;reviewFrom?:string;shareFrom?:string;conversationFrom?:string }
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
    const reviewFrom=next.reviewId ? (!before?.reviewId&&!options.replace?previous:stored?.scope===current.scope?stored.reviewFrom:undefined):undefined;
    const shareFrom=next.sharePrinciple?(!before?.sharePrinciple&&!options.replace?previous:stored?.scope===current.scope?stored.shareFrom:undefined):undefined;
    const conversationFrom=next.conversationId?(!before?.conversationId&&!options.replace?previous:stored?.scope===current.scope?stored.conversationFrom:undefined):undefined;
    current.navigate(to, { replace: options.replace, state: { wakaView: { scope: current.scope, query: options.query ?? '', ...(composerFrom ? { composerFrom } : {}),...(reviewFrom?{reviewFrom}:{}),...(shareFrom?{shareFrom}:{}),...(conversationFrom?{conversationFrom}:{}) } } });
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
  const closeReview=useCallback(()=>{
    const current=latest.current,before=readViewLocation(current.location.pathname,current.location.search);
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    if(stored?.scope===current.scope&&stored.reviewFrom) current.navigate(-1);
    else if(before) current.navigate(viewHref({...before,reviewId:null}),{replace:true});
  },[]);
  const closeShare=useCallback(()=>{
    const current=latest.current,before=readViewLocation(current.location.pathname,current.location.search);
    if(!before?.principleId)return;
    const to=viewHref({...before,sharePrinciple:false});
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    if(stored?.scope===current.scope&&stored.shareFrom===to)current.navigate(-1);
    else current.navigate(to,{replace:true});
  },[]);
  return { view, href, key: location.key, query, write, closeComposer,closeReview,closeShare, own };
}
