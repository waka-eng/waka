import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EMPTY_VIEW, readViewLocation, viewHref, type ViewLocation } from './view-location';

/** Set while `closeOpen` is putting the whole archive down over an open
    note's entry; read and cleared by SavesOverlay's `NoteHistory`. */
export const archiveLeaving:{now:boolean;thenReplace:{to:string;from:string;at:number}|null}={now:false,thenReplace:null};
/** How long a pending cold-link replace may wait for its own step back. */
const THEN_REPLACE_MS = 2_000;
interface StoredView { scope: string; query: string; composerFrom?: string;shareFrom?:string;conversationFrom?:string;openFrom?:string }
/** Router owns browser history; the world owns rendering and restoration. */
export function useViewNavigation(scope: string | null) {
  const location = useLocation(), navigate = useNavigate();
  const href = location.pathname + location.search;
  const view = useMemo(() => readViewLocation(location.pathname, location.search), [href]);
  const own = useRef<string | null>(null);
  /* THE SECOND HALF OF A COLD-LINK CLOSE (see `closeOpen`): once the step
     back over the note's entry has landed on the list's, that entry becomes
     the world — so history holds the closed world alone, as it did before
     notes had entries of their own. */
  /* ONE STEP, ONCE (review): the replace is for the landing of the step back
     it was armed with, and nothing later. Whatever the next location is, the
     arming is spent; it acts only if that landing is the list's entry (no
     note mark) and came within a moment of the press. */
  useEffect(() => {
    const armed = archiveLeaving.thenReplace;
    if (!armed || location.key === armed.from) return;
    archiveLeaving.thenReplace = null;
    if (Date.now() - armed.at > THEN_REPLACE_MS || (location.state as { savesNote?: string } | null)?.savesNote) return;
    if (!new URLSearchParams(location.search).get('open')) return;
    navigate(armed.to, { replace: true, state: location.state });
  }, [location.key]);
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
    /* AN OPEN SAVE'S MARK SURVIVES A REWRITE OF ITS OWN ENTRY. SavesOverlay's
       `NoteHistory` marks the entry it pushed with `savesNote`; the world
       re-writes the same address in place (to record the seek query), and a
       state built from scratch here dropped the mark — which reads exactly
       like Back, so the note closed itself the moment it opened. */
    const savesNote = options.replace && to === previous ? (current.location.state as { savesNote?: string } | null)?.savesNote : undefined;
    current.navigate(to, { replace: options.replace, state: { ...(savesNote ? { savesNote } : {}), wakaView: { scope: current.scope, query: options.query ?? '', ...(composerFrom ? { composerFrom } : {}),...(shareFrom?{shareFrom}:{}),...(conversationFrom?{conversationFrom}:{}),...(openFrom?{openFrom}:{}) } } });
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
    /* An open saved note has its own entry on top of the list's (see
       SavesOverlay's `NoteHistory`); putting the whole archive down steps
       over both, so Escape still lands where the archive was opened from. */
    const noteOnTop=Boolean((current.location.state as {savesNote?:string}|null)?.savesNote);
    /* And the note must not pop its own entry as it closes on the way out:
       the router's address update is a transition, so the note's close can
       commit first and would step back a THIRD time (or undo the replace). */
    if(noteOnTop)archiveLeaving.now=true;
    if(stored?.scope===current.scope&&stored.openFrom) current.navigate(noteOnTop?-2:-1);
    /* A COLD LINK with a note open (review): replacing the note's entry left
       the list's `?open=saves` underneath, so Back reopened the archive that
       Escape had just closed. Step back over the note first; the effect above
       turns the list's entry into the world when it lands. */
    else if(noteOnTop){archiveLeaving.thenReplace={to:viewHref({...before,open:null}),from:current.location.key,at:Date.now()};current.navigate(-1);}
    else current.navigate(viewHref({...before,open:null}),{replace:true});
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
    else current.navigate(viewHref({...EMPTY_VIEW}),{replace:true});
  },[]);
  return { view, href, key: location.key, query, write, closeComposer,closeShare,closeOpen,closeConversation, own };
}
