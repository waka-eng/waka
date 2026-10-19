import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createInspiration, fetchInspiration, fetchInspirationSaveRequest,
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
 * `reflect: boolean` went too, and it is worth saying why separately: it told
 * this hook to open a question sheet after the save landed, and
 * `InspirationComposer` has only ever passed `false`. A field that nothing
 * could set, read by a branch nothing could reach.
 *
 * REFLECTIONS STILL EXIST, and are still written — a photo moment's "why"
 * rides the capture itself as `input.reflections`, which is one POST and
 * needs no journal of its own. What is gone is the second, separately
 * journalled act.
 */
export type AuthoredSaveInput = { operation: 'inspiration'; input: CreateInspirationRequest; draft?: { id: string; revision: number } };
type SavedReference = { inspirationId: string; reflectionId: string | null; processing?: ApiInspirationProcessingReceipt };
export type AuthoredSaveIntent = AuthoredSaveInput & { version: 1; accountId: string; profileId: string; requestId: string; createdAt: number; checksum: number; acknowledged?: SavedReference; rejected?: boolean; validationMessage?: string };
export interface AuthoredSaveResult { inspiration: ApiInspiration; reflection: ApiReflection | null; processing?: ApiInspirationProcessingReceipt; recovered: boolean }
type Phase = 'idle' | 'checking' | 'saving' | 'uncertain' | 'storage_error' | 'unsupported' | 'invalid' | 'removed' | 'rejected';

// A corruption checksum, NOT an authorization signature. The server owns
// authorization and input-hash conflict checks; UUIDs are never reused here.
function checksum(value: AuthoredSaveInput): number {
  return hashStr(JSON.stringify({ operation: value.operation, input: value.input, ...(value.draft ? { draft: value.draft } : {}) }));
}
function readIntents(prefix: string, scope: ProfileStorageScope, operation: AuthoredSaveInput['operation']) {
  const intents: AuthoredSaveIntent[] = [];
  const invalidKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key)!) as AuthoredSaveIntent;
      if (value.version !== 1 || value.accountId !== scope.accountId || value.profileId !== scope.profileId || value.operation !== operation ||
        typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) ||
        key !== prefix + value.requestId || !Number.isFinite(value.createdAt) || !value.input ||
        typeof value.input.text !== 'string' ||
        value.checksum !== checksum(value)) throw new Error('Unverifiable pending save');
      if ((value.rejected !== undefined && typeof value.rejected !== 'boolean') ||
        (value.acknowledged && (typeof value.acknowledged.inspirationId !== 'string' || !value.acknowledged.inspirationId || value.rejected))) throw new Error('Invalid saved reference');
      if (value.draft && (typeof value.draft.id !== 'string' || !Number.isSafeInteger(value.draft.revision) || value.draft.revision < 1)) throw new Error('Invalid draft reference');
      intents.push(value);
    } catch { invalidKeys.push(key); }
  }
  return { intents: intents.sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId)), invalid: invalidKeys.length > 0, invalidKeys };
}
function persist(prefix: string, intent: AuthoredSaveIntent) {
  const raw = JSON.stringify(intent), key = prefix + intent.requestId;
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error('Pending save was not retained');
}

/** One visible pending intent, with separate durable keys for simultaneous
 * tabs. Mount, focus, `online`, storage events and Retry all re-POST the
 * journal READ FROM DISK under its original identity (the server dedupes on
 * it), after verifying the server supports it. A journal leaves disk only when
 * it lands, is refused, is removed, or the person discards it — never on 404.
 * See docs/plans/save-recovery.md. */
