import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createInspiration,
  type ApiInspiration, type ApiInspirationProcessingReceipt, type ApiReflection, type CreateInspirationRequest } from './api';
import { hashStr } from './num';
import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

/**
 * ONE OPERATION, WHERE THERE WERE TWO (2026-10-10).
 *
 * This was a union: an inspiration, or a REFLECTION — a written answer to a
 * generated question, journalled with an `afterId` so the next question knew
 * which answer it followed, and a `continueReflecting` flag so saving could
 * ask for another one. Its only caller was `components/ReflectionFlow.tsx`,
 * which the founder folded: *"Typing happens in one place only: when you
 * correct."*
 *
 * REFLECTIONS STILL EXIST, and are still written — a photo moment's "why"
 * rides the capture itself as `input.reflections`, which is one POST and
 * needs no journal of its own.
 */
export type AuthoredSaveInput = { operation: 'inspiration'; input: CreateInspirationRequest; draft?: { id: string; revision: number } };
export type AuthoredSaveIntent = AuthoredSaveInput & { version: 1; accountId: string; profileId: string; requestId: string; createdAt: number; checksum: number; rejected?: boolean; validationMessage?: string };
export interface AuthoredSaveResult { inspiration: ApiInspiration; reflection: ApiReflection | null; processing?: ApiInspirationProcessingReceipt; recovered: boolean }
type Phase = 'idle' | 'saving' | 'uncertain' | 'diverged' | 'storage_error' | 'invalid' | 'removed' | 'rejected';

/* ═══ THE CLIENT NEVER DECIDES THAT A SAVE DID NOT LAND (2026-10-17) ══════
   The audit at f2afcbe2 found the composer jammed for good after a save lost
   to a dropped network. Four rounds of repair then tried to let go of such a
   save when the client judged it had not landed — a 404 on the status read,
   a timed-out re-send, a 500 "answered" and a settle window, an in-flight
   deadline shared across tabs — and every round, review found a new race in
   which that judgement was wrong and the next save made a second copy.

   THE JUDGEMENT IS NOT NEEDED. The server is idempotent on
   (profile, request id): a second POST of the same id and body returns the
   one row (a replay), a concurrent one is told `save_in_progress`, and a
   different body under the id is refused. So recovery is one move — POST
   the SAME id with the SAME body, read back from disk at the moment of
   sending — on load, on focus, on coming back online, on Retry, and on a
   backoff after a failure. A journal leaves disk only when:

     LANDED  — the server answered 2xx for that id (first time, or a replay);
     REFUSED — it refused that exact request for good (a 4xx other than
               401/403/408/409/429): the save's whole input is offered back;
     REMOVED — the item the id points to was deleted (410);
     or the person explicitly throws it away (`editRejected`, `resetInvalid`).

   A timeout, a network error, a 5xx or `save_in_progress` changes nothing:
   the save stays pending, is shown as not confirmed, and is sent again.
   Two tabs need no coordination beyond the journal on disk — each may
   re-send the same id, and the id lands once.

   EDITED WORDS WHILE A SAVE IS PENDING are asked about ('diverged'). "Save
   as new" starts a NEW journal under a new id; the earlier one stays on disk
   and keeps being sent with its own id until it lands or is refused. Each id
   lands once, so nothing is lost and nothing is doubled. */

/** How long one POST may take before it is treated as not yet known. */
const POST_TIMEOUT_MS = 15_000;
/** The waits between automatic re-sends after a failure, longest repeated. */
export const RESEND_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;

/** The server refused THIS request for good. Not "busy" (409), not "who are
    you" (401/403), not "too slow" (408) or "too many" (429). */
function refused(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 409, 429].includes(error.status);
}

// A corruption checksum, NOT an authorization signature. The server owns
// authorization and input-hash conflict checks; a UUID is never reused for
// different words.
function checksum(value: AuthoredSaveInput): number {
  return hashStr(JSON.stringify({ operation: value.operation, input: value.input, ...(value.draft ? { draft: value.draft } : {}) }));
}
/** The WORDS of a save, without the draft revision: two presses of Save on
    the same words are the same save even if the draft was touched between. */
