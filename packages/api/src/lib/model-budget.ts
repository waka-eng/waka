/**
 * How much of the shared model key one account may spend in an hour.
 *
 * There is a single Gemini API key behind the whole pipeline. Every job type
 * ends in a call against it — enrichment describes an image, derivation
 * extracts candidates, embeds them, and sometimes asks the merge judge, and a
 * synthesis writes a whole artifact — so the queue's throughput *is* the key's
 * spend. Until this existed, nothing bounded that per account: one signup
 * could save ten thousand things, watch the queue turn each one into three
 * jobs, and take generation down for everybody else on the shared key. The
 * attacker never has to break anything; they only have to use the product
 * enthusiastically.
 *
 * The rule is a sliding window rather than a fixed bucket. A fixed hourly
 * bucket has a seam at the top of the hour where twice the budget can be spent
 * in two minutes, and the whole point here is that a burst is the attack. A
 * sliding window has no seam: the count is always "starts in the last hour",
 * and a slot comes back exactly one hour after the start that took it.
 *
 * What this module deliberately does NOT do is refuse anything. It reports a
 * verdict; the queue defers over-budget work by pushing `run_after`, which is
 * the same mechanism retry backoff already uses. Nobody's memory is dropped
 * for being enthusiastic — it is distilled later.
 */

/** The window every count below is taken over. */
export const MODEL_BUDGET_WINDOW_MS = 60 * 60 * 1_000;

/**
 * Jobs one account may *start* per window.
 *
 * Derived from the pipeline's own arithmetic rather than from a guess at what
 * traffic looks like: one capture costs at most three jobs end to end (enrich
 * the attachment → derive its signals → re-synthesize the top of mind, and the
 * last is debounced to one live refresh per profile). Sixty jobs an hour is
 * therefore roughly twenty saves an hour, sustained, hour after hour — more
 * than a person types by hand, and a bulk import is spread across a few hours
 * rather than turned away.
 *
 * A module constant and not an environment variable, for the same reason the
 * generation model is pinned in code: a budget that can be raised without a
 * diff is a budget that gets raised at 2am by whoever is being paged, and the
 * thing it protects is shared by every other account.
 */
export const MODEL_BUDGET_JOBS_PER_ACCOUNT = 60;

/**
 * Nudge the release past the start that frees it.
 *
 * Waking at exactly `oldestStart + window` re-reads a window whose boundary is
 * inclusive, counts that same start one last time, and defers again — a
 * one-second loop that goes nowhere. The queue's local scheduler adds the same
 * kind of margin to its own wake-ups for the same reason.
 */
export const MODEL_BUDGET_RELEASE_MARGIN_MS = 1_000;

/** What an account has already spent inside the current window. */
export interface AccountModelUsage {
  /** Jobs of this account's profiles that started inside the window. */
  startedInWindow: number;
  /**
   * The oldest of those starts, or null when there are none. It is what says
   * *when* the window frees a slot, so a deferral can name a time instead of
   * guessing one.
   */
  oldestStartInWindow: Date | null;
}

export type ModelBudgetVerdict =
  | { withinBudget: true; remaining: number }
  | { withinBudget: false; retryAfter: Date };

/** The start of the window a usage count must be taken over. */
export function modelBudgetWindowStart(now: Date): Date {
  return new Date(now.getTime() - MODEL_BUDGET_WINDOW_MS);
}

/**
 * Decide whether this account may start another job right now, and if not,
 * when it may.
 *
 * Pure on purpose. Reading the usage needs a database and deferring the work
 * needs a write, but *the rule itself* is arithmetic, and arithmetic that only
 * runs against a live Postgres is arithmetic nobody has watched hold.
 */
export function assessModelBudget(usage: AccountModelUsage, now: Date): ModelBudgetVerdict {
  const startedInWindow = Math.max(0, usage.startedInWindow);
  if (startedInWindow < MODEL_BUDGET_JOBS_PER_ACCOUNT) {
    return { withinBudget: true, remaining: MODEL_BUDGET_JOBS_PER_ACCOUNT - startedInWindow };
  }

  // The oldest start is the one whose slot returns first. Without one — a
  // count that disagrees with its own minimum, which should not happen — wait
  // a whole window rather than assuming the budget is free: guessing high
  // costs one account some latency, guessing low costs everyone the key.
  const release = usage.oldestStartInWindow
    ? usage.oldestStartInWindow.getTime() + MODEL_BUDGET_WINDOW_MS
    : now.getTime() + MODEL_BUDGET_WINDOW_MS;

  return {
    withinBudget: false,
    retryAfter: new Date(
      Math.max(release, now.getTime()) + MODEL_BUDGET_RELEASE_MARGIN_MS,
    ),
  };
}
