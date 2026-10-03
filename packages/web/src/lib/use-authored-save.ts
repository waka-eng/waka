import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createInspiration, createReflection, fetchInspiration, fetchInspirationSaveRequest,
  type ApiInspiration, type ApiInspirationProcessingReceipt, type ApiReflection, type CreateInspirationRequest, type CreateReflectionRequest } from './api';
import { hashStr } from './num';
import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

export type AuthoredSaveInput = { operation: 'inspiration'; input: CreateInspirationRequest; reflect: boolean; draft?: { id: string; revision: number } }
  | { operation: 'reflection'; inspirationId: string; input: CreateReflectionRequest; afterId: string | null; continueReflecting: boolean };
type SavedReference = { inspirationId: string; reflectionId: string | null; processing?: ApiInspirationProcessingReceipt };
export type AuthoredSaveIntent = AuthoredSaveInput & { version: 1; accountId: string; profileId: string; requestId: string; createdAt: number; checksum: number; acknowledged?: SavedReference; rejected?: boolean; validationMessage?: string };
export interface AuthoredSaveResult { inspiration: ApiInspiration; reflection: ApiReflection | null; processing?: ApiInspirationProcessingReceipt; recovered: boolean }
type Phase = 'idle' | 'checking' | 'saving' | 'uncertain' | 'storage_error' | 'unsupported' | 'invalid' | 'removed' | 'rejected';

// A corruption checksum, NOT an authorization signature. The server owns
// authorization and input-hash conflict checks; UUIDs are never reused here.
function checksum(value: AuthoredSaveInput): number {
  return hashStr(JSON.stringify(value.operation === 'inspiration'
    ? { operation: value.operation, input: value.input, reflect: value.reflect, ...(value.draft ? { draft: value.draft } : {}) }
    : { operation: value.operation, input: value.input, inspirationId: value.inspirationId, afterId: value.afterId, continueReflecting: value.continueReflecting }));
}
function readIntents(prefix: string, scope: ProfileStorageScope, operation: AuthoredSaveInput['operation'], inspirationId?: string) {
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
        (value.operation === 'inspiration' ? typeof value.input.text !== 'string' : value.inspirationId !== inspirationId || typeof value.input.question !== 'string') ||
        value.checksum !== checksum(value)) throw new Error('Unverifiable pending save');
      if ((value.rejected !== undefined && typeof value.rejected !== 'boolean') ||
        (value.acknowledged && (typeof value.acknowledged.inspirationId !== 'string' || !value.acknowledged.inspirationId || value.rejected ||
          (value.operation === 'reflection' && (value.acknowledged.inspirationId !== inspirationId || typeof value.acknowledged.reflectionId !== 'string'))))) throw new Error('Invalid saved reference');
      if (value.operation === 'inspiration' && value.draft && (typeof value.draft.id !== 'string' || !Number.isSafeInteger(value.draft.revision) || value.draft.revision < 1)) throw new Error('Invalid draft reference');
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
 * tabs. Mount/focus only READ. An explicit retry may POST the immutable intent
 * using its original identity, after verifying the server supports it. */