function wordsSum(value: AuthoredSaveInput): number {
  return hashStr(JSON.stringify({ operation: value.operation, input: value.input }));
}
function validIntent(key: string, prefix: string, scope: ProfileStorageScope, operation: AuthoredSaveInput['operation'], raw: string | null): AuthoredSaveIntent {
  const value = JSON.parse(raw ?? 'null') as AuthoredSaveIntent;
  if (!value || value.version !== 1 || value.accountId !== scope.accountId || value.profileId !== scope.profileId || value.operation !== operation ||
    typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) ||
    key !== prefix + value.requestId || !Number.isFinite(value.createdAt) || !value.input ||
    typeof value.input.text !== 'string' ||
    value.checksum !== checksum(value)) throw new Error('Unverifiable pending save');
  if (value.rejected !== undefined && typeof value.rejected !== 'boolean') throw new Error('Invalid pending save');
  if (value.draft && (typeof value.draft.id !== 'string' || !Number.isSafeInteger(value.draft.revision) || value.draft.revision < 1)) throw new Error('Invalid draft reference');
  return value;
}
function readIntents(prefix: string, scope: ProfileStorageScope, operation: AuthoredSaveInput['operation']) {
  const intents: AuthoredSaveIntent[] = [];
  const invalidKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try { intents.push(validIntent(key, prefix, scope, operation, localStorage.getItem(key))); } catch { invalidKeys.push(key); }
  }
  return { intents: intents.sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId)), invalid: invalidKeys.length > 0, invalidKeys };
}
function persist(prefix: string, intent: AuthoredSaveIntent) {
  const raw = JSON.stringify(intent), key = prefix + intent.requestId;
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error('Pending save was not retained');
}

type Outcome = 'landed' | 'refused' | 'removed' | 'unknown' | 'gone' | 'storage';

/** Durable save journals, re-sent under their own ids until the server
    settles each one. The newest is the one the composer is about. */
