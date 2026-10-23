import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EMPTY_VIEW, readViewLocation, viewHref, type ViewLocation } from './view-location';

interface StoredView { scope: string; query: string; composerFrom?: string;shareFrom?:string;conversationFrom?:string;openFrom?:string;noteFrom?:string }
/** How long a traversal may take to land before a close stops waiting on it. */
const POP_LIMIT_MS = 1500;
type WriteOptions = { replace?: boolean; query?: string; observed?: boolean };
/** Router owns browser history; the world owns rendering and restoration. */
export function useViewNavigation(scope: string | null) {
  const location = useLocation(), navigate = useNavigate();
  const href = location.pathname + location.search;
  const view = useMemo(() => readViewLocation(location.pathname, location.search), [href]);
  const own = useRef<string | null>(null);
  const latest = useRef({ location, navigate, scope }); latest.current = { location, navigate, scope };
  /* THE ENTRY BEING LEFT (a traversal, or the archive's closing replace), until the router lands elsewhere.
     Leaving the archive from a note commits the note on the way, and the
     note letting go asks for its own close — which, arriving while the
     archive's step is still in flight, would be a second step back (seen in
     Chromium: Escape from a note walked one entry too far). A close asked
     for while a traversal from this entry is under way is already answered. */
  const traversal = useRef<{ from: string; at: number } | null>(null);
  /** Mark that this entry is being left (a traversal, or a replace that closes the archive). */
  const leaving = () => { traversal.current = { from: latest.current.location.key, at: Date.now() }; };
  const traverse = (delta: number) => { leaving(); latest.current.navigate(delta); };
  /** Whether a traversal asked from `key` may still land (one that never
      does stops counting, so a close is never a dead press for good). */
  const traversing = (key: string) => Boolean(traversal.current && traversal.current.from === key && Date.now() - traversal.current.at < POP_LIMIT_MS);
  useEffect(() => { if (traversal.current?.from !== location.key) traversal.current = null; }, [location.key]);
  /** Whether this entry is an open note pushed over the archive's list. */
  const noteOverList = (current: typeof latest.current, before: ViewLocation | null, stored: StoredView | undefined) =>
    Boolean(before?.note && stored?.scope === current.scope && stored.noteFrom === viewHref({ ...before, note: null }));
  const query = (() => {
    const state = location.state as { wakaView?: StoredView } | null;
    return scope && state?.wakaView?.scope === scope && typeof state.wakaView.query === 'string' ? state.wakaView.query.slice(0, 200) : '';
  })();
  const write = useCallback((next: ViewLocation, options: WriteOptions = {}) => {
    const current = latest.current;
    if (!current.scope) return;
    const to = viewHref(next);
    const previous = current.location.pathname + current.location.search;
    if (to === previous && options.query === undefined) return;
    const before = readViewLocation(current.location.pathname, current.location.search);
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    const [toPath = '/', toSearch] = to.split('?');
    const nextNote = readViewLocation(toPath, toSearch ? `?${toSearch}` : '')?.note ?? null;
    /* A REPLACE UNDER AN OPEN NOTE. One that drops the note (the bar moving
       you on, the archive closing with no origin) replaces the note's own
       entry, so no note entry is left in Forward history. One that keeps the
       note but rewrites the rest would leave the list's entry beneath holding
       the old address (Back would restore the old wall, section or time), so
       it is refused; the canonicaliser makes it again once the note closes
       and the list is on top. */
    if (options.replace && nextNote && noteOverList(current, before, stored) && viewHref({ ...next, note: null }) !== stored!.noteFrom) return;
    own.current = options.observed ? to : null;
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
    /* THE LIST A NOTE WAS OPENED OVER, so closing the note is a return
       through history (Back agrees with the on-screen close). Set only by the
       push that opens a note from the archive's list — not by a push made
       while a note is already open (the canonicaliser), whose entry beneath
       is not the list — and stored canonically, so the comparisons made
       against `viewHref` agree with it. A replace that moves between notes
       keeps the list it was opened over. */
    const listHref = before ? viewHref({ ...before, note: null }) : null;
    const opensFromList = Boolean(nextNote && !options.replace && before?.open === 'saves' && !before.note && listHref === viewHref({ ...next, note: null }));
    const noteFrom = nextNote ? (opensFromList ? listHref! : options.replace && stored?.scope === current.scope ? stored.noteFrom : undefined) : undefined;
    current.navigate(to, { replace: options.replace, state: { wakaView: { scope: current.scope, query: options.query ?? '', ...(composerFrom ? { composerFrom } : {}),...(shareFrom?{shareFrom}:{}),...(conversationFrom?{conversationFrom}:{}),...(openFrom?{openFrom}:{}),...(noteFrom?{noteFrom}:{}) } } });
  }, []);
  /**
   * PUTTING DOWN AN OPEN SAVED NOTE, onto the list it was opened over.
   *
   * A return through history when the note's own entry sits on the list
   * (Back and this close are then the same step — even across a reload,
   * where the step is a full load of the list's own address). From a cold
   * `?open=saves&note=` link there is no list beneath, so the address is
   * rewritten to the list instead. Called once the note has let go — the
   * commit is the archive's business and happens first.
   */
  const closeNote = useCallback(() => {
    const current = latest.current, before = readViewLocation(current.location.pathname, current.location.search);
    if (!before?.note || traversing(current.location.key)) return;
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    const to = viewHref({ ...before, note: null });
    own.current = null;
    if (stored?.scope === current.scope && stored.noteFrom === to) traverse(-1);
    else write({ ...before, note: null }, { replace: true });
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
    if(traversing(current.location.key))return;
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    /* FROM AN OPEN NOTE, closing the archive is TWO entries when the archive
       was opened from somewhere: the note's and the list's beneath it, stepped
       over in one traversal. With no origin, the note's own entry is replaced
       by the world below (no note entry is left in Forward history). */
    if(noteOverList(current,before,stored)&&stored!.openFrom){traverse(-2);return;}
    if(stored?.scope===current.scope&&stored.openFrom) traverse(-1);
    else{leaving();current.navigate(viewHref({...before,open:null}),{replace:true});}
  },[]);
  /**
   * PUTTING DOWN A CONVERSATION, WHICH IS NOT PUTTING DOWN AN OVERLAY — and
   * assuming it was is how its close button died.
   *
   * Founder: "x button doesnt work to close modal."
   *
   * The conversation reuses the overlay's SHELL but not its address: the
   * other three set `open`, a conversation sets `conversationId`. Its X was
   * wired to `closeOpen`, whose first line is `if(!before?.open) return` — so
   * the press ran, found no `open`, and returned. Rendered, labelled,
   * enabled, silent. That is the fourth time this shape has surfaced here
   * tonight, and every one was a control whose handler did not match the
   * state it was for.
   *
   * `conversationFrom` has been recorded by `write` all along for exactly
   * this, so dismissing walks back through history like every other close and
   * falls back to the world's own address on a cold link.
   */
  const closeConversation=useCallback(()=>{
    const current=latest.current,before=readViewLocation(current.location.pathname,current.location.search);
    if(!before?.conversationId)return;
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    if(stored?.scope===current.scope&&stored.conversationFrom) current.navigate(-1);
    else current.navigate(viewHref({...EMPTY_VIEW,wallId:before.wallId}),{replace:true});
  },[]);
  return { view, href, key: location.key, query, write, closeComposer,closeShare,closeOpen,closeConversation,closeNote, own };
}
