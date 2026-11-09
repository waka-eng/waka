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
import { IMAGE_WORDS_STATUSES, correctImageWords, fetchImageWords, type ApiImageWords, type ApiImageWordsSummary } from './api/attachments';

const MAX_POLLS = 30;
const MAX_POLL_MS = 120_000;

export type FixOutcome = 'saved' | 'changed' | 'failed';

/** Statuses that will not change by asking: shown as they came. */
const SETTLED: ReadonlySet<string> = new Set(['ready', 'unknown', 'unreadable']);
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
  return row.status === 'reading' || (row.status === 'retrying' && !row.canRetry && !row.retryAfter);
}

/** The inline summary, standing in for the full read until one is needed.
    Fix stays offered (a read-only session's PATCH is refused and said so). */
function fromInline(attachmentId: string, inline: ApiImageWordsSummary): ApiImageWords {
  return { ...inline, attachmentId, inspirationId: '', profileId: '', correctedAt: null, canEdit: true, canRetry: false, retryAfter: null };
}

/**
 * `inline` is the summary the inspiration's detail already carried
 * (`enrichment.words`). When it is settled — ready, unknown, unreadable — it
 * is shown as it is and nothing is asked; only a read still going (reading,
 * retrying) is asked about (code review, 2026-11-08).
 */
export function useImageWords(attachmentId: string | null, inline?: ApiImageWordsSummary | null): {
  words: ApiImageWords | null;
  fix: (text: string) => Promise<FixOutcome>;
} {
  const [words, setWords] = useState<ApiImageWords | null>(null);
  const wordsRef = useRef<ApiImageWords | null>(null);
  wordsRef.current = words;
  const seed = inline && KNOWN.has(inline.status) ? inline : null;
  const seedKey = seed ? `${seed.status}:${seed.revision}:${seed.text ?? ''}` : '';
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    const given = seedRef.current;
    setWords(attachmentId && given ? fromInline(attachmentId, given) : null);
    if (!attachmentId || (given && SETTLED.has(given.status))) return;
    const control = new AbortController();
    let timer = 0, polls = 0;
    const began = Date.now();
    const ask = async () => {
      try {
        const row = await fetchImageWords(attachmentId, control.signal);
        if (control.signal.aborted) return;
        setWords(row);
        if (!readUnderWay(row)) return;
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
  }, [attachmentId, seedKey]);

  const fix = useCallback(async (text: string): Promise<FixOutcome> => {
    const current = wordsRef.current;
    if (!attachmentId || !current) return 'failed';
    try {
      setWords(await correctImageWords(attachmentId, { revision: current.revision, correction: text }));
      return 'saved';
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try { setWords(await fetchImageWords(attachmentId)); } catch { /* the stale words stay on screen */ }
        return 'changed';
      }
      return 'failed';
    }
  }, [attachmentId]);

  return { words, fix };
}
