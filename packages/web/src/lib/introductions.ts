/**
 * ═══ INTRODUCTIONS ON HOME (design "Agent introductions", approved
 * 2026-11-27) ═══
 *
 * What the creature's bubble says about an introduction, and the four acts
 * under it. The server decides what may be shown (see
 * `packages/api/src/lib/introductions.ts`); this only adds the lines that
 * answer an act the person just made, which the server never stores as
 * something to show again:
 *
 *   ask-consent  the first ask, once: introductions are off until Introduce us
 *   ask-match    a consenting match, anonymous: Introduce us / Not now
 *   introduced   both said yes: their creature visits, "You both hold"
 *   on           just said Introduce us to the first ask
 *   waiting      said yes to a match the other side has not completed
 *                (the same line whether they have not answered or said no)
 *   declined     said Not now to a match: their light fades off the edge
 *   off          just turned introductions off
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  answerIntroduction,
  fetchIntroductions,
  markIntroductionSeen,
  setIntroductionConsent,
  type ApiIntroductionState,
} from "./api";

export type IntroductionStage = "ask-consent" | "ask-match" | "introduced" | "on" | "waiting" | "declined" | "off";

export interface Introductions {
  stage: IntroductionStage | null;
  /** The other person's first name, on `introduced` only. */
  name: string;
  /** This person's own words for the principle they share, on `introduced` only. */
  principle: string;
  busy: boolean;
  introduce(): void;
  notNow(): void;
  done(): void;
  turnOff(): void;
}

type Local = Exclude<IntroductionStage, "ask-consent" | "ask-match" | "introduced">;

export function useIntroductions(active: boolean): Introductions {
  const [server, setServer] = useState<ApiIntroductionState | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (!active) return;
    void fetchIntroductions().then((next) => { if (alive.current) setServer(next); }).catch(() => undefined);
  }, [active]);
  /* On arrival, and whenever the person comes back to the tab: an
     introduction is made while they are away. */
  useEffect(() => {
    if (!active) { setServer(null); setLocal(null); return undefined; }
    load();
    const back = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [active, load]);

  const shown = server?.available ? server : null;
  const intro = shown?.introduction ?? null;
  const stage: IntroductionStage | null = local
    ?? (intro?.stage === "introduced" ? "introduced" : intro?.stage === "ask" ? "ask-match" : shown?.offerConsent ? "ask-consent" : null);

  const run = useCallback((work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void work().catch(() => { setLocal(null); load(); }).finally(() => { if (alive.current) setBusy(false); });
  }, [busy, load]);

  const introduce = useCallback(() => run(async () => {
    if (stage === "ask-consent") {
      await setIntroductionConsent(true);
      setServer((s) => s && { ...s, offerConsent: false, consent: { enabled: true, answered: true } });
      setLocal("on");
    } else if (stage === "ask-match" && intro) {
      const result = await answerIntroduction(intro.id, "yes");
      if (result.stage === "introduced") setServer((s) => s && { ...s, introduction: result });
      else { setServer((s) => s && { ...s, introduction: null }); setLocal("waiting"); }
    }
  }), [run, stage, intro]);

  const notNow = useCallback(() => run(async () => {
    if (stage === "ask-consent") {
      await setIntroductionConsent(false);
      setServer((s) => s && { ...s, offerConsent: false, consent: { enabled: false, answered: true } });
    } else if (stage === "ask-match" && intro) {
      await answerIntroduction(intro.id, "no");
      setServer((s) => s && { ...s, introduction: null });
      setLocal("declined");
    }
  }), [run, stage, intro]);

  const done = useCallback(() => {
    if (stage === "introduced" && intro) {
      run(async () => { await markIntroductionSeen(intro.id); setServer((s) => s && { ...s, introduction: null }); });
      return;
    }
    setLocal(null);
  }, [run, stage, intro]);

  const turnOff = useCallback(() => run(async () => {
    await setIntroductionConsent(false);
    setServer((s) => s && { ...s, introduction: null, offerConsent: false, consent: { enabled: false, answered: true } });
    setLocal("off");
  }), [run]);

  return {
    stage,
    name: intro?.stage === "introduced" ? intro.name : "",
    principle: intro?.stage === "introduced" ? intro.principle : "",
    busy, introduce, notNow, done, turnOff,
  };
}
