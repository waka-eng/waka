import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EMPTY_VIEW, readViewLocation, viewHref, type ViewLocation } from './view-location';

interface StoredView { scope: string; query: string; composerFrom?: string;shareFrom?:string;conversationFrom?:string;openFrom?:string;noteFrom?:string;noteDoc?:string }
/* WHICH PAGE LOAD PUSHED AN ENTRY. An entry pushed before a reload belongs to
   the pre-reload document, so stepping back onto it is a full page load, not
   a pop this document hears. Anything that steps back and then acts on the
   entry it lands on may only do so when that entry is this document's. */
const DOCUMENT = Math.random().toString(36).slice(2);
/** How long a step back may take to land before what waits on it runs anyway. */
const POP_LIMIT_MS = 1500;
type WriteOptions = { replace?: boolean; query?: string; observed?: boolean };
/** Router owns browser history; the world owns rendering and restoration. */
export function useViewNavigation(scope: string | null) {
  const location = useLocation(), navigate = useNavigate();
  const href = location.pathname + location.search;
  const view = useMemo(() => readViewLocation(location.pathname, location.search), [href]);
  const own = useRef<string | null>(null);
  const latest = useRef({ location, navigate, scope }); latest.current = { location, navigate, scope };
  /* ═══ A STEP BACK OVER THE NOTE, THEN THE ACT ══════════════════════════
     An open saved note is its own entry (`note=`), pushed over the archive's
     list. A REPLACE made from it that drops the note — the bar moving you to
     chats, the archive closing on a cold link — would rewrite only the note's
     entry and leave the list's entry beneath it, so the next Back would
     reopen the archive you just left. So the act steps back over the note
     first (a traversal, which adds no entry and needs no gesture) and runs
     once the router has landed on the list. One slot: a second act asked for
     while the step is in flight replaces the first rather than stepping
     again. */
  const afterPop = useRef<{ from: string; run: () => void; timer: number } | null>(null);
  /* Set while a late act runs where it stands, so it does not ask to step
     back a second time. */
  const overNote = useRef(false);
  useEffect(() => {
    const waiting = afterPop.current;
    if (!waiting || waiting.from === location.key) return;
    afterPop.current = null; window.clearTimeout(waiting.timer); waiting.run();
  }, [location.key]);
  useEffect(() => () => { if (afterPop.current) window.clearTimeout(afterPop.current.timer); afterPop.current = null; }, []);
  const stepBackThen = useCallback((run: () => void) => {
    const waiting = afterPop.current;
    if (waiting) { waiting.run = run; return; }
    const from = latest.current.location.key;
    /* A step that never lands (nothing heard it) must not hold every later
       write hostage: the act then runs where it stands. */
    const timer = window.setTimeout(() => { if (afterPop.current?.from === from) { const late = afterPop.current; afterPop.current = null; overNote.current = true; try { late.run(); } finally { overNote.current = false; } } }, POP_LIMIT_MS);
    afterPop.current = { from, run, timer };
    latest.current.navigate(-1);
  }, []);
  /** Whether the entry under this one is the archive's list, pushed by this
      page load — the only case a step back can be followed by an act. */
  const noteOverList = (current: typeof latest.current, before: ViewLocation | null, stored: StoredView | undefined) =>
    Boolean(before?.note && stored?.scope === current.scope && stored.noteDoc === DOCUMENT
      && stored.noteFrom === viewHref({ ...before, note: null }));
  const query = (() => {
    const state = location.state as { wakaView?: StoredView } | null;
    return scope && state?.wakaView?.scope === scope && typeof state.wakaView.query === 'string' ? state.wakaView.query.slice(0, 200) : '';
  })();
  const writeRef = useRef<(next: ViewLocation, options?: WriteOptions) => void>(() => undefined);
  const write = useCallback((next: ViewLocation, options: WriteOptions = {}) => {
    const current = latest.current;
    if (!current.scope) return;
    if (afterPop.current) { afterPop.current.run = () => writeRef.current(next, options); return; }
    const to = viewHref(next);
    const previous = current.location.pathname + current.location.search;
    if (to === previous && options.query === undefined) return;
    const before = readViewLocation(current.location.pathname, current.location.search);
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    const [toPath = '/', toSearch] = to.split('?');
    const nextNote = readViewLocation(toPath, toSearch ? `?${toSearch}` : '')?.note ?? null;
    if (options.replace && !overNote.current && noteOverList(current, before, stored)) {
      /* Dropping the note: step back onto the list, then replace THAT. */
      if (!nextNote) { own.current = null; stepBackThen(() => writeRef.current(next, options)); return; }
      /* Keeping a note but rewriting the rest would leave the list's entry
         beneath holding the old address (Back would restore the old wall,
         section or time). Refused: such a rewrite waits until the note is
         closed and the list is on top, where it is made again. */
      if (viewHref({ ...next, note: null }) !== stored!.noteFrom) return;
    }
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
    /* THE LIST A NOTE WAS OPENED OVER, and which page load pushed it — so
       closing the note is a return through history (Back agrees with the
       on-screen close), and a step back is only followed by an act when it
       stays inside this document. A replace that moves between notes keeps
       the list it was opened over. */
    const pushedNote = Boolean(nextNote && !options.replace);
    const noteFrom = nextNote ? (pushedNote ? previous : stored?.scope === current.scope ? stored.noteFrom : undefined) : undefined;
    const noteDoc = noteFrom ? (pushedNote ? DOCUMENT : stored?.noteDoc) : undefined;
    current.navigate(to, { replace: options.replace, state: { wakaView: { scope: current.scope, query: options.query ?? '', ...(composerFrom ? { composerFrom } : {}),...(shareFrom?{shareFrom}:{}),...(conversationFrom?{conversationFrom}:{}),...(openFrom?{openFrom}:{}),...(noteFrom?{noteFrom}:{}),...(noteDoc?{noteDoc}:{}) } } });
  }, []);
  writeRef.current = write;
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
    if (!before?.note) return;
    const stored = (current.location.state as { wakaView?: StoredView } | null)?.wakaView;
    const to = viewHref({ ...before, note: null });
    own.current = null;
    if (stored?.scope === current.scope && stored.noteFrom === to) current.navigate(-1);
    else writeRef.current({ ...before, note: null }, { replace: true });
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
    if(afterPop.current){afterPop.current.run=()=>closeOpenRef.current();return;}
    const stored=(current.location.state as {wakaView?:StoredView}|null)?.wakaView;
    own.current=null;
    /* FROM AN OPEN NOTE, closing the archive is TWO entries: the note's and
       the list's beneath it. Both are stepped over in one traversal when the
       archive itself was opened from somewhere; from a cold `?open=saves`
       link (no origin) the step lands on the list and the list is then
       rewritten to the world, so no entry is left that reopens it. */
    if(before.note&&stored?.scope===current.scope&&stored.noteFrom===viewHref({...before,note:null})){
      if(stored.openFrom){current.navigate(-2);return;}
      if(!overNote.current&&noteOverList(current,before,stored)){stepBackThen(()=>closeOpenRef.current());return;}
    }
    if(stored?.scope===current.scope&&stored.openFrom) current.navigate(-1);
    else current.navigate(viewHref({...before,open:null}),{replace:true});
  },[]);
  const closeOpenRef=useRef(closeOpen);closeOpenRef.current=closeOpen;
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
  return { view, href, key: location.key, query, write, closeComposer,closeShare,closeOpen,closeConversation,closeNote, own };
}
