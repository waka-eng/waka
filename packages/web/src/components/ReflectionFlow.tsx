import { useCallback, useEffect, useRef, useState } from "react";
import {
  createReflection,
  deleteReflection,
  fetchReflectionQuestionStatus,
  requestReflectionQuestion,
  type ApiReflection,
  type ApiReflectionQuestionStatus,
} from "../lib/api";
import { t, type SupportedLocale } from "../lib/i18n";

export interface ReflectionTurn {
  id: string;
  question: string;
  answer: string;
}

type Phase = "answering" | "saving" | "asking" | "saved" | "question_failed";

function savedDraft(inspirationId: string, afterId: string | null): string {
  try {
    const raw = window.localStorage.getItem(`waka.reflectionDraft:${inspirationId}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { afterId?: string | null; answer?: string };
    return parsed.afterId === afterId && typeof parsed.answer === "string" ? parsed.answer : "";
  } catch { return ""; }
}

export function ReflectionFlow({ inspirationId, initialTurns, locale, onSaved, onRemoved, onDone }: {
  inspirationId: string;
  initialTurns: ReflectionTurn[];
  locale: SupportedLocale;
  onSaved: (reflection: ApiReflection) => void;
  onRemoved: (reflectionId: string) => void;
  onDone: () => void;
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [phase, setPhase] = useState<Phase>(initialTurns.length > 0 ? "saved" : "answering");
  const [question, setQuestion] = useState(initialTurns.length > 0 ? "" : t(locale, "worldFirstReflectionQuestion"));
  const [answer, setAnswer] = useState(() => savedDraft(inspirationId, initialTurns.at(-1)?.id ?? null));
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const saving = useRef(false);
  const requestSequence = useRef(0);
  const currentQuestion = useRef<HTMLDivElement>(null);
  const latestId = turns.at(-1)?.id ?? null;

  useEffect(() => () => { requestSequence.current += 1; }, []);
  useEffect(() => {
    try {
      const key = `waka.reflectionDraft:${inspirationId}`;
      if (answer.trim()) window.localStorage.setItem(key, JSON.stringify({ afterId: latestId, answer }));
      else window.localStorage.removeItem(key);
    } catch { /* the open answer still lives in React state */ }
  }, [inspirationId, latestId, answer]);
  useEffect(() => {
    // Each follow-up replaces the waiting beat. Bring the new question into
    // the outer card/sheet's scroll position instead of leaving it below the
    // growing history, where it can look as though nothing happened.
    if (phase === "answering" && turns.length > 0) {
      currentQuestion.current?.scrollIntoView?.({ block: "start" });
    }
  }, [phase, question, turns.length]);

  const beginQuestion = useCallback(async (afterId: string, retry = false) => {
    const sequence = ++requestSequence.current;
    setPhase("asking");
    setError("");
    try {
      let status: ApiReflectionQuestionStatus = await requestReflectionQuestion(inspirationId, afterId, retry);
      for (let check = 0; check < 30 && sequence === requestSequence.current; check += 1) {
        if (status.phase === "ready" && status.question) {
          setQuestion(status.question);
          setAnswer(savedDraft(inspirationId, afterId));
          setPhase("answering");
          return;
        }
        if (status.phase === "failed") {
          setError(t(locale, "worldReflectionNextFailed"));
          setPhase("question_failed");
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
        if (sequence !== requestSequence.current) return;
        status = await fetchReflectionQuestionStatus(inspirationId, afterId);
      }
      if (sequence === requestSequence.current) {
        setError(t(locale, "worldReflectionNextDelayed"));
        setPhase("question_failed");
      }
    } catch {
      if (sequence === requestSequence.current) {
        setError(t(locale, "worldReflectionNextFailed"));
        setPhase("question_failed");
      }
    }
  }, [inspirationId, locale]);

  const saveAnswer = async (continueReflecting: boolean) => {
    const words = answer.trim();
    if (phase !== "answering" || !words || saving.current) return;
    saving.current = true;
    setPhase("saving");
    setError("");
    try {
      const made = await createReflection(inspirationId, { question, answer: words });
      setTurns((prev) => [...prev, { id: made.id, question, answer: words }]);
      onSaved(made);
      setAnswer("");
      if (continueReflecting) void beginQuestion(made.id);
      else onDone();
    } catch {
      setError(t(locale, "worldReflectionNotSaved"));
      setPhase("answering");
    } finally {
      saving.current = false;
    }
  };

  const removeAnswer = async (id: string) => {
    if (removingId) return;
    setRemovingId(id);
    setError("");
    try {
      await deleteReflection(inspirationId, id);
      const remaining = turns.filter((turn) => turn.id !== id);
      setTurns(remaining);
      onRemoved(id);
      if (id === latestId) {
        requestSequence.current += 1;
        setAnswer("");
        setQuestion(remaining.length > 0 ? "" : t(locale, "worldFirstReflectionQuestion"));
        setPhase(remaining.length > 0 ? "saved" : "answering");
      }
    } catch { setError(t(locale, "worldReflectionRemoveFailed")); }
    finally { setRemovingId(null); }
  };

  const latest = turns.at(-1);
  const earlier = turns.slice(0, -1);
  return <div className="jar-reflection-flow">
    {latest ? <div className="jar-reflection-previous">
      <p className="jar-label">{t(locale, "worldReflectionPrevious")}</p>
      <p className="jar-reflection-previous-question">{latest.question}</p>
      <p>{latest.answer}</p>
      <button type="button" disabled={removingId === latest.id} onClick={() => void removeAnswer(latest.id)}>
        {t(locale, "worldTakeItBack")}
      </button>
    </div> : null}
    {earlier.length > 0 ? <details className="jar-reflection-turns">
      <summary>{t(locale, "worldReflectionHistory")} ({earlier.length})</summary>
      {earlier.map((turn) => <div key={turn.id} className="jar-reflection-turn">
        <p className="jar-reflect-q">{turn.question}</p>
        <p>{turn.answer}</p>
        <button type="button" disabled={removingId === turn.id} onClick={() => void removeAnswer(turn.id)}>
          {t(locale, "worldTakeItBack")}
        </button>
      </div>)}
    </details> : null}
    {phase === "answering" ? <div ref={currentQuestion} className="jar-reflection-current">
      <p className="jar-label">{latest ? t(locale, "worldReflectionFollowup") : t(locale, "worldReflect")}</p>
      <p className="jar-reflect-q">{question}</p>
      <textarea className="jar-reflect-box" rows={4} autoFocus value={answer}
        placeholder={t(locale, "worldInYourOwnWords")}
        onChange={(event) => setAnswer(event.target.value)} />
      <p className="jar-reflection-hint">{t(locale, "worldReflectionNextHint")}</p>
      <div className="jar-reflection-actions">
        <button type="button" className="jar-reflection-primary" disabled={!answer.trim()}
          onClick={() => void saveAnswer(true)}>{t(locale, "worldReflectionNext")}</button>
        <button type="button" className="jar-reflection-secondary"
          onClick={() => answer.trim() ? void saveAnswer(false) : onDone()}>
          {answer.trim() ? t(locale, "worldReflectionSaveAndFinish") : t(locale, "worldReflectionDone")}
        </button>
      </div>
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
  </div>;
}