export function useAuthoredSave(options: {
  scope: ProfileStorageScope | null; operation: AuthoredSaveInput['operation']; inspirationId?: string; enabled?: boolean;
  journal?:string;
  // Callbacks must settle matching device drafts before returning. IndexedDB
  // media cleanup may be asynchronous; keep the save journal until it finishes.
  // Throwing leaves the journal on disk, to be sent (and replayed) again.
  onResolved: (intent: AuthoredSaveIntent, result: AuthoredSaveResult, initiated: boolean) => void | (() => void) | Promise<void | (() => void)>;
  onRemoved: (intent: AuthoredSaveIntent) => void | Promise<void>;
  onEditRejected?: (intent: AuthoredSaveIntent) => void;
}) {
  const prefix = profileStorageKey(options.scope, `pendingSave:${options.operation}:${encodeURIComponent(options.journal ?? options.inspirationId ?? '')}:`);
  const live = useRef({ ...options, prefix }); live.current = { ...options, prefix };
  const [pending, setPending] = useState<AuthoredSaveIntent | null>(null);
  const pendingRef = useRef<AuthoredSaveIntent | null>(null);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const [busy, setBusy] = useState(false);
  const working = useRef(false), again = useRef(false), mounted = useRef(false), epoch = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const failures = useRef(0), backoff = useRef(0);
  // Edited words waiting on "Save as new"; and the flag that lets one start() go beside the pending save.
  const diverged = useRef<AuthoredSaveInput | null>(null);
  const alongside = useRef(false);

  const show = (intent: AuthoredSaveIntent | null) => { pendingRef.current = intent; setPending(intent); };

  /** Send one journal: the SAME id and the SAME body, read from disk now. */
  const send = useCallback(async (requestId: string, pressed: boolean): Promise<Outcome> => {
    const at = live.current, key = at.prefix;
    if (!key || !at.scope) return 'gone';
    let intent: AuthoredSaveIntent;
    try {
      const raw = localStorage.getItem(key + requestId);
      if (raw === null) return 'gone'; // settled elsewhere — another tab, or a previous pass
      intent = validIntent(key + requestId, key, at.scope, at.operation, raw);
    } catch { return 'storage'; }
    if (intent.rejected) return 'refused';
    const sequence = epoch.current;
    const owns = () => mounted.current && live.current.prefix === key && epoch.current === sequence;
    const controller = new AbortController(); abort.current = controller;
    let timer = 0;
    try {
      const created = await Promise.race([
        createInspiration(intent.input, { profile: intent.profileId, requestId: intent.requestId, signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => { controller.abort(); reject(new Error('Save timed out')); }, POST_TIMEOUT_MS); }),
      ]);
      if (!owns()) return 'unknown';
      if (!created?.id || created.profileId !== intent.profileId) throw new Error('Unexpected saved inspiration');
      const after = await live.current.onResolved(intent, { inspiration: created, reflection: null, processing: created.processing,
        recovered: created.saveRequest?.replayed === true }, pressed);
      if (!owns()) return 'unknown';
      // Cleanup follows matching-draft settlement; a crash before it only
      // means one more replay of the same id, never a second copy.
      localStorage.removeItem(key + intent.requestId);
      if (typeof after === 'function') after();
      return 'landed';
    } catch (error) {
      if (!owns()) return 'unknown';
      if (error instanceof ApiError && error.status === 410 && error.code === 'saved_item_removed') {
        try { await live.current.onRemoved(intent); localStorage.removeItem(key + intent.requestId); return 'removed'; } catch { return 'unknown'; }
      }
      if (refused(error)) {
        // Kept, marked refused: its whole input is offered back by `editRejected`.
        const validationMessage = [error.fieldErrors?.text?.[0], error.fieldErrors?.answer?.[0], error.fieldErrors?.question?.[0]]
          .find((value) => typeof value === 'string')?.slice(0, 180);
        try { persist(key, { ...intent, rejected: true, validationMessage }); } catch { return 'storage'; }
        return 'refused';
      }
      return 'unknown';
    } finally { window.clearTimeout(timer); controller.abort(); }
  }, []);

  /** Send every pending journal once, newest first, then say where things stand. */
  const pump = useCallback(async (pressed = false) => {
    const at = live.current;
    if (!mounted.current || !at.prefix || !at.scope || at.enabled === false || (document.hidden && !pressed)) return;
    if (working.current) { again.current = true; return; }
    window.clearTimeout(backoff.current);
    working.current = true; setBusy(true);
    const sequence = epoch.current;
    let unknown = false, storage = false, removed = false;
    try {
      const tried = new Set<string>();
      for (;;) {
        let found;
        try { found = readIntents(at.prefix, at.scope, at.operation); } catch { storage = true; break; }
        if (found.invalid) setPhase('invalid');
        const next = [...found.intents].reverse().find((item) => !item.rejected && !tried.has(item.requestId));
        show(found.intents.at(-1) ?? null);
        if (!next) break;
        tried.add(next.requestId);
        if (next.requestId === found.intents.at(-1)?.requestId && phaseRef.current !== 'diverged') setPhase('saving');
        const outcome = await send(next.requestId, pressed);
        if (epoch.current !== sequence || !mounted.current) return;
        if (outcome === 'unknown') unknown = true;
        else if (outcome === 'storage') storage = true;
        else if (outcome === 'removed') removed = true;
      }
    } finally {
      if (epoch.current === sequence && mounted.current) { working.current = false; setBusy(false); }
    }
    if (epoch.current !== sequence || !mounted.current) return;
    let left: AuthoredSaveIntent[] = [];
    try { left = readIntents(at.prefix, at.scope, at.operation).intents; } catch { storage = true; }
    const newest = left.at(-1) ?? null;
    show(newest);
    if (storage) setPhase('storage_error');
    else if (phaseRef.current === 'diverged' && newest && !newest.rejected) { /* still asking */ }
    else if (newest?.rejected) setPhase('rejected');
    else if (left.length) setPhase('uncertain');
    else if (removed) setPhase('removed');
    else if (phaseRef.current !== 'invalid') setPhase('idle');
    if (!left.length) diverged.current = null;
    if (unknown && left.some((item) => !item.rejected)) {
      // Not known: send again later, backing off; focus, online and Retry send sooner.
      const wait = RESEND_BACKOFF_MS[Math.min(failures.current, RESEND_BACKOFF_MS.length - 1)]!;
      failures.current += 1;
      backoff.current = window.setTimeout(() => { void pump(); }, wait);
    } else failures.current = 0;
    if (again.current) { again.current = false; void pump(); }
  }, [send]);

  useEffect(() => {
    mounted.current = true; epoch.current += 1; abort.current?.abort(); working.current = false; again.current = false;
    window.clearTimeout(backoff.current); failures.current = 0; diverged.current = null; alongside.current = false;
    show(null); setBusy(false); setPhase('idle'); void pump();
    const wake = () => { void pump(); };
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(prefix ?? '\0')) void pump(); };
    window.addEventListener('focus', wake); window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake); window.addEventListener('storage', onStorage);
    return () => {
      mounted.current = false; epoch.current += 1; abort.current?.abort(); working.current = false; window.clearTimeout(backoff.current);
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('storage', onStorage);
    };
  }, [prefix, options.enabled, pump]);

  const start = useCallback((input: AuthoredSaveInput): boolean => {
    const at = live.current;
    if (!mounted.current || at.enabled === false) return false;
    if (!at.scope || !at.prefix) { setPhase('storage_error'); return false; }
    if (input.operation !== at.operation) return false;
    const besides = alongside.current; alongside.current = false;
    let found;
    try { found = readIntents(at.prefix, at.scope, at.operation); } catch { setPhase('storage_error'); return false; }
    if (found.invalid) { setPhase('invalid'); return false; }
    const held = [...found.intents].reverse().find((item) => !item.rejected);
    if (held && !besides) {
      if (working.current) return false;
      if (wordsSum(input) !== wordsSum(held)) {
        // Edited words while a save is pending: ask, never decide.
        diverged.current = JSON.parse(JSON.stringify(input)) as AuthoredSaveInput;
        setPhase('diverged');
        return false;
      }
      /* THE SAME WORDS, THE CURRENT DRAFT. Re-sent under the same id; the
         journal takes the draft revision it is pressed from, so the composer
         settles when it lands. The body the server sees is unchanged. */
      diverged.current = null;
      if (input.draft?.id !== held.draft?.id || input.draft?.revision !== held.draft?.revision) {
        const { draft: _old, ...rest } = held;
        const moved: AuthoredSaveIntent = { ...rest, ...(input.draft ? { draft: { ...input.draft } } : {}), checksum: 0 };
        moved.checksum = checksum(moved);
        try { persist(at.prefix, moved); } catch { setPhase('storage_error'); return false; }
      }
      if (phaseRef.current === 'diverged') setPhase('uncertain');
      void pump(true);
      return true;
    }
    const copy = JSON.parse(JSON.stringify(input)) as AuthoredSaveInput;
    const intent: AuthoredSaveIntent = { ...copy, ...at.scope, version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(), checksum: checksum(copy) };
    // No request may precede durable ownership of the words: unsaved, unsent.
    try { persist(at.prefix, intent); } catch { setPhase('storage_error'); return false; }
    diverged.current = null;
    show(intent); setPhase('saving'); void pump(true);
    return true;
  }, [pump]);

  /** "Save as new": the stashed edited words go as a NEW save beside the pending one. */
  const saveAsNew = () => {
    const next = diverged.current;
    if (!next) return false;
    diverged.current = null; alongside.current = true;
    return start(next);
  };
  /** The same, for a caller that rebuilds the save from what is on screen at the press. */
  const prepareNew = () => { diverged.current = null; alongside.current = true; return true; };
  const keepEarlier = () => { diverged.current = null; setPhase('uncertain'); return pump(true); };

  /** The refused save's whole input goes back to the person; its journal goes. */
  const editRejected = () => {
    const intent = pendingRef.current, at = live.current;
    if (!intent?.rejected || !at.prefix) return;
    try {
      at.onEditRejected?.(intent);
      localStorage.removeItem(at.prefix + intent.requestId);
      setPhase('idle'); void pump();
    } catch { setPhase('storage_error'); }
  };
  const resetInvalid = () => {
    const at = live.current;
    if (working.current || !at.scope || !at.prefix) return;
    try {
      const found = readIntents(at.prefix, at.scope, at.operation);
      for (const key of found.invalidKeys) {
        // Explicit user reset only. Preserve uninterpreted bytes for recovery,
        // outside the pending namespace; never adopt or submit them as a draft.
        const backup = profileStorageKey(at.scope, `unrecoveredSave:${crypto.randomUUID()}`)!;
        localStorage.setItem(backup, JSON.stringify({ key, raw: localStorage.getItem(key) }));
        localStorage.removeItem(key);
      }
      setPhase('idle'); void pump();
    } catch { setPhase('storage_error'); }
  };
  // Stable, so a caller can dismiss from an effect without re-running it each render.
  const dismiss = useCallback(() => { if (!pendingRef.current) setPhase('idle'); }, []);
  /** Save may be pressed while a save is pending and not in flight: it re-sends or asks. */
  const canResave = Boolean(pending && !busy && !pending.rejected && (phase === 'uncertain' || phase === 'diverged'));

  return { pending, phase, busy, canResave, saveAsNew, prepareNew, keepEarlier, start, retry: () => pump(true),
    check: () => pump(), editRejected, resetInvalid, dismiss };
}
