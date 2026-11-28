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
 *
 * A LOCAL LINE NEVER HIDES THE SERVER. An ask or an introduction the server
 * returns always wins over the line answering the last act; the local line
 * is only what fills the bubble while the server has nothing to say.
 *
 * KEPT FRESH: read on arrival, every few seconds for a minute after every
 * act (a match pass is queued then, and the next ask may follow), whenever
 * the tab comes back, and whenever Settings flips the switch
 * (`INTRODUCTIONS_CHANGED`). Keyed on the profile: another person signing in
 * on this browser starts from nothing.
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

/** Dispatched on `window` when introductions are turned on or off elsewhere (Settings). */
export const INTRODUCTIONS_CHANGED = "waka:introductions-changed";

const POLL_MS = 5_000;
const POLL_FOR_MS = 60_000;

export interface Introductions {
  stage: IntroductionStage | null;
  /** This person's own words for the principle they share, on `introduced` only. */
  principle: string;
  busy: boolean;
  introduce(): void;
  notNow(): void;
  done(): void;
  turnOff(): void;
}

type Local = Exclude<IntroductionStage, "ask-consent" | "ask-match" | "introduced">;

/* Tells Settings (and anything else listening) that the switch moved. Home's
   own listener ignores its own announcement by `source`. */
const announce = (enabled: boolean) =>
  window.dispatchEvent(new CustomEvent(INTRODUCTIONS_CHANGED, { detail: { enabled, source: "home" } }));

/** `profileId` is the signed-in person's own profile on their own home, or null. */
export function useIntroductions(profileId: string | null): Introductions {
  const active = Boolean(profileId);
  const [server, setServer] = useState<ApiIntroductionState | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const poll = useRef<{ timer: number; until: number }>({ timer: 0, until: 0 });
  useEffect(() => { alive.current = true; return () => { alive.current = false; window.clearTimeout(poll.current.timer); }; }, []);

  /* A read that lands after the profile changed is dropped, not shown. */
  const current = useRef(profileId);
  current.current = profileId;
  const load = useCallback(() => {
    if (!profileId) return;
    const asked = profileId;
    void fetchIntroductions().then((next) => { if (alive.current && current.current === asked) setServer(next); }).catch(() => undefined);
  }, [profileId]);
  /** Read now and every few seconds for a minute: the first match is made right after turning on. */
  const pollAwhile = useCallback(() => {
    window.clearTimeout(poll.current.timer);
    poll.current.until = Date.now() + POLL_FOR_MS;
    const tick = () => {
      load();
      if (Date.now() + POLL_MS <= poll.current.until) poll.current.timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
  }, [load]);
  useEffect(() => {
    setServer(null); setLocal(null); window.clearTimeout(poll.current.timer);
    if (!active) return undefined;
    load();
    const back = () => { if (document.visibilityState === "visible") load(); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ source?: string }>).detail?.source === "home") return;
      setLocal(null);
      if ((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled) pollAwhile(); else load();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener(INTRODUCTIONS_CHANGED, changed);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener(INTRODUCTIONS_CHANGED, changed);
    };
  }, [active, profileId, load, pollAwhile]);

  const shown = server?.available ? server : null;
  const intro = shown?.introduction ?? null;
  const stage: IntroductionStage | null =
    intro?.stage === "introduced" ? "introduced" : intro?.stage === "ask" ? "ask-match"
      : local ?? (shown?.offerConsent ? "ask-consent" : null);

  const run = useCallback((work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void work().catch(() => { setLocal(null); load(); }).finally(() => { if (alive.current) setBusy(false); });
  }, [busy, load]);

  const introduce = useCallback(() => run(async () => {
    if (stage === "ask-consent") {
      await setIntroductionConsent(true);
      announce(true);
      setServer((s) => s && { ...s, offerConsent: false, consent: { enabled: true, answered: true } });
      setLocal("on");
      pollAwhile();
    } else if (stage === "ask-match" && intro) {
      const result = await answerIntroduction(intro.id, "yes");
      if (result.stage === "introduced") setServer((s) => s && { ...s, introduction: result });
      else { setServer((s) => s && { ...s, introduction: null }); setLocal("waiting"); pollAwhile(); }
    }
  }), [run, stage, intro, pollAwhile]);

  const notNow = useCallback(() => run(async () => {
    if (stage === "ask-consent") {
      await setIntroductionConsent(false);
      setServer((s) => s && { ...s, offerConsent: false, consent: { enabled: false, answered: true } });
    } else if (stage === "ask-match" && intro) {
      await answerIntroduction(intro.id, "no");
      setServer((s) => s && { ...s, introduction: null });
      setLocal("declined");
      pollAwhile();
    }
  }), [run, stage, intro, pollAwhile]);

  const done = useCallback(() => {
    if (stage === "introduced" && intro) {
      run(async () => { await markIntroductionSeen(intro.id); setServer((s) => s && { ...s, introduction: null }); pollAwhile(); });
      return;
    }
    setLocal(null);
    pollAwhile();
  }, [run, stage, intro, pollAwhile]);

  const turnOff = useCallback(() => run(async () => {
    await setIntroductionConsent(false);
    announce(false);
    window.clearTimeout(poll.current.timer);
    setServer((s) => s && { ...s, introduction: null, offerConsent: false, consent: { enabled: false, answered: true } });
    setLocal("off");
  }), [run]);

  return {
    stage,
    principle: intro?.stage === "introduced" ? intro.principle : "",
    busy, introduce, notNow, done, turnOff,
  };
}
