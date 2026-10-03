import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  deleteReflection,
  fetchReflectionQuestionStatus,
  requestReflectionQuestion,
  type ApiReflection,
  type ApiReflectionQuestionStatus,
  type ApiInspiration,
} from "../lib/api";
import { t, type SupportedLocale } from "../lib/i18n";
import { useAuthoredSave } from '../lib/use-authored-save';
import { readReflectionDraft, restoreReflectionDraft, settleReflectionDraft, type ReflectionDraft } from '../lib/authored-save-drafts';
import { profileStorageKey, type ProfileStorageScope } from '../lib/profile-storage';
import { AuthoredSaveNotice } from './AuthoredSaveNotice';

export interface ReflectionTurn {
  id: string;
  question: string;
  answer: string;
}

type Phase = "answering" | "saving" | "asking" | "saved" | "question_failed";

function savedDraft(draftKey: string | null, afterId: string | null): string {
  if (!draftKey) return "";
  try {
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { afterId?: string | null; answer?: string };
    return parsed.afterId === afterId && typeof parsed.answer === "string" ? parsed.answer : "";
  } catch { return ""; }
}

export function ReflectionFlow({ inspirationId, scope, processing, source, initialTurns, locale, onSaved, onRemoved, onDone, onSynchronized, focusReflectionId, onCopyLink }: {
  inspirationId: string;
  scope: ProfileStorageScope | null;
  processing?: ReactNode;
  source?: ReactNode;
  initialTurns: ReflectionTurn[];
  locale: SupportedLocale;
  onSaved: (reflection: ApiReflection) => void;
  onRemoved: (reflectionId: string) => void;
  onDone: () => void;
  onSynchronized?: (inspiration: ApiInspiration | null) => void;
  focusReflectionId?: string | null;
  onCopyLink?: (reflectionId: string) => void;
}) {
  const draftKey = profileStorageKey(scope, `reflectionDraft:${inspirationId}`);
  const restored = useRef(readReflectionDraft(draftKey));
  const [turns, setTurns] = useState(initialTurns);
  const [phase, setPhase] = useState<Phase>(restored.current?.answer || initialTurns.length === 0 ? "answering" : "saved");
  const [question, setQuestion] = useState(restored.current?.question || (initialTurns.length > 0 && !restored.current?.answer ? "" : t(locale, "worldFirstReflectionQuestion")));
  const [answer, setAnswer] = useState(restored.current?.answer ?? '');
  // null belongs to the first question. A committed answer can already be in
  // initialTurns while its lost-response journal still owns that first draft.
  const [draftAfterId, setDraftAfterId] = useState(restored.current ? restored.current.afterId : initialTurns.at(-1)?.id ?? null);
  const draftRef = useRef<ReflectionDraft>({ afterId: draftAfterId, question, answer });
  draftRef.current = { afterId: draftAfterId, question, answer };
  const [error, setError] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const questionRequest = useRef<AbortController | null>(null);
  const currentQuestion = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const earlierTurns = useRef<HTMLDetailsElement>(null);
  const latestId = turns.at(-1)?.id ?? null;

  useEffect(() => () => { requestSequence.current += 1; questionRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!focusReflectionId || focusReflectionId === 'open') return;
    const node = [...root.current?.querySelectorAll<HTMLElement>('[data-reflection-id]') ?? []]
      .find((item) => item.dataset.reflectionId === focusReflectionId);
    if (!node) return;
    if (earlierTurns.current?.contains(node)) earlierTurns.current.open = true;
    const surface = node.closest<HTMLElement>('[data-jar-surface]');
    if (surface) surface.scrollTop += node.getBoundingClientRect().top - surface.getBoundingClientRect().top - (parseFloat(getComputedStyle(surface).paddingTop) || 0);
  }, [focusReflectionId]);
  useEffect(() => {
    // Each follow-up replaces the waiting beat. Bring the new question into
    // the card/sheet, not every scroll ancestor. scrollIntoView also scrolls
    // the overflow-hidden world and leaves an otherwise centered dialog clipped.
    if (phase !== "answering") return;
    const questionNode = currentQuestion.current;
    questionNode?.querySelector('textarea')?.focus({ preventScroll: true });
    const surface = questionNode?.closest<HTMLElement>('[data-jar-surface]');
    if (!questionNode || !surface || turns.length === 0) return;
    const padding = parseFloat(getComputedStyle(surface).paddingTop) || 0;
    surface.scrollTop += questionNode.getBoundingClientRect().top - surface.getBoundingClientRect().top - padding;
  }, [phase, question, turns.length]);

  const beginQuestion = useCallback(async (afterId: string, retry = false, observeOnly = false) => {
    const sequence = ++requestSequence.current;
    questionRequest.current?.abort();
    const controller = new AbortController(); questionRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 65_000);
    const options = {signal:controller.signal,profile:scope?.profileId};
    if (!observeOnly) setPhase("asking");
    setError("");
    try {
      let status: ApiReflectionQuestionStatus = observeOnly
        ? await fetchReflectionQuestionStatus(inspirationId, afterId, options)
        : await requestReflectionQuestion(inspirationId, afterId, retry, options);
      for (let check = 0; check < 30 && sequence === requestSequence.current; check += 1) {
        if (controller.signal.aborted) throw new Error('Question observation timed out');
        if (observeOnly && (!status || status.phase === 'idle')) { setPhase('saved'); return; }
        if (status.phase === "ready" && status.question) {
          setQuestion(status.question);
          setAnswer(savedDraft(draftKey, afterId));
          setDraftAfterId(afterId);
          setPhase("answering");
          return;
        }
        if (status.phase === "failed") {
          setError(t(locale, "worldReflectionNextFailed"));
          setPhase("question_failed");
          return;
        }
        if (status.phase === 'idle') {
          setError(t(locale, 'worldReflectionContextChanged')); setPhase('question_failed'); return;
        }
        setPhase('asking');
        await new Promise<void>((resolve) => {
          const finish = () => { window.clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
          const timer = window.setTimeout(finish, 2_000);
          controller.signal.addEventListener('abort', finish, {once:true});
        });
        if (sequence !== requestSequence.current) return;
        status = await fetchReflectionQuestionStatus(inspirationId, afterId, options);
      }
      if (sequence === requestSequence.current) {
        setError(t(locale, "worldReflectionNextDelayed"));
        setPhase("question_failed");
      }
    } catch {
      if (sequence === requestSequence.current) {
        if (observeOnly) { setPhase('saved'); return; }
        setError(t(locale, "worldReflectionNextFailed"));
        setPhase("question_failed");
      }
    } finally { window.clearTimeout(timeout); }
  }, [inspirationId, draftKey, locale, scope?.profileId]);

  // Reopening only observes work previously requested by the person. It never
  // starts another model job or overwrites a draft they have already written.
  useEffect(() => {
    if (restored.current?.answer || !initialTurns.length) return;
    void beginQuestion(initialTurns.at(-1)!.id, false, true);
  }, [beginQuestion]);

  const save = useAuthoredSave({ scope, operation: 'reflection', inspirationId,
    onResolved: (intent, result, initiated) => {
      if (intent.operation !== 'reflection' || !result.reflection) return;
      requestSequence.current += 1;
      questionRequest.current?.abort();
      const retained = settleReflectionDraft(draftKey, { afterId: intent.afterId, question: intent.input.question, answer: intent.input.answer ?? '' }, draftRef.current);
      const currentTurns = result.inspiration.reflections.filter((row) => !row.skipped && row.answer)
        .map((row) => ({ id: row.id, question: row.question, answer: row.answer! }));
      setTurns(currentTurns); onSynchronized?.(result.inspiration);
      onSaved({ ...result.reflection, ...(result.processing ? { processing: result.processing } : {}) });
      draftRef.current = retained ?? { afterId: currentTurns.at(-1)?.id ?? null, question: '', answer: '' };
      setAnswer(retained?.answer ?? ''); setDraftAfterId(draftRef.current.afterId); setQuestion(retained ? retained.question || t(locale, 'worldFirstReflectionQuestion') : ''); setError('');
      if (retained) { setPhase('answering'); return; }
      setPhase('saved');
      return () => {
        if (initiated && intent.continueReflecting && currentTurns.at(-1)) void beginQuestion(currentTurns.at(-1)!.id);
        else if (initiated && !intent.continueReflecting) onDone();
      };
    },
    onRemoved: (intent) => {
      if (intent.operation !== 'reflection') return;
      const retained = settleReflectionDraft(draftKey, { afterId: intent.afterId, question: intent.input.question, answer: intent.input.answer ?? '' }, draftRef.current);
      requestSequence.current += 1; questionRequest.current?.abort(); setTurns([]); onSynchronized?.(null);
      draftRef.current = retained ?? { afterId: null, question: '', answer: '' };
      setAnswer(retained?.answer ?? ''); setQuestion(retained?.question ?? ''); setDraftAfterId(draftRef.current.afterId);
      setPhase(retained ? 'answering' : 'saved');
    },
    onEditRejected: (intent) => {
      if (intent.operation !== 'reflection') return;
      const draft = restoreReflectionDraft(draftKey, { afterId: intent.afterId, question: intent.input.question, answer: intent.input.answer ?? '' }, draftRef.current);
      draftRef.current = draft; setAnswer(draft.answer); setQuestion(draft.question || t(locale, 'worldFirstReflectionQuestion')); setDraftAfterId(draft.afterId); setPhase('answering');
    },
  });
  const keepDraft = (draft: ReflectionDraft) => {
    if (!draftKey) return;
    try { if (draft.answer.trim()) localStorage.setItem(draftKey, JSON.stringify(draft)); else localStorage.removeItem(draftKey); }
    catch { /* the save still requires a durable journal before sending */ }
  };

  const saveAnswer = (continueReflecting: boolean) => {
    const words = draftRef.current.answer.trim();
    if (phase !== 'answering' || !words || save.pending) return;
    setError('');
    save.start({ operation: 'reflection', inspirationId, input: { question: draftRef.current.question || question, answer: words },
      afterId: draftRef.current.afterId, continueReflecting });
  };

  const removeAnswer = async (id: string) => {
    if (removingId || save.pending) return;
    setRemovingId(id);
    setError("");
    try {
      await deleteReflection(inspirationId, id);
      const remaining = turns.filter((turn) => turn.id !== id);
      setTurns(remaining);
      onRemoved(id);
      // Any removed answer may have informed the follow-up. Invalidate that
      // generated question, but preserve words the person is still drafting.
      requestSequence.current += 1;
      questionRequest.current?.abort();
      setQuestion(remaining.length > 0 ? "" : t(locale, "worldFirstReflectionQuestion"));
      setDraftAfterId(remaining.at(-1)?.id ?? null);
      const revised = { ...draftRef.current, afterId: remaining.at(-1)?.id ?? null, question: remaining.length > 0 ? '' : t(locale, 'worldFirstReflectionQuestion') };
      if (revised.answer) keepDraft(revised);
      setPhase(remaining.length > 0 ? "saved" : "answering");
    } catch { setError(t(locale, "worldReflectionRemoveFailed")); }
    finally { setRemovingId(null); }
  };

  const latest = turns.at(-1);
  const earlier = turns.slice(0, -1);
  const copyLink = (id: string) => onCopyLink ? <button type="button" className="jar-copy-link"
    aria-label={t(locale, 'worldCopyReflectionLink')} title={t(locale, 'worldCopyReflectionLink')} onClick={() => onCopyLink(id)}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 14 4-4m-7 3-2 2a4 4 0 0 0 6 6l4-4m-4-10 2-2a4 4 0 0 1 6 6l-4 4" /></svg>
  </button> : null;
  return <div ref={root} className="jar-reflection-flow">
    {source ? <details className="jar-reflection-source" onToggle={event => setSourceOpen(event.currentTarget.open)}>
      <summary>{t(locale, 'worldReflectionViewSource')}</summary>
      {sourceOpen ? source : null}
    </details> : null}
    {latest ? <div className="jar-reflection-previous" data-reflection-id={latest.id}>
      <p className="jar-label">{t(locale, "worldReflectionPrevious")}</p>
      <p className="jar-reflection-previous-question">{latest.question}</p>
      <p>{latest.answer}</p>
      <button type="button" disabled={Boolean(save.pending) || removingId === latest.id} onClick={() => void removeAnswer(latest.id)}>
        {t(locale, "worldTakeItBack")}
      </button>
      {copyLink(latest.id)}
    </div> : null}
    {earlier.length > 0 ? <details ref={earlierTurns} className="jar-reflection-turns">
      <summary>{t(locale, "worldReflectionHistory")} ({earlier.length})</summary>
      {earlier.map((turn) => <div key={turn.id} className="jar-reflection-turn" data-reflection-id={turn.id}>
        <p className="jar-reflect-q">{turn.question}</p>
        <p>{turn.answer}</p>
        <button type="button" disabled={Boolean(save.pending) || removingId === turn.id} onClick={() => void removeAnswer(turn.id)}>
          {t(locale, "worldTakeItBack")}
        </button>
        {copyLink(turn.id)}
      </div>)}
    </details> : null}
    {phase === "answering" ? <div ref={currentQuestion} className="jar-reflection-current">
      <p className="jar-label">{latest ? t(locale, "worldReflectionFollowup") : t(locale, "worldReflect")}</p>
      <p className="jar-reflect-q">{question}</p>
      <textarea className="jar-reflect-box" rows={4} value={answer} readOnly={Boolean(save.pending)}
        placeholder={t(locale, "worldInYourOwnWords")}
        onChange={(event) => { draftRef.current.answer = event.target.value; keepDraft(draftRef.current); setAnswer(event.target.value); }} />
      <p className="jar-reflection-hint">{t(locale, "worldReflectionNextHint")}</p>
      {!save.pending ? <div className="jar-reflection-actions">
        <button type="button" className="jar-reflection-primary" disabled={!answer.trim()}
          onClick={() => void saveAnswer(true)}>{t(locale, "worldReflectionNext")}</button>
        <button type="button" className="jar-reflection-secondary"
          onClick={() => answer.trim() ? void saveAnswer(false) : onDone()}>
          {answer.trim() ? t(locale, "worldReflectionSaveAndFinish") : t(locale, "worldReflectionDone")}
        </button>
      </div> : null}
    </div> : null}
    {phase === "saving" ? <p className="jar-reflection-status" role="status">{t(locale, "worldKeeping")}</p> : null}
    {phase === "asking" ? <div className="jar-reflection-wait" role="status">
      <div className="jar-reflection-wait-line">
        <span className="jar-reflection-typing" aria-hidden="true"><span /><span /><span /></span>
        <p>{t(locale, "worldReflectionNextLoading")}</p>
      </div>
      <button type="button" className="jar-reflection-secondary" onClick={onDone}>
        {t(locale, "worldReflectionDone")}
      </button>
    </div> : null}
    {phase === "saved" || phase === "question_failed" ? <div className="jar-reflection-actions">
      {latestId ? <button type="button" className="jar-reflection-primary"
        onClick={() => void beginQuestion(latestId, phase === "question_failed")}>
        {phase === "question_failed" ? t(locale, "worldReflectionRetry") : t(locale, "worldReflectionGoDeeper")}
      </button> : null}
      <button type="button" className="jar-reflection-secondary" onClick={onDone}>
        {t(locale, "worldReflectionDone")}
      </button>
    </div> : null}
    {error ? <p className="jar-settings-warn" role="alert">{error}</p> : null}
    <AuthoredSaveNotice save={save} locale={locale} />
    {save.pending ? <button type="button" className="jar-reflection-secondary" onClick={onDone}>{t(locale, 'worldReflectionDone')}</button> : null}
    {!save.pending && phase !== 'saving' && phase !== 'asking' ? processing : null}
  </div>;
}
