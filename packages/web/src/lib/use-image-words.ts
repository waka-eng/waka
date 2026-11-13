/**
 * ═══ THE WORDS READ OFF A SAVED SCREENSHOT (design E3, E3′, E4) ═══════════
 *
 * The server reads an image's words AFTER it is saved, so the saved note and
 * the "Kept" bubble are where they appear. This hook reads them for one
 * attachment, keeps asking while the read is still going (`reading`) or
 * queued again (`retrying`), and fixes them.
 *
 * THE SAME BUDGET AS A SAVE'S OWN PROCESSING (`use-inspiration-processing`):
 * at most thirty asks over two minutes, backing off from one second to ten.
 * Past that it stops asking and keeps saying it is still reading; the next
 * time the note is opened it asks again.
 *
 * It never queues a read of its own — see `readUnderWay`.
 *
 * A FIX CARRIES THE REVISION IT WAS MADE AGAINST. If the words changed in
 * the meantime (409 `words_changed`), the fix is not sent over them: the
 * words are read again and the person is told, in plain words, to look and
 * try again — their typed line is kept by the caller.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api/http';
import { IMAGE_WORDS_STATUSES, correctImageWords, fetchImageWords, retryImageWords, type ApiImageWords, type ApiImageWordsSummary } from './api/attachments';

const MAX_POLLS = 30;
const MAX_POLL_MS = 120_000;

export type FixOutcome = 'saved' | 'changed' | 'failed';

/** Statuses that will not change by asking: shown as they came. */
const KNOWN: ReadonlySet<string> = new Set(IMAGE_WORDS_STATUSES);

/**
 * WHETHER ASKING AGAIN CAN SHOW ANYTHING NEW (code review, 2026-11-08).
 * A first read in progress (`reading`), or a read that is queued: `retrying`
 * with no retry allowed and no `retryAfter` (the contract's "something is
 * queued"). `retrying` with a retry allowed means NOTHING is queued, and
 * with a `retryAfter` the budget is spent: in both the answer will not
 * change by asking, so the asking stops.
 *
 * AND THIS SCREEN NEVER QUEUES A READ ITSELF. It used to ask for one on
 * every mount, spending the shared paid budget (three an hour) so the
 * person's own retry met a 429. Only a person's explicit act, or the
 * server's own recovery, queues a read.
 */
function readUnderWay(row: ApiImageWords): boolean {
  return row.status === 'reading' || readQueued(row);
}

/** The inline summary, standing in for the full read until that read is
    back. It cannot say whether this session may edit or retry, so until the
    read answers neither is offered (code review, 2026-11-08: a read-only
    session was offered Fix and met a 403). */
function fromInline(attachmentId: string, inline: ApiImageWordsSummary, known: Abilities | null): ApiImageWords {
  return { ...inline, attachmentId, inspirationId: '', profileId: '', correctedAt: null,
    canEdit: known?.canEdit ?? false, canRetry: known?.canRetry ?? false, retryAfter: known?.retryAfter ?? null };
}

/** What this session may do with these words, as the last full read said. */
type Abilities = Pick<ApiImageWords, 'canEdit' | 'canRetry' | 'retryAfter'>;

export type RetryOutcome = 'queued' | 'limited' | 'failed';

/** Whether a read is queued and will land: the only state worth promising
    "I'll try reading it again" about. */
function readQueued(row: Pick<ApiImageWords, 'status' | 'canRetry' | 'retryAfter'>): boolean {
  /* 'retrying' means a read is queued (the API says 'failed' when nothing
     is); `canRetry`/`retryAfter` stay as a guard for an older server. */
  return row.status === 'retrying' && !row.canRetry && !row.retryAfter;
}

/**
 * `inline` is the summary the inspiration's detail already carried
 * (`enrichment.words`): shown at once. The words are then read ONCE, to
 * learn whether this session may Fix or retry (the inline summary cannot
 * say), and asked about again only while a read is under way.
 *
 * NEWER WRITES WIN (code review, 2026-11-08). A poll that left before a Fix
 * or a retry and answers after it carries the state from before; every
 * write bumps a sequence, and an answer to an older one is dropped.
 */
