/**
 * ═══ THE FIRST READ, ACROSS THE THREE ANSWERS ═══════════════════════════
 *
 * Three different answers usually mint three separate EMERGING signals —
 * promotion to active needs three pieces of evidence on one — so there is no
 * single signal to show. The first read is a top of mind across the three,
 * labelled as early (founder decision on the onboarding canvas, question 1).
 *
 * WHY THE CLIENT ASKS FOR IT, AND WHEN. Saving enqueues signal derivation;
 * derivation enqueues a top-of-mind refresh only when a signal changed, and
 * once a profile has any version that refresh is held for a day. The first
 * version can land after just two answers, so the third would wait a day.
 * A MANUAL refresh (`POST /top-of-mind/refresh`) is not held — but it does not
 * wait for derivation either, so asked too early it reads two answers, not
 * three. So: wait until each answer is past derivation, THEN ask, then wait
 * for that job, then read the current top of mind. No new API.
 *
 * IT OUTLIVES THE SCREEN. The screen waits about twenty seconds and then lets
 * the person into home (founder decision, question 2); this keeps going in
 * module scope, so the refresh is still asked for once derivation finishes,
 * and home's own thirty-second re-read shows the result when it lands.
 */
import {
  fetchInspirationProcessing,
  fetchTopOfMind,
  fetchTopOfMindRefresh,
  refreshTopOfMind,
  type ApiTopOfMind,
} from "./api";

export interface FirstReadDeps {
  processing: typeof fetchInspirationProcessing;
  refresh: typeof refreshTopOfMind;
  refreshStatus: typeof fetchTopOfMindRefresh;
  current: typeof fetchTopOfMind;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

const realDeps: FirstReadDeps = {
  processing: fetchInspirationProcessing,
  refresh: refreshTopOfMind,
  refreshStatus: fetchTopOfMindRefresh,
  current: fetchTopOfMind,
  wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Long enough for a slow model, short enough that nothing polls forever. */
const OUTER_LIMIT_MS = 180_000;

/** The sentence a reading leads with: held first, else first in order. */
export function leadOf(reading: ApiTopOfMind | null): string | null {
  const live = (reading?.entries ?? []).filter((entry) => !entry.dismissed && entry.body.trim());
  if (!live.length) return null;
  const ordered = [...live].sort((a, b) => a.sortOrder - b.sortOrder);
  return (ordered.find((entry) => entry.pinned) ?? ordered[0]!).body.trim();
}

async function pastDerivation(profileId: string, inspirationId: string, deps: FirstReadDeps, until: number): Promise<void> {
  let errors = 0;
  while (deps.now() < until) {
    try {
      const state = await deps.processing(inspirationId, { profile: profileId });
      errors = 0;
      const deriving = state.stage === "enrichment" || state.stage === "derivation";
      if (state.phase === "ready" || state.phase === "failed" || state.phase === "unknown" || !deriving) return;
    } catch {
      /* A status read that fails is not a reason to never ask for the read. */
      errors += 1;
      if (errors >= 3) return;
    }
    await deps.wait(1000);
  }
}

async function runFirstRead(profileId: string, inspirationIds: string[], deps: FirstReadDeps): Promise<string | null> {
  const until = deps.now() + OUTER_LIMIT_MS;
  for (const id of inspirationIds) await pastDerivation(profileId, id, deps, until);
  const receipt = await deps.refresh();
  let polls = 0;
  while (deps.now() < until) {
    const state = await deps.refreshStatus(receipt.jobId, undefined, receipt.requestVersion).catch(() => null);
    if (state?.status === "succeeded" || state?.status === "failed" || state?.status === "unknown") break;
    polls += 1;
    await deps.wait(Math.min(4000, 800 + polls * 400));
  }
  return leadOf(await deps.current({ profile: profileId }));
}

const running = new Map<string, Promise<string | null>>();

/**
 * Start (or join) the first read for this profile. The promise resolves with
 * the lead sentence, or null when nothing could be read; it never rejects.
 */
export function requestFirstRead(profileId: string, inspirationIds: string[], deps: FirstReadDeps = realDeps): Promise<string | null> {
  const already = running.get(profileId);
  if (already) return already;
  const work = runFirstRead(profileId, inspirationIds, deps)
    .catch(() => null)
    .finally(() => { running.delete(profileId); });
  running.set(profileId, work);
  return work;
}

/** Race the read against the screen's patience; null means "go in anyway". */
export function withinBudget<T>(work: Promise<T | null>, budgetMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), budgetMs);
    void work.then((value) => { window.clearTimeout(timer); resolve(value); }, () => { window.clearTimeout(timer); resolve(null); });
  });
}
