/**
 * ═══ WHERE A PERSON IS IN ONBOARDING, AND HOW THEY GET BACK THERE ════════
 *
 * Onboarding is: the name and language, four intro frames, three questions
 * whose answers are ordinary saves, then the first read. It is mandatory
 * ("five minutes, mandatory"), so it has to survive being left halfway — a
 * person who closes the app after the second answer comes back to the
 * third, not to the start.
 *
 * THE SERVER IS THE RECORD OF THE ANSWERS. Each answer is an inspiration, so
 * how many this profile holds IS how many questions are answered — read from
 * `GET /inspirations/snapshot`, which counts the profile's own live saves.
 * That survives a cleared browser and a second device, which a local marker
 * cannot.
 *
 * THE BROWSER IS THE RECORD OF THE TWO STEPS THAT SAVE NOTHING — the name was
 * confirmed, the intro was seen. Scoped to the ACCOUNT, because onboarding is
 * stamped per account (`accounts.onboarding_completed_at`). Losing it costs
 * one screen shown twice, never an answer.
 */

export const ONBOARDING_QUESTIONS = 3;

export type OnboardingStep =
  | { kind: "name" }
  | { kind: "intro" }
  | { kind: "question"; index: number }
  | { kind: "reading" };

export interface OnboardingMarker {
  /** The name and language were confirmed (here, or at password signup). */
  named?: boolean;
  /** The four intro frames were passed. */
  introSeen?: boolean;
}

const key = (accountId: string) => `waka.onboarding:${encodeURIComponent(accountId)}`;

export function readOnboardingMarker(accountId: string | null | undefined): OnboardingMarker {
  if (!accountId) return {};
  try {
    const raw = window.localStorage.getItem(key(accountId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    return { named: value.named === true, introSeen: value.introSeen === true };
  } catch {
    return {};
  }
}

export function writeOnboardingMarker(accountId: string | null | undefined, patch: OnboardingMarker): void {
  if (!accountId) return;
  try {
    const next = { ...readOnboardingMarker(accountId), ...patch };
    window.localStorage.setItem(key(accountId), JSON.stringify(next));
  } catch {
    /* A blocked store costs a repeated screen, never an answer. */
  }
}

/** Finished onboarding leaves nothing behind for the next person on this machine. */
export function clearOnboardingMarker(accountId: string | null | undefined): void {
  if (!accountId) return;
  try { window.localStorage.removeItem(key(accountId)); } catch { /* nothing to keep */ }
}

/**
 * The step to show. Any save at all means the person is past the name and the
 * intro — they could not have answered otherwise — so the server count wins
 * over a marker that was lost.
 */
export function onboardingStep(input: { saved: number; marker: OnboardingMarker; hasName: boolean }): OnboardingStep {
  const saved = Math.max(0, Math.floor(input.saved));
  /* A NAME BEFORE ANYTHING ELSE, whatever has been saved: finishing sends the
     profile's name, and an empty one is refused — so a nameless profile let
     past this would be stuck at the end for good. */
  if (!input.hasName) return { kind: "name" };
  if (saved >= ONBOARDING_QUESTIONS) return { kind: "reading" };
  if (saved > 0) return { kind: "question", index: saved };
  if (!input.marker.named) return { kind: "name" };
  if (!input.marker.introSeen) return { kind: "intro" };
  return { kind: "question", index: 0 };
}

/* WHERE ONBOARDING IS GOING AS IT FINISHES. The moment onboarding is stamped
   done, the route guard sends a finished account away from /onboarding — and
   it renders before any navigation onboarding queued after the stamp (route
   changes are transitions; the session update is not). So onboarding names
   its destination here first, synchronously, and the guard sends the person
   there instead of home.

   READ WITHOUT BEING CONSUMED. The guard reads this during render, and
   StrictMode renders twice: a read that cleared it handed the second render
   nothing, and Talk about this landed at home. Onboarding clears it itself —
   when it leaves the screen, or when the stamp fails. */
let leavingTo: string | null = null;
export function leaveOnboardingFor(destination: string): void { leavingTo = destination; }
export function onboardingExit(): string | null { return leavingTo; }
export function clearOnboardingExit(): void { leavingTo = null; }
