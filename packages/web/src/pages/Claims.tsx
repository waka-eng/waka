/**
 * CLAIMS — one claim, three answers, and nothing else on the screen.
 *
 * The middle tab, and the only place in the product that asks a person for
 * something. Everything here follows from two founder rulings that already
 * exist in the codebase, so this page is their application rather than a new
 * idea:
 *
 *   ONE LINE AT A TIME (2026-08-24). A claim used to print its memories, its
 *   honest-empty line, who else had answered, the verbs to answer it, and the
 *   receipt, all at once. "So confusing" was the whole review, and it was
 *   right: a claim about you buried under its own apparatus is not legible,
 *   it is dense. So the claim is the only sentence with weight here. Where it
 *   came from is a count, not a list.
 *
 *   A RECEIPT MAY CLAIM ONLY WHAT A TEST ENFORCES (lib/receipts.ts). After a
 *   verdict this page says exactly what the registry says and not a word more.
 *   Saying yes currently earns `worldReceiptVerdictKept` — "on the record" —
 *   which is thin, and deliberately so: affirming adds
 *   CONFIDENCE_AFFIRMED_BONUS, which is 8, while refusing multiplies the whole
 *   selection score by 0.4. The copy is weak because the mechanism is weak,
 *   and strengthening the sentence before the weight would be the advisory lie
 *   the receipts law exists to prevent.
 *
 * ANSWERING ADVANCES OPTIMISTICALLY. The next claim appears the moment you
 * press, because a judgement about yourself should not wait on a round trip.
 * If the write fails the claim comes BACK and says so — an answer that was
 * silently dropped is worse than one that was never asked for.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createFeedback,
  listClaims,
  type ApiClaim,
  type ApiFeedbackValue,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";
import { RECEIPTS } from "../lib/receipts";

export interface ClaimsProps {
  /** Lets the shell keep the tab badge honest without a second fetch. */
  onWaitingChange?: (waiting: number | null) => void;
}

type Phase = "loading" | "ready" | "failed";

export function Claims({ onWaitingChange }: ClaimsProps): JSX.Element {
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);

  const [queue, setQueue] = useState<ApiClaim[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const report = useCallback(
    (claims: ApiClaim[]) => onWaitingChange?.(claims.length),
    [onWaitingChange],
  );

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const { claims } = await listClaims();
      if (!mounted.current) return;
      setQueue(claims);
      setPhase("ready");
      report(claims);
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
      /* The badge must not keep asserting a count the server just refused. */
      onWaitingChange?.(null);
    }
  }, [report, onWaitingChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = useCallback(
    (claim: ApiClaim, value: ApiFeedbackValue) => {
      setAnswerError(false);
      /* Optimistic: the queue moves on, and the receipt speaks for the act. */
      setQueue((previous) => {
        const next = previous.filter((row) => row.id !== claim.id);
        report(next);
        return next;
      });
      setReceipt(
        say(value === "not_true" ? RECEIPTS.verdictNo.messageKey : RECEIPTS.verdictKept.messageKey),
      );

      void createFeedback({
        targetType: "signal",
        targetId: claim.id,
        value,
      }).catch(() => {
        if (!mounted.current) return;
        /* PUT IT BACK. A dropped verdict that looks saved is the one failure
           this page must never have — the person would believe they had
           answered, and the claim would keep being read as unjudged. */
        setReceipt(null);
        setAnswerError(true);
        setQueue((previous) => {
          if (previous.some((row) => row.id === claim.id)) return previous;
          const next = [claim, ...previous];
          report(next);
          return next;
        });
      });
    },
    [report, say],
  );

  if (phase === "loading") {
    return (
      <main className="waka-claims">
        <p className="waka-claims-status" role="status">
          {say("worldClaimsLoading")}
        </p>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="waka-claims">
        <p className="waka-claims-status" role="alert">
          {say("worldClaimsFailed")}
        </p>
        <button type="button" className="waka-claim-retry" onClick={() => void load()}>
          {say("worldClaimsRetry")}
        </button>
      </main>
    );
  }

  const [current, ...rest] = queue;

  if (!current) {
    return (
      <main className="waka-claims">
        <div className="waka-claims-empty">
          {/* Caught up is an achievement, so it is said before the invitation. */}
          <p className="waka-claims-done">{say("worldClaimsCaughtUp")}</p>
          <p className="waka-claims-hint">{say("worldClaimsEmpty")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="waka-claims">
      <header className="waka-claims-head">
        <h1 className="waka-claims-title">{say("worldClaimsTitle")}</h1>
        <p className="waka-claims-count">
          {formatMessage(locale, "worldClaimsWaiting", { count: queue.length })}
        </p>
      </header>

      <article className="waka-claim" key={current.id}>
        <p className="waka-claim-origin">
          {formatMessage(locale, "worldClaimsFrom", { count: current.evidenceCount })}
        </p>
        <p className="waka-claim-statement">{current.statement}</p>
      </article>

      {/* THE ANSWERS SIT IN THE THUMB ARC, not under the sentence. A verdict is
          the one thing this page asks for, and on a tall phone the bottom is
          the only place a thumb reaches without a second hand. The claim keeps
          the eye line; the answer keeps the reach. */}
      <footer className="waka-claim-foot">
        {rest.length > 0 ? (
          <section className="waka-claims-next" aria-label={say("worldClaimsNext")}>
            <p className="waka-claims-next-label">{say("worldClaimsNext")}</p>
            {/* A glimpse, not a list: enough to know the queue has a bottom. */}
            <p className="waka-claims-next-statement">{rest[0]!.statement}</p>
          </section>
        ) : null}

        <div className="waka-claim-answers">
          <button
            type="button"
            className="waka-claim-answer waka-claim-answer--yes"
            onClick={() => answer(current, "true")}
          >
            {say("worldYes")}
          </button>
          <button
            type="button"
            className="waka-claim-answer"
            onClick={() => answer(current, "partly")}
          >
            {say("worldPartly")}
          </button>
          <button
            type="button"
            className="waka-claim-answer"
            onClick={() => answer(current, "not_true")}
          >
            {say("worldNotTrue")}
          </button>
        </div>

        {answerError ? (
          <p className="waka-claim-error" role="alert">
            {say("worldClaimFailed")}
          </p>
        ) : receipt ? (
          <p className="waka-claim-receipt" role="status">
            {receipt}
          </p>
        ) : null}
      </footer>
    </main>
  );
}
