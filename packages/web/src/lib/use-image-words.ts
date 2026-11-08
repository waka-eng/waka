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
 * `retrying` WITH `canRetry` means nothing is queued: it asks for one more
 * read, once per attachment per sitting (the server caps retries too).
 *
 * A FIX CARRIES THE REVISION IT WAS MADE AGAINST. If the words changed in
 * the meantime (409 `words_changed`), the fix is not sent over them: the
 * words are read again and the person is told, in plain words, to look and
 * try again — their typed line is kept by the caller.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api/http';
import { correctImageWords, fetchImageWords, retryImageWords, type ApiImageWords } from './api/attachments';

const MAX_POLLS = 30;
const MAX_POLL_MS = 120_000;

export type FixOutcome = 'saved' | 'changed' | 'failed';

export function useImageWords(attachmentId: string | null): {
  words: ApiImageWords | null;
  fix: (text: string) => Promise<FixOutcome>;
} {
  const [words, setWords] = useState<ApiImageWords | null>(null);
  const retried = useRef(new Set<string>());
  const wordsRef = useRef<ApiImageWords | null>(null);
  wordsRef.current = words;

  useEffect(() => {
    setWords(null);
    if (!attachmentId) return;
    const control = new AbortController();
    let timer = 0, polls = 0;
    const began = Date.now();
    const ask = async () => {
      try {
        let row = await fetchImageWords(attachmentId, control.signal);
        if (row.status === 'retrying' && row.canRetry && !retried.current.has(attachmentId)) {
          retried.current.add(attachmentId);
          row = await retryImageWords(attachmentId, control.signal).catch(() => row);
        }
        if (control.signal.aborted) return;
        setWords(row);
        if (row.status !== 'reading' && row.status !== 'retrying') return;
      } catch {
        if (control.signal.aborted) return;
      }
      if (++polls >= MAX_POLLS || Date.now() - began >= MAX_POLL_MS) return;
      timer = window.setTimeout(() => void ask(), Math.min(10_000, 1000 * 1.5 ** polls));
    };
    void ask();
    return () => { control.abort(); window.clearTimeout(timer); };
  }, [attachmentId]);

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