export function useAuthoredSave(options: {
  scope: ProfileStorageScope | null; operation: AuthoredSaveInput['operation']; inspirationId?: string; enabled?: boolean;
  // Callbacks must settle matching device drafts before returning. IndexedDB
  // media cleanup may be asynchronous; keep the save journal until it finishes.
  // Throwing leaves the request available for safe reconciliation on return.
  onResolved: (intent: AuthoredSaveIntent, result: AuthoredSaveResult, initiated: boolean) => void | (() => void) | Promise<void | (() => void)>;
  onRemoved: (intent: AuthoredSaveIntent) => void | Promise<void>;
  onEditRejected?: (intent: AuthoredSaveIntent) => void;
}) {
  const prefix = profileStorageKey(options.scope, `pendingSave:${options.operation}:${encodeURIComponent(options.inspirationId ?? '')}:`);
  const live = useRef({ ...options, prefix }); live.current = { ...options, prefix };
  const [pending, setPending] = useState<AuthoredSaveIntent | null>(null);
  const intentRef = useRef<AuthoredSaveIntent | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const working = useRef(false), mounted = useRef(false), epoch = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const refresh = useRef<() => void>(() => {});

  const run = useCallback(async (intent: AuthoredSaveIntent, write: boolean) => {
    const owner = live.current, key = owner.prefix;
    if (!mounted.current || working.current || !key || !owner.scope || owner.enabled === false || (document.hidden && !write)) return;
    if (intent.rejected) { setPhase('rejected'); return; }
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
    const work = async (): Promise<AuthoredSaveResult> => {
      let saved = intent.acknowledged;
      let created: ApiInspiration | null = null;
      try {
        const found = await fetchInspirationSaveRequest(intent.requestId, scoped, controller.signal); current();
        if (found.operation !== intent.operation || (intent.operation === 'reflection' && found.inspirationId !== intent.inspirationId)) throw new Error('Unexpected save identity');
        saved = { inspirationId: found.inspirationId, reflectionId: found.reflectionId, processing: found.processing };
      } catch (error) {
        current();
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        if (error.code !== 'save_not_found') throw new ApiError({ status: 404, code: 'save_protocol_unavailable', message: 'Save recovery is unavailable' });
      }
      if (!saved) {
        if (!write) throw new Error('Save not yet observed');
        current(); setPhase('saving');
        attempted = true;
        const saveOptions = { ...scoped, requestId: intent.requestId, signal: controller.signal };
        if (intent.operation === 'inspiration') {
          created = await createInspiration(intent.input, saveOptions); current();
          if (!created?.id || created.profileId !== intent.profileId) throw new Error('Unexpected saved inspiration');
          saved = { inspirationId: created.id, reflectionId: null, processing: created.processing };
        } else {
          const answer = await createReflection(intent.inspirationId, intent.input, saveOptions); current();
          if (!answer?.id || answer.inspirationId !== intent.inspirationId) throw new Error('Unexpected saved answer');
          saved = { inspirationId: intent.inspirationId, reflectionId: answer.id, processing: answer.processing };
        }
        const acknowledged = { ...intent, acknowledged: saved };
        // The original durable key is already safe to reconcile if quota fills
        // after the POST. Retain the acknowledgment in memory in that case.
        try { persist(key, acknowledged); } catch { /* original intent remains */ }
        intentRef.current = acknowledged; setPending(acknowledged);
      }
      current();
      const inspiration = created ?? await fetchInspiration(saved.inspirationId, scoped, controller.signal); current();
      if (inspiration.id !== saved.inspirationId || inspiration.profileId !== intent.profileId) throw new Error('Unexpected saved owner');
      const reflection = intent.operation === 'reflection' ? inspiration.reflections.find((row) => row.id === saved!.reflectionId) ?? null : null;
      if (intent.operation === 'reflection' && !reflection) throw new ApiError({ status: 410, code: 'saved_item_removed', message: 'That saved answer was removed' });
      return { inspiration, reflection, processing: saved.processing, recovered: !created || created.saveRequest?.replayed === true };
    };
    try {
      const result = await Promise.race([work(), cancelled, new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error('Save check timed out')); }, 15_000);
      })]);
      current();
      const afterSettlement = await live.current.onResolved(intent, result, write);
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
      } else if (attempted && error instanceof ApiError && error.status === 400 && !intentRef.current?.acknowledged) {
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

  const scan = useCallback(() => {
    const at = live.current;
    if (!mounted.current || working.current || !at.prefix || !at.scope || at.enabled === false || document.hidden) return;
    if (intentRef.current) { void run(intentRef.current, false); return; }
    try {
      const found = readIntents(at.prefix, at.scope, at.operation, at.inspirationId);
      if (found.intents[0]) { intentRef.current = found.intents[0]; setPending(found.intents[0]); void run(found.intents[0], false); }
      else if (found.invalid) setPhase('invalid');
    } catch { setPhase('storage_error'); }
  }, [run]);
  refresh.current = scan;

  useEffect(() => {
    mounted.current = true; epoch.current += 1; abort.current?.abort(); working.current = false;
    intentRef.current = null; setPending(null); setBusy(false); setPhase('idle'); scan();
    const onFocus = () => scan();
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(prefix ?? '\0')) scan(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus); window.addEventListener('storage', onStorage);
    return () => {
      mounted.current = false; epoch.current += 1; abort.current?.abort(); working.current = false;
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('storage', onStorage);
    };
  }, [prefix, options.enabled, scan]);

  const start = useCallback((input: AuthoredSaveInput): boolean => {
    const at = live.current;
    if (!mounted.current || working.current || intentRef.current || at.enabled === false) return false;
    if (!at.scope || !at.prefix) { setPhase('unsupported'); return false; }
    try {
      const found = readIntents(at.prefix, at.scope, at.operation, at.inspirationId);
      if (found.invalid || found.intents.length) { scan(); return false; }
      if (input.operation !== at.operation || (input.operation === 'reflection' && input.inspirationId !== at.inspirationId)) throw new Error('Unexpected save target');
      const copy = JSON.parse(JSON.stringify(input)) as AuthoredSaveInput;
      const intent: AuthoredSaveIntent = { ...copy, ...at.scope, version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(), checksum: checksum(copy) };
      persist(at.prefix, intent); // no request may precede durable ownership/words
      intentRef.current = intent; setPending(intent); void run(intent, true);
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
      const found = readIntents(at.prefix, at.scope, at.operation, at.inspirationId);
      for (const key of found.invalidKeys) {
        // Explicit user reset only. Preserve uninterpreted bytes for recovery,
        // outside the pending namespace; never adopt or submit them as a draft.
        const backup = profileStorageKey(at.scope, `unrecoveredSave:${crypto.randomUUID()}`)!;
        localStorage.setItem(backup, JSON.stringify({ key, raw: localStorage.getItem(key) }));
        localStorage.removeItem(key);
      }
      setPhase('idle'); scan();
    } catch { setPhase('storage_error'); }
  };

  return { pending, phase, busy, start, retry: () => intentRef.current ? run(intentRef.current, true) : Promise.resolve(scan()),
    check: scan, editRejected, resetInvalid, dismiss: () => { if (!intentRef.current) setPhase('idle'); } };
}
