/**
 * A STYLESHEET THAT DID NOT ARRIVE MUST NOT COST THE WHOLE SCREEN.
 *
 * This exists because of one measured incident, and the measurement is the
 * reason the fix is this narrow rather than a blanket "ignore preload
 * errors".
 *
 * 2026-08-22, production build, signed-in visitor: `/` rendered as a black
 * rectangle with `#root` empty, whenever `fonts.googleapis.com` OR
 * `cdn.jsdelivr.net` was unreachable — either one alone. The thrown error
 * named the world's own stylesheet:
 *
 *     Error: Unable to preload CSS for /assets/Home-*.css
 *
 * and that error is a lie in the only way that matters. `Home-*.css` was
 * served `200`, with the right `content-type`, and the link element reported
 * `sheet: true` — the browser had already parsed and applied it. The
 * stylesheet the message names is not the stylesheet that failed. The world
 * was withheld over a file it already had.
 *
 * WHAT VITE ACTUALLY DOES, since the fix depends on it exactly. Its preload
 * helper resolves every dependency, then:
 *
 *     for (const r of results) if (r.status === 'rejected') raise(r.reason)
 *     return doImport().catch(raise)
 *
 * where `raise` dispatches a cancellable `vite:preloadError` and rethrows
 * only `if (!event.defaultPrevented)`. So cancelling a *dependency*
 * rejection does not swallow the module — control falls through to the real
 * import, which then runs normally. The worst case after cancelling is a
 * chunk whose CSS genuinely is missing: visibly unstyled, entirely usable,
 * and incomparably better than absent.
 *
 * WHY IT IS NOT BLANKET. That same `raise` is also the handler for the
 * import itself failing (`doImport().catch(raise)`). Cancelling THAT would
 * resolve the module to `undefined`, and `React.lazy` handed `undefined`
 * fails later, further away, with a message about element types that names
 * nothing useful. A missing JavaScript chunk is a real failure and belongs
 * in `<SurfaceBoundary>`, which can say so and offer a reload. So this
 * cancels the CSS case and only the CSS case, identified by the one message
 * Vite emits for it.
 *
 * THE COUPLING IS DELIBERATE AND IS WRITTEN DOWN HERE. Matching on an
 * upstream error string is fragile, and the alternative — cancelling
 * everything — is wrong rather than fragile. If a Vite upgrade changes that
 * message, this stops cancelling, the old black rectangle does NOT come
 * back (the boundary catches it now), and `preload-recovery.test.ts` fails
 * to say so.
 */

/**
 * Vite's message for a stylesheet dependency that never loaded. Anchored at
 * the start rather than matched loosely, because the tail is a path and the
 * head is the claim.
 */
const CSS_PRELOAD_FAILURE = /^Unable to preload CSS for /;

/** Narrow an unknown event payload to something with a readable message. */
export function isStylesheetPreloadFailure(payload: unknown): boolean {
  if (payload instanceof Error) return CSS_PRELOAD_FAILURE.test(payload.message);
  if (typeof payload === "string") return CSS_PRELOAD_FAILURE.test(payload);
  return false;
}

/**
 * Called for each `vite:preloadError`. Returns whether it was handled, which
 * is what the test asserts on — `preventDefault` is the side effect, the
 * boolean is the claim.
 */
export function handlePreloadError(event: Event & { payload?: unknown }): boolean {
  if (!isStylesheetPreloadFailure(event.payload)) return false;
  /* Let the import proceed. The chunk may render unstyled; it will render. */
  event.preventDefault();
  console.warn(
    "[waka] a stylesheet preload failed and was ignored so the screen could still render",
    event.payload,
  );
  return true;
}

/** Wire it up. Called once, from the entry point, before React mounts. */
export function installPreloadRecovery(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    handlePreloadError(event as Event & { payload?: unknown });
  });
}
