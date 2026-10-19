/**
 * AN OLD `?open=claims` LINK OPENS REVIEW — ONCE, AND ONLY WHILE IT IS ASKED.
 *
 * The claims page became review on 2026-10-15; an address somebody saved
 * still says `open=claims`. Three cases, and the request never outlives its
 * answer. Claims already waiting: review opens now. The queue still loading:
 * the request waits for THAT load to settle and is spent either way — so a
 * queue that turns up later, from some other load, never pops review open
 * unasked. The queue loaded and empty: home is the honest answer.
 *
 * OFFLINE IS A FOURTH CASE, AND IT IS "DROP IT". Offline the queue is never
 * loaded, so the request used to wait — and fire whenever a queue next
 * arrived (a wall switch, a reconnect), long after the person had moved on.
 * A link that arrives offline, or a request still waiting when the page goes
 * offline, is spent on the spot.
 */
import { useEffect, useRef } from 'react';

export function useOpenClaimsLink({ ready, asked, offline, queueLoaded, toReview, consume, openReview }: {
  /** The page has its world and can answer the link. */
  ready: boolean;
  /** The address carries `open=claims`. */
  asked: boolean;
  offline: boolean;
  queueLoaded: boolean;
  toReview: number;
  /** Drop `open` from the address. */
  consume: () => void;
  openReview: () => void;
}): void {
  const pending = useRef(false);
  const latest = useRef({ offline, queueLoaded, toReview, consume, openReview });
  latest.current = { offline, queueLoaded, toReview, consume, openReview };
  useEffect(() => {
    if (!ready || !asked) return;
    const now = latest.current;
    now.consume();
    if (now.toReview > 0 && !now.offline) { pending.current = false; now.openReview(); }
    else pending.current = !now.queueLoaded && !now.offline;
  }, [ready, asked]);
  useEffect(() => {
    if (offline) { pending.current = false; return; }
    if (!pending.current || !queueLoaded) return;
    pending.current = false;
    if (toReview > 0) latest.current.openReview();
  }, [toReview, queueLoaded, offline]);
}
