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
export type AuthoredSaveIntent = AuthoredSaveInput & { version: 1; accountId: string; profileId: string; requestId: string; createdAt: number; checksum: number; acknowledged?: SavedReference; rejected?: boolean; validationMessage?: string;
  /** The server ANSWERED a POST under this id with a failure (5xx). With that
      on record, a later `save_not_found` is a definitive "it did not land". */
  answered?: boolean;
  /** When that answer came, so a later "not found" is trusted only once the
      rolled-back request has had time to be gone (`ANSWER_SETTLE_MS`). */
  answeredAt?: number };
export interface AuthoredSaveResult { inspiration: ApiInspiration; reflection: ApiReflection | null; processing?: ApiInspirationProcessingReceipt; recovered: boolean }
type Phase = 'idle' | 'checking' | 'saving' | 'uncertain' | 'diverged' | 'unsent' | 'storage_error' | 'unsupported' | 'invalid' | 'removed' | 'rejected';

/* ═══ A SAVE THAT DID NOT LAND LETS GO — ONLY WHEN THE SERVER SAYS SO ═══════
   (2026-10-17; revised the same day after review.)
   The audit at f2afcbe2: a save started, the network dropped, and from then on
   every load read `GET /save-requests/:id`, got 404, kept the journal and left
   Save disabled on "Uploading…" with no act that could end it.

   THE FIRST REPAIR RELEASED TOO EAGERLY, and review was right to stop it: it
   let go of the journal after a re-send that merely timed out — and a POST
   that times out may still commit. Releasing then and saving again under a
   NEW id is exactly the silent second copy this protocol exists to prevent.
   So the rule is now about what the server has SAID:

     LANDED      — the status read finds it: resolve, as always.
     DID NOT     — the server refused the POST (a 4xx that is not "busy" or
                   "who are you"), or it answered a POST with a failure (5xx,
                   recorded on the journal as `answered`) and a LATER status
                   read finds nothing. Only then is the journal released
                   ('unsent'): the draft stays, Save works, and new words get
                   a new identity safely.
     NOT KNOWN   — offline, timed out, 5xx with nothing read since, or
                   `save_in_progress` (another tab or request may be
                   committing it right now). The journal and its id stay, on
                   disk, across reloads ('uncertain', with Retry under the
                   same id). One unprompted re-send per page load is still
                   made when a status read finds nothing — the server dedupes
                   on the id, so it cannot make a copy.

   AND SAVE IS NOT DEAD WHILE IT IS NOT KNOWN. Pressing Save on the SAME words
   retries the same id. Pressing it on EDITED words asks ('diverged'): the
   earlier save may have landed, so saving the new words is a second
   inspiration by the person's explicit choice ("Save as new"), never by
   accident. */
class SaveNotLanded extends Error { constructor() { super('Save did not land'); } }
/** A 4xx that turned this POST away. Not "busy" (409 save_in_progress), not
    "who are you" (401/403), not "too slow" (408) or "too many" (429): those
    say nothing about whether these words will land. */
function refused(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status) &&
    error.code !== 'save_in_progress' && error.code !== 'save_protocol_unavailable' &&
    /* `save_request_conflict` says a save under this id EXISTS (with other
       words) — the opposite of "did not land". It is never a release. */
    error.code !== 'save_request_conflict';
}
/** How long after the app's own rolled-back 500 a "not found" is believed. */
export const ANSWER_SETTLE_MS = 10_000;
/** Only the APP's own failure counts as an answer: a JSON body from our API
    (it catches, rolls back, and says so). A gateway's 502/503/504, an HTML
    page or an empty body may sit in front of a request that still commits. */
function appAnsweredFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 500 && error.fromApp === true;
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
      if ((value.rejected !== undefined && typeof value.rejected !== 'boolean') || (value.answered !== undefined && typeof value.answered !== 'boolean') || (value.answeredAt !== undefined && !Number.isFinite(value.answeredAt)) ||
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
 * tabs. Mount/focus only READ. An explicit retry may POST the immutable intent
 * using its original identity, after verifying the server supports it. */
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
  const refresh = useRef<() => void>(() => {});
  // Identities already re-sent once without a press during this page load.
  const autoRetried = useRef(new Set<string>());
  // Edited words waiting on the person's "Save as new" while an earlier save is not known.
  const diverged = useRef<AuthoredSaveInput | null>(null);

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
        if (found.operation !== intent.operation) throw new Error('Unexpected save identity');
        saved = { inspirationId: found.inspirationId, reflectionId: found.reflectionId, processing: found.processing };
      } catch (error) {
        current();
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        if (error.code !== 'save_not_found') throw new ApiError({ status: 404, code: 'save_protocol_unavailable', message: 'Save recovery is unavailable' });
      }
      if (!saved) {
        // Answered with a failure before, and still not found: it did not land.
        /* The app answered with a rolled-back failure and, long enough after,
           still finds nothing: on a look that is definitive. On a PRESS it
           is simply sent again, in the same press (review). */
        if (intent.answered && !write && Date.now() - (intent.answeredAt ?? 0) >= ANSWER_SETTLE_MS) throw new SaveNotLanded();
        if (!write) {
          // Not known. One unprompted re-send per page load, under the same id.
          if (autoRetried.current.has(intent.requestId) || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new Error('Save not yet observed');
          autoRetried.current.add(intent.requestId);
        }
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
      } else if (!intentRef.current?.acknowledged && (error instanceof SaveNotLanded || (attempted && refused(error)))) {
        // DEFINITIVE: the server refused it, or answered with a failure and
        // has since been asked and found nothing. Safe to let go.
        try {
          localStorage.removeItem(key + intent.requestId);
          intentRef.current = null; setPending(null); setPhase('unsent');
        } catch { setPhase('storage_error'); }
      } else {
        // NOT KNOWN: keep the journal and the id. A 5xx is the server's own
        // answer, so it is recorded — the next status read can then decide.
        if (attempted && appAnsweredFailure(error) && !intentRef.current?.acknowledged) {
          const answered = { ...(intentRef.current ?? intent), answered: true, answeredAt: Date.now() };
          try { persist(key, answered); } catch { /* the original intent is still retained */ }
          intentRef.current = answered; setPending(answered);
        }
        setPhase(error instanceof ApiError && error.code === 'save_protocol_unavailable' ? 'unsupported' : 'uncertain');
      }
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
      const found = readIntents(at.prefix, at.scope, at.operation);
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
    if (!mounted.current || working.current || at.enabled === false) return false;
    const held = intentRef.current;
    if (held) {
      // An earlier save is not known. The same words retry it under its own
      // id; different words wait for an explicit "Save as new".
      if (held.acknowledged || held.rejected) return false;
      if (wordsSum(input) === wordsSum(held)) {
        diverged.current = null;
        /* THE SAME WORDS, THE CURRENT DRAFT (review). The journal carries the
           draft revision it was made from; a retry from a draft touched since
           would resolve against the old revision and leave the composer full.
           The words and the id are unchanged, so the server sees one save. */
        let next = held;
        if (at.prefix && (input.draft?.id !== held.draft?.id || input.draft?.revision !== held.draft?.revision)) {
          const { draft: _old, ...rest } = held;
          const moved: AuthoredSaveIntent = { ...rest, ...(input.draft ? { draft: { ...input.draft } } : {}), checksum: 0 };
          moved.checksum = checksum(moved);
          try { persist(at.prefix, moved); next = moved; intentRef.current = moved; setPending(moved); } catch { /* retry with the journal as it is */ }
        }
        void run(next, true); return true;
      }
      diverged.current = JSON.parse(JSON.stringify(input)) as AuthoredSaveInput;
      setPhase('diverged');
      return false;
    }
    if (!at.scope || !at.prefix) { setPhase('unsupported'); return false; }
    try {
      const found = readIntents(at.prefix, at.scope, at.operation);
      if (found.invalid || found.intents.length) { scan(); return false; }
      if (input.operation !== at.operation) throw new Error('Unexpected save target');
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
      const found = readIntents(at.prefix, at.scope, at.operation);
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

  /** The person chose to keep the edited words as a NEW inspiration, knowing
      the earlier save may have landed. Only now is the earlier journal let go. */
  const saveAsNew = () => {
    const held = intentRef.current, next = diverged.current, at = live.current;
    if (!held || !next || working.current || !at.prefix) return false;
    try { localStorage.removeItem(at.prefix + held.requestId); } catch { setPhase('storage_error'); return false; }
    intentRef.current = null; setPending(null); diverged.current = null;
    return start(next);
  };
  /** "Save as new" from a caller that rebuilds the save from what is on screen
      NOW (review): the earlier journal is let go by explicit choice, and the
      caller then starts a fresh save with the composer's current words. */
  const discardHeld = () => {
    const held = intentRef.current, at = live.current;
    if (!held || working.current || !at.prefix) return false;
    try { localStorage.removeItem(at.prefix + held.requestId); } catch { setPhase('storage_error'); return false; }
    intentRef.current = null; setPending(null); diverged.current = null; setPhase('idle');
    return true;
  };
  // Stable, so a caller can dismiss from an effect without re-running it each render.
  const dismiss = useCallback(() => { if (!intentRef.current) setPhase('idle'); }, []);
  const keepEarlier = () => { diverged.current = null; return intentRef.current ? run(intentRef.current, true) : Promise.resolve(); };
  /** Save may be pressed while an earlier save is not known (it retries or asks). */
  const canResave = Boolean(pending && !busy && !pending.acknowledged && !pending.rejected && (phase === 'uncertain' || phase === 'diverged'));

  return { pending, phase, busy, canResave, saveAsNew, discardHeld, keepEarlier, start, retry: () => intentRef.current ? run(intentRef.current, true) : Promise.resolve(scan()),
    check: scan, editRejected, resetInvalid, dismiss };
}