export function useAuthoredSave(options: {
  scope: ProfileStorageScope | null; operation: AuthoredSaveInput['operation']; inspirationId?: string; enabled?: boolean;
  journal?:string;
  // Callbacks must settle matching device drafts before returning. IndexedDB
  // media cleanup may be asynchronous; keep the save journal until it finishes.
  // Throwing leaves the request available for safe reconciliation on return.
  onResolved: (intent: AuthoredSaveIntent, result: AuthoredSaveResult, initiated: boolean) => void | (() => void) | Promise<void | (() => void)>;
  onRemoved: (intent: AuthoredSaveIntent) => void | Promise<void>;
  onEditRejected?: (intent: AuthoredSaveIntent) => void;
}) {
  const prefix = profileStorageKey(options.scope, `pendingSave:${options.operation}:${encodeURIComponent(options.journal ?? options.inspirationId ?? '')}:`);
  const live = useRef({ ...options, prefix }); live.current = { ...options, prefix };
  const [pending, setPending] = useState<AuthoredSaveIntent | null>(null);
  const intentRef = useRef<AuthoredSaveIntent | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const working = useRef(false), mounted = useRef(false), epoch = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const refresh = useRef<() => unknown>(() => {});

  // `write` false: this journal is gone from disk (another tab landed,
  // refused or discarded it), so it is only read, never re-sent.
  const run = useCallback(async (intent: AuthoredSaveIntent, write: boolean, pressed: boolean) => {
    const owner = live.current, key = owner.prefix;
    if (!mounted.current || working.current || !key || !owner.scope || owner.enabled === false || (document.hidden && !write)) return;
    const release = () => { intentRef.current = null; setPending(null); setPhase('idle'); };
    if (intent.rejected) { if (write) setPhase('rejected'); else release(); return; }
    working.current = true; setBusy(true); setPhase('checking');
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const sequence = ++epoch.current;
    const owns = () => mounted.current && live.current.prefix === key && epoch.current === sequence;
    const current = () => { if (!owns() || controller.signal.aborted) throw new Error('Save observation superseded'); };
    const scoped = { profile: intent.profileId };
    let timeout = 0;
    let attempted = false;
    let rejectAborted!: () => void;
    const cancelled = new Promise<never>((_, reject) => { rejectAborted = () => reject(new Error('Save observation cancelled')); });
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
    const work = async (): Promise<AuthoredSaveResult | null> => {
      let saved = intent.acknowledged;
      let created: ApiInspiration | null = null;
      try {
        const found = await fetchInspirationSaveRequest(intent.requestId, scoped, controller.signal); current();
        if (found.operation !== intent.operation) throw new Error('Unexpected save identity');
        saved = { inspirationId: found.inspirationId, reflectionId: found.reflectionId, processing: found.processing };
      } catch (error) {
        current();
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        if (error.code !== 'save_not_found') throw new ApiError({ status: 404, code: 'save_protocol_unavailable', message: 'Save recovery is unavailable' });
      }
      if (!saved) {
        if (!write) return null;
        current(); setPhase('saving');
        attempted = true;
        const saveOptions = { ...scoped, requestId: intent.requestId, signal: controller.signal };
        created = await createInspiration(intent.input, saveOptions); current();
        if (!created?.id || created.profileId !== intent.profileId) throw new Error('Unexpected saved inspiration');
        saved = { inspirationId: created.id, reflectionId: null, processing: created.processing };
        const acknowledged = { ...intent, acknowledged: saved };
        // The original durable key is already safe to reconcile if quota fills
        // after the POST. Retain the acknowledgment in memory in that case.
        try { persist(key, acknowledged); } catch { /* original intent remains */ }
        intentRef.current = acknowledged; setPending(acknowledged);
      }
      current();
      const inspiration = created ?? await fetchInspiration(saved.inspirationId, scoped, controller.signal); current();
      if (inspiration.id !== saved.inspirationId || inspiration.profileId !== intent.profileId) throw new Error('Unexpected saved owner');
      /* The 410 that a MISSING ANSWER used to raise here is gone with the
         reflection operation. The server still raises its own 410 from
         `GET /inspirations/save-requests/:id` when the thing a journalled
         save points at has been deleted, and `onRemoved` still answers it —
         that is the path this client can still walk. */
      return { inspiration, reflection: null, processing: saved.processing, recovered: !created || created.saveRequest?.replayed === true };
    };
    try {
      const result = await Promise.race([work(), cancelled, new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error('Save check timed out')); }, 15_000);
      })]);
      current();
      if (!result) { release(); return; }
      const afterSettlement = await live.current.onResolved(intent, result, pressed);
      current();
      // Cleanup follows matching-draft settlement; a crash before cleanup can
      // only cause a read/replay, never a newly identified copy of these words.
      localStorage.removeItem(key + intent.requestId);
      if (owns()) { intentRef.current = null; setPending(null); setPhase('idle'); }
      if (owns() && typeof afterSettlement === 'function') afterSettlement();
    } catch (error) {
      if (!owns()) return;
      if (error instanceof ApiError && error.status === 410 && error.code === 'saved_item_removed') {
        try {
          await live.current.onRemoved(intent);
          current();
          localStorage.removeItem(key + intent.requestId);
          intentRef.current = null; setPending(null); setPhase('removed');
        } catch { setPhase('storage_error'); }
      } else if (attempted && error instanceof ApiError && !intentRef.current?.acknowledged &&
        (error.status === 400 || (error.status === 409 && error.code === 'save_request_conflict'))) {
        // Both are definitive: this id can never land as written. Offer the words back.
        const validationMessage = [error.fieldErrors?.text?.[0], error.fieldErrors?.answer?.[0], error.fieldErrors?.question?.[0]].find((value) => typeof value === 'string')?.slice(0, 180);
        const rejected = { ...intent, rejected: true, validationMessage };
        try { persist(key, rejected); } catch { /* the original immutable intent is still retained */ }
        intentRef.current = rejected; setPending(rejected); setPhase('rejected');
      } else setPhase(error instanceof ApiError && error.code === 'save_protocol_unavailable' ? 'unsupported' : 'uncertain');
    } finally {
      window.clearTimeout(timeout); controller.signal.removeEventListener('abort', rejectAborted); controller.abort();
      if (owns()) { working.current = false; setBusy(false); if (!intentRef.current) refresh.current(); }
    }
  }, []);

  const scan = useCallback(async (pressed = false) => {
    const at = live.current;
    if (!mounted.current || working.current || !at.prefix || !at.scope || at.enabled === false || document.hidden) return;
    try {
      const found = readIntents(at.prefix, at.scope, at.operation), held = intentRef.current;
      const next = held ? found.intents.find((intent) => intent.requestId === held.requestId) : found.intents[0];
      if (next) { intentRef.current = next; setPending(next); await run(next, true, pressed); }
      else if (held) await run(held, false, pressed);
      else if (found.invalid) setPhase('invalid');
    } catch { setPhase('storage_error'); }
  }, [run]);
  refresh.current = scan;

  useEffect(() => {
    mounted.current = true; epoch.current += 1; abort.current?.abort(); working.current = false;
    intentRef.current = null; setPending(null); setBusy(false); setPhase('idle'); void scan();
    const onFocus = () => { void scan(); };
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(prefix ?? '\0')) void scan(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus); window.addEventListener('storage', onStorage);
    window.addEventListener('online', onFocus);
    return () => {
      mounted.current = false; epoch.current += 1; abort.current?.abort(); working.current = false;
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onFocus);
    };
  }, [prefix, options.enabled, scan]);

  const start = useCallback((input: AuthoredSaveInput): boolean => {
    const at = live.current;
    if (!mounted.current || working.current || intentRef.current || at.enabled === false) return false;
    if (!at.scope || !at.prefix) { setPhase('unsupported'); return false; }
    try {
      const found = readIntents(at.prefix, at.scope, at.operation);
      if (found.invalid || found.intents.length) { void scan(); return false; }
      if (input.operation !== at.operation) throw new Error('Unexpected save target');
      const copy = JSON.parse(JSON.stringify(input)) as AuthoredSaveInput;
      const intent: AuthoredSaveIntent = { ...copy, ...at.scope, version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(), checksum: checksum(copy) };
      persist(at.prefix, intent); // no request may precede durable ownership/words
      intentRef.current = intent; setPending(intent); void run(intent, true, true);
      return true;
    } catch { setPhase('storage_error'); return false; }
  }, [run, scan]);

  const editRejected = () => {
    const intent = intentRef.current, at = live.current;
    if (!intent?.rejected || working.current || !at.prefix) return;
    try {
      at.onEditRejected?.(intent);
      localStorage.removeItem(at.prefix + intent.requestId);
      intentRef.current = null; setPending(null); setPhase('idle');
    } catch { setPhase('storage_error'); }
  };
  const resetInvalid = () => {
    const at = live.current;
    if (working.current || intentRef.current || !at.scope || !at.prefix) return;
    try {
      const found = readIntents(at.prefix, at.scope, at.operation);
      for (const key of found.invalidKeys) {
        // Explicit user reset only. Preserve uninterpreted bytes for recovery,
        // outside the pending namespace; never adopt or submit them as a draft.
        const backup = profileStorageKey(at.scope, `unrecoveredSave:${crypto.randomUUID()}`)!;
        localStorage.setItem(backup, JSON.stringify({ key, raw: localStorage.getItem(key) }));
        localStorage.removeItem(key);
      }
      setPhase('idle'); void scan();
    } catch { setPhase('storage_error'); }
  };

  return { pending, phase, busy, start, retry: () => scan(true),
    check: () => { void scan(); }, editRejected, resetInvalid, dismiss: () => { if (!intentRef.current) setPhase('idle'); } };
}
