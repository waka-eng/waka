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
 *
 * ── THE LOCALE IS NOT OPTIONAL, AND IT USED TO BE ─────────────────────────
 *
 * Both functions below took `locale: SupportedLocale = "en-US"`. That default
 * is the whole of a localisation bug written as a convenience: omit the third
 * argument and the function still compiles, still returns a sentence, still
 * reads like working code — and a Korean reader gets
 *
 *     저장되지 않았어요 — The server could not be reached.
 *
 * half a sentence in each language, with `worldWhyUnreachable`'s Korean row
 * sitting in the catalogue two inches away and unreachable. There is no
 * caller for whom English-regardless is the right answer: every surface that
 * speaks a failure already holds the reader's locale, because it needed one
 * to write its own fallback clause.
 *
 * SO THE PARAMETER IS REQUIRED. This is deliberately not a test. A test can
 * only fail on the call sites it thought to look at, and the failure mode here
 * is a NEW call site written next year by someone who never read this file —
 * exactly the shape a test cannot cover and a type can. `tsc --noEmit` now
 * refuses the omission at the call site, in the editor, before the code runs:
 * the strongest form of this guarantee available, and the reason no gate was
 * added beside it.
 *
 * The default was also load-bearing in the wrong direction — it made the
 * *absence* of a locale indistinguishable from a deliberate "say this in
 * English", so no reader of a call site could tell which had been meant.
 * Required means every call site states its answer.
 */
import { ApiError } from "./api";
import { PhotoRefused } from "./inspiration-photo";
import { formatMessage, t, type SupportedLocale } from "./locales";

/**
 * The reason clause on its own — no leading sentence, no trailing full stop
 * discipline beyond what each case needs. Empty string when there is nothing
 * to add beyond the caller's own words. Speaks the caller's locale; the
 * server's own message stays as the server said it.
 *
 * ONE PART OF THIS STAYS ENGLISH AND HAS TO. `worldWhyServerSaidNo` embeds
 * `{message}`, which is whatever the API client threw — written in English in
 * `lib/api`, and deliberately so: `copy.test.ts` records that those strings
 * are copy precisely because this function puts them on screen. Translating
 * them is a separate job in a separate package. What this function owes the
 * reader is that every word IT chooses is in their language.
 */
export function whyOf(err: unknown, locale: SupportedLocale): string {
  /* A PHOTO REFUSED BY THE SNIFFER SPEAKS THE READER'S LANGUAGE. The three
     refusals in `lib/inspiration-photo.ts` used to be finished English
     sentences thrown from a lib and printed verbatim — so a Korean reader
     got their own language for the frame and English for the reason, the
     exact half-translated shape this function's `locale` argument was made
     required to stop.

     IT IS RESOLVED HERE RATHER THAN AT THE FOUR CALL SITES because this is
     the one place that holds both facts: which refusal it was, and whose
     screen it is going to. Three of those call sites are in `Home.tsx`. */
  if (err instanceof PhotoRefused) return t(locale, err.reason);
  if (err instanceof ApiError) {
    if (err.status === 0) return t(locale, "worldWhyUnreachable");
    if (err.status === 401) return t(locale, "worldWhySignedOut");
    /* 402 IS THE MODEL PROVIDER OUT OF CREDIT, which is ours to fix and not
       the reader's. "The server said no (402): …" read like a payment demand
       aimed at them, about a thing they cannot see. What they need to know
       is the two facts that are true: reading has stopped for now, and what
       they kept is kept. */
    if (err.status === 402) return t(locale, "worldWhyOutOfCredit");
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
  locale: SupportedLocale,
): string {
  const why = whyOf(err, locale);
  if (why === "") return fallback;
  return `${fallback.replace(/\.\s*$/, "")} — ${why}`;
}
