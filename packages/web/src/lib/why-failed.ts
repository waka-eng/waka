/**
 * WHY A REQUEST DID NOT GO THROUGH, IN WORDS A PERSON CAN USE.
 *
 * There were two of these. `Home.tsx`'s `whyFailed` turned an error into a
 * clause — "the server could not be reached", "you are signed out" — and the
 * boot's failure screen built its own from `${err.status} — ${err.message}`.
 * They diverged exactly where it costs most: with the network dead, the world
 * said
 *
 *     That didn't keep. The words are still here — the server could not be reached.
 *
 * and the screen a person meets when the world cannot be poured at all said
 *
 *     0 — Failed to load your captures: network unreachable
 *
 * A status of `0` is the client's way of saying it never got an answer. It is
 * not a number a person has any use for, and printing it is the same mistake
 * as printing `Failed to fetch`: an internal fact rendered as prose. Found by
 * walking the production failure screen, which nothing had ever walked —
 * every other walk runs against a dev build where a fixture wins instead.
 *
 * One function now, two callers. The next divergence has to be deliberate.
 */
import { ApiError } from "./api";
import { formatMessage, t, type SupportedLocale } from "./locales";

/**
 * The reason clause on its own — no leading sentence, no trailing full stop
 * discipline beyond what each case needs. Empty string when there is nothing
 * to add beyond the caller's own words. Speaks the caller's locale; the
 * server's own message stays as the server said it.
 */
export function whyOf(err: unknown, locale: SupportedLocale = "en-US"): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t(locale, "worldWhyUnreachable");
    if (err.status === 401) return t(locale, "worldWhySignedOut");
    return formatMessage(locale, "worldWhyServerSaidNo", {
      status: err.status,
      message: err.message,
    });
  }
  if (err instanceof Error && err.message) return err.message;
  return "";
}

/**
 * A finished sentence: what the caller was trying to do, then why it did not.
 *
 * THE FULL STOP COMES OFF BEFORE THE DASH. Every caller writes its fallback as
 * a finished sentence — "That was not saved." — because that is what it says
 * on its own when there is nothing to add. Appending to it produced
 * "That was not saved. — the server said no (500): …" everywhere in the
 * product until six of them were put side by side for the first time.
 */
export function whyFailed(
  err: unknown,
  fallback: string,
  locale: SupportedLocale = "en-US",
): string {
  const why = whyOf(err, locale);
  if (why === "") return fallback;
  return `${fallback.replace(/\.\s*$/, "")} — ${why}`;
}