export function useImageWords(attachmentId: string | null, inline?: ApiImageWordsSummary | null): {
  words: ApiImageWords | null;
  fix: (text: string) => Promise<FixOutcome>;
  retry: () => Promise<RetryOutcome>;
} {
  const [words, setWords] = useState<ApiImageWords | null>(null);
  const wordsRef = useRef<ApiImageWords | null>(null);
  wordsRef.current = words;
  const seed = inline && KNOWN.has(inline.status) ? inline : null;
  const seedKey = seed ? `${seed.status}:${seed.revision}:${seed.text ?? ''}` : '';
  const seedRef = useRef(seed);
  seedRef.current = seed;
  /** Bumped by every write (Fix, retry); a read begun before it is stale. */
  const writes = useRef(0);
  /** Bumped by a retry, to start following the read it queued. */
  const [follow, setFollow] = useState(0);
  const followed = useRef(0);
  /* KEPT ACROSS A NEW INLINE SUMMARY (code review, 2026-11-08): a Fix brings
     a new summary, and resetting the abilities to "none" made Fix flicker
     away until the read came back. Unknown only before the first read. */
  const known = useRef<{ id: string; abilities: Abilities } | null>(null);
  const remember = (row: ApiImageWords) => {
    known.current = { id: row.attachmentId, abilities: { canEdit: row.canEdit, canRetry: row.canRetry, retryAfter: row.retryAfter } };
    setWords(row);
  };

  useEffect(() => {
    const given = seedRef.current;
    const abilities = known.current?.id === attachmentId ? known.current.abilities : null;
    if (followed.current === follow) setWords(attachmentId && given ? fromInline(attachmentId, given, abilities) : null);
    followed.current = follow;
    if (!attachmentId) return;
    const control = new AbortController();
    let timer = 0, polls = 0;
    const began = Date.now();
    const ask = async () => {
      const sentAt = writes.current;
      try {
        const row = await fetchImageWords(attachmentId, control.signal);
        if (control.signal.aborted) return;
        /* AN ANSWER OLDER THAN A WRITE IS DROPPED, BUT THE ASKING GOES ON
           while what is on screen still needs it (code review, 2026-11-08):
           returning here stopped the polling for good, even when the write
           it raced with then failed and the read was still on its way. */
        if (sentAt !== writes.current) {
          const shown = wordsRef.current;
          if (shown && !readUnderWay(shown)) return;
        } else {
          remember(row);
          if (!readUnderWay(row)) return;
        }
      } catch (reason) {
        if (control.signal.aborted) return;
        /* A PERMANENT REFUSAL ENDS THE ASKING: gone (404), not yours (403),
           not an image (4xx). Only a timeout or a rate limit is worth asking
           about again. */
        if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 408 && reason.status !== 429) return;
      }
      if (++polls >= MAX_POLLS || Date.now() - began >= MAX_POLL_MS) return;
      timer = window.setTimeout(() => void ask(), Math.min(10_000, 1000 * 1.5 ** polls));
    };
    void ask();
    return () => { control.abort(); window.clearTimeout(timer); };
  }, [attachmentId, seedKey, follow]);

  const fix = useCallback(async (text: string): Promise<FixOutcome> => {
    const current = wordsRef.current;
    if (!attachmentId || !current) return 'failed';
    writes.current += 1;
    try {
      const fixed = await correctImageWords(attachmentId, { revision: current.revision, correction: text });
      writes.current += 1;
      remember(fixed);
      return 'saved';
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try { remember(await fetchImageWords(attachmentId)); } catch { /* the stale words stay on screen */ }
        return 'changed';
      }
      return 'failed';
    }
  }, [attachmentId]);

  /* A READ AGAIN, ONLY BECAUSE THE PERSON ASKED (code review, 2026-11-08):
     retrying with nothing queued used to promise a retry that never came. */
  const retry = useCallback(async (): Promise<RetryOutcome> => {
    if (!attachmentId) return 'failed';
    writes.current += 1;
    try {
      const queued = await retryImageWords(attachmentId);
      writes.current += 1;
      remember(queued);
      setFollow(n => n + 1);
      return 'queued';
    } catch (reason) {
      return reason instanceof ApiError && reason.status === 429 ? 'limited' : 'failed';
    }
  }, [attachmentId]);

  return { words, fix, retry };
}
