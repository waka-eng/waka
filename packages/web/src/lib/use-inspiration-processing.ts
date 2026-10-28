import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchInspirationProcessing, retryInspirationProcessing, type ApiInspirationProcessingReceipt, type ApiInspirationProcessingStatus, type ApiTopOfMindRefreshResult } from './api';
import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

interface Reference { profileId: string; inspirationId: string; receiptId?: string }
type Phase = ApiInspirationProcessingStatus['phase'] | 'idle' | 'checking' | 'error' | 'delayed';

/** Metadata-only, account-scoped progress. GET checks never buy model work and
 * readiness is revalidated before the caller can adopt a completed reading. */
export function useInspirationProcessing(scope: ProfileStorageScope | null) {
  const storageKey = profileStorageKey(scope, 'sourceProcessing');
  const key = useRef(storageKey); key.current = storageKey;
  const profile = useRef(scope?.profileId); profile.current = scope?.profileId;
  const reference = useRef<Reference | null>(null);
  const [active, setActive] = useState<Reference | null>(null);
  const [status, setStatus] = useState<ApiInspirationProcessingStatus | null>(null);
  const latest = useRef<ApiInspirationProcessingStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<number>();
  const controller = useRef<AbortController | null>(null);
  const posting = useRef<number | null>(null);
  const viewing = useRef<number | null>(null);

  const remember = useCallback((next: Reference | null) => {
    reference.current = next; setActive(next);
    try { if (key.current) next ? sessionStorage.setItem(key.current, JSON.stringify(next)) : sessionStorage.removeItem(key.current); } catch { /* in-memory progress remains usable */ }
  }, []);
  const stop = useCallback(() => { epoch.current += 1; controller.current?.abort(); window.clearTimeout(timer.current); }, []);
  const clear = useCallback(() => { stop(); remember(null); latest.current = null; setStatus(null); setPhase('idle'); setBusy(false); }, [remember, stop]);

  const begin = useCallback(async (recover = false) => {
    if (!mounted.current || !reference.current || posting.current === epoch.current || viewing.current === epoch.current) return;
    stop(); const sequence = epoch.current, owner = key.current;
    const current = () => mounted.current && epoch.current === sequence && key.current === owner;
    let errors = 0, polls = 0;
    let began = Date.now();
    const poll = async (retry = false): Promise<ApiInspirationProcessingStatus | null> => {
      const ref = reference.current;
      if (!ref || !current() || document.hidden) return null;
      const request = new AbortController(); controller.current = request;
      let timeout = 0;
      setBusy(true); if (retry) posting.current = sequence;
      try {
        const response = await Promise.race([
          (retry ? retryInspirationProcessing : fetchInspirationProcessing)(ref.inspirationId, { profile: ref.profileId, receiptId: ref.receiptId }, request.signal),
          new Promise<never>((_, reject) => { timeout = window.setTimeout(() => { request.abort(); reject(new Error('Status timed out')); }, 15_000); }),
        ]);
        if (!current()) return null;
        if (response.profileId !== ref.profileId || response.inspirationId !== ref.inspirationId ||
          !['queued','processing','waiting','ready','failed','unknown'].includes(response.phase)) throw new Error('Unexpected processing scope');
        if (response.receipt && (response.receipt.profileId !== ref.profileId || response.receipt.inspirationId !== ref.inspirationId)) {
          throw new Error('Unexpected processing receipt');
        }
        const result = response.result;
        if (response.phase === 'ready' && (!result || result.kind !== 'top_of_mind' ||
          !['changed', 'unchanged', 'empty'].includes(result.outcome) || !Number.isSafeInteger(result.version) ||
          (result.topOfMindId === null ? result.version !== 0 || result.outcome !== 'empty' : typeof result.topOfMindId !== 'string' || !result.topOfMindId || result.version < 1))) {
          throw new Error('Missing completed reading');
        }
        const previous = latest.current;
        if (previous?.currentMaterialRevision && response.currentMaterialRevision &&
          BigInt(response.currentMaterialRevision) < BigInt(previous.currentMaterialRevision)) throw new Error('Older processing snapshot');
        if (response.receipt) remember({ ...ref, receiptId: response.receipt.id });
        latest.current = response; setStatus(response); setPhase(response.phase); errors = 0;
        if (['ready','failed','unknown'].includes(response.phase)) return response;
        const due = response.runAfter ? Date.parse(response.runAfter) - Date.now() : 0;
        if (due > 120_000) {
          timer.current = window.setTimeout(() => { began = Date.now(); polls = 0; void poll(); }, Math.min(due, 2_147_000_000));
          return response;
        }
        if (++polls >= 30 || Date.now() - began >= 120_000) { setPhase('delayed'); return response; }
        timer.current = window.setTimeout(() => void poll(), Math.min(10_000, 1000 * 1.5 ** polls));
        return response;
      } catch (error) {
        if (!current()) return null;
        // A removed source or lost access is not a saved thought waiting to be
        // read. Withdraw its device metadata instead of offering a futile retry.
        if (error instanceof ApiError && [403, 404].includes(error.status)) { clear(); return null; }
        if (retry || ++errors >= 3) { setPhase('error'); return null; }
        timer.current = window.setTimeout(() => void poll(), errors * 1000);
        return null;
      } finally {
        window.clearTimeout(timeout); request.abort(); if (posting.current === sequence) posting.current = null;
        if (current()) setBusy(false);
      }
    };
    setPhase('checking'); return poll(recover);
  }, [clear, remember, stop]);

  const track = useCallback((inspirationId: string, receipt?: ApiInspirationProcessingReceipt) => {
    if (!mounted.current || !profile.current || (receipt && (receipt.profileId !== profile.current || receipt.inspirationId !== inspirationId))) return;
    stop(); remember({ profileId: profile.current, inspirationId, receiptId: receipt?.id });
    latest.current = null; setStatus(null); void begin();
  }, [begin, remember, stop]);
  const open = useCallback(async (show: (result: ApiTopOfMindRefreshResult, current: () => boolean) => Promise<void | boolean>) => {
    if (viewing.current === epoch.current || posting.current === epoch.current || !latest.current?.result || latest.current.phase !== 'ready') return;
    const owner = key.current;
    const checking = begin(); const sequence = epoch.current;
    const confirmed = await checking;
    if (epoch.current !== sequence || key.current !== owner || confirmed?.phase !== 'ready' || !confirmed.result) return;
    viewing.current = sequence; setBusy(true);
    const current = () => mounted.current && epoch.current === sequence && key.current === owner;
    try { const adopted = await show(confirmed.result, current); if (current() && adopted !== false) clear(); }
    catch { if (current()) setPhase('error'); }
    finally { if (viewing.current === sequence) viewing.current = null; if (current()) setBusy(false); }
  }, [begin, clear]);

  useEffect(() => {
    mounted.current = true;
    stop(); reference.current = null; latest.current = null; setActive(null); setStatus(null); setPhase('idle'); setBusy(false);
    try {
      const saved = storageKey && sessionStorage.getItem(storageKey);
      if (saved) {
        const ref = JSON.parse(saved) as Reference;
        if (ref.profileId === profile.current && typeof ref.inspirationId === 'string' && (!ref.receiptId || typeof ref.receiptId === 'string')) remember(ref);
      }
    } catch { /* unowned/malformed receipts are never adopted */ }
    if (reference.current) void begin();
    const resume = () => { if (reference.current && !document.hidden) void begin(); };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { mounted.current = false; stop(); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [storageKey, begin, remember, stop]);

  return { active, status, phase, busy, track, clear, open, check: () => begin(), retry: () => begin(true) };
}
