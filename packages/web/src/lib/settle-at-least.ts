/**
 * A RETRY THAT SAYS "RETRYING…" FOR LONG ENOUGH TO BE READ.
 *
 * The server keeps no retry cooldown (a provider refusal costs nothing per
 * press), so the guard against a button pressed over and over is the button:
 * it disables itself and says "Retrying…" until its request answers. A
 * request that answers in 80 ms would flash the word and re-arm the button at
 * once, so the wait is held to a minimum. The promise settles the way the
 * request did — value or error — no sooner than `ms` after it started.
 */
const RETRY_MIN_MS = 3_000;

export function settleAtLeast<T>(work: Promise<T>, ms = RETRY_MIN_MS): Promise<T> {
  const floor = new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });
  return Promise.allSettled([work, floor]).then(([result]) => {
    if (result.status === 'fulfilled') return result.value;
    throw result.reason;
  });
}

/** How long a retry/refresh POST may take before it counts as failed: a hung
    request must not leave a Retry button disabled forever. */
const POST_DEADLINE_MS = 20_000;

/** Runs `run` with an AbortSignal that fires after `POST_DEADLINE_MS`. */
export async function withPostDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms = POST_DEADLINE_MS): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  try { return await run(controller.signal); } finally { window.clearTimeout(timer); }
}
