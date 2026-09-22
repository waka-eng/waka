/**
 * THE COMPANION'S OWN LIGHT — how long since you last kept something.
 *
 * Founder, 2026-09-22: *"a feature of your character losing light if you
 * don't save inspirations for a while. this motivates user to place
 * themselves in environments to get inspired and stuff and realize they are
 * lacking inspiration in life."*
 *
 * ── THIS REVERSES A RULING, AND THE RULING IS WORTH QUOTING ───────────────
 *
 * The creature's body used to fade with the archive, and it was deliberately
 * stopped. `Home.tsx` still carries the reasoning:
 *
 *   "A quiet week made the creature look like it was dying, and a face that
 *    dims because you have been busy is a face that grades you. The Calm
 *    Technology precedent everyone cites for this — a string on a wall
 *    twitching with network traffic — showed the NETWORK's state. Nobody
 *    feels judged by a network."
 *
 * So `bodyLit` was floored at 0.55 and the archive's aliveness was left
 * governing only the aura's REACH — "a quiet archive is a companion sitting
 * close to itself; a live one throws light across the room."
 *
 * The objection was that the creature grades you. The founder's instruction
 * answers it rather than overlooking it: grading is the point. A person who
 * has kept nothing for three weeks is meant to notice, because noticing is
 * the product. What the old ruling protected against was the creature looking
 * DEAD, and that protection is kept below, in a floor with a reason.
 *
 * ── AND IT MEASURES SOMETHING DIFFERENT FROM WHAT IT USED TO ──────────────
 *
 * The old body light read `insp` — the mean of the brightest eight memories.
 * That conflates two facts: how much you have built, and how long since you
 * last came back. A person with two hundred rich memories and a silent month
 * still scored high; a person with three memories kept this morning scored
 * low. Neither is what the founder asked for.
 *
 * This reads ONE fact: `nowMs - lastKeptMs`. That leaves the split clean and
 * each channel saying one thing:
 *
 *   THE BODY   how recently you tended it          — your rhythm
 *   THE AURA   how alive the archive is (`insp`)   — what you have built
 *
 * ── THE FLOOR IS NOT A TASTE NUMBER ───────────────────────────────────────
 *
 * `BODY_TIERS` is 4 and the frame picks one with `round(bodyLit * 3)`. Under
 * the old floor of 0.55 that expression can only ever return 2 or 3: the body
 * has four baked forms and has been using two of them. The dimmest form —
 * tier 0 — is the one that reads as gone out, and the old ruling is right that
 * a person must never be shown it for having had a week.
 *
 * So the floor is the value that lands exactly on TIER 1: dimmer than anything
 * the product has shown before, one full step brighter than dark, and an exact
 * landing rather than a rounding accident. `0.34 * 3 = 1.02`, which rounds to
 * 1 with room on both sides — tier 0 ends at 0.167, tier 2 begins at 0.5.
 *
 * The companion therefore has three visible states instead of two, which is
 * also the founder's law that states render and numerals never: a person sees
 * their companion bright, dimmed, or low, and never a number of days.
 *
 * ── NEVER KEPT ANYTHING IS NOT THE SAME AS STOPPED KEEPING ────────────────
 *
 * A new account has no last keep. Decaying from zero would greet a person, in
 * their first sixty seconds, with a creature at its dimmest for a silence that
 * is not theirs — the exact shape of the bug `first-sixty.ts` exists to catch.
 * `null` reads as full light. The clock starts when you first keep something.
 *
 * ── THE NUMBERS ───────────────────────────────────────────────────────────
 *
 * Both are slower than the field's own 7-day half-life, on purpose. A memory
 * fading is a statement about that memory; the companion dimming is a
 * statement about the person, and it should be harder to provoke.
 */

import { clamp01, DAY_MS } from "../lib/num";
import { BODY_TIERS } from "./raster";

/**
 * Days of silence that cost nothing. A weekend away, or a week of shipping,
 * is not a person losing touch with their own life — and a companion that
 * reacted to one busy Tuesday would teach people to ignore it.
 */
export const TENDING_GRACE_DAYS = 2;

/**
 * Half-life of the companion's light once the grace is spent.
 *
 * MEASURED, not estimated, by walking the three numbers day by day and
 * printing the tier each one selects:
 *
 *   tier 3, full        day 0    to day 4.10
 *   tier 2, dimmed      day 4.10 to day 12.22
 *   tier 1, low         day 12.22 onward, and never tier 0
 *
 * Those two edges are found by bisection, not by sampling — an earlier pass
 * walked half-days and reported 4.5 and 12.5, which are the first SAMPLES
 * that had already stepped rather than the steps themselves. The test below
 * asserts the real ones, so this paragraph cannot drift away from them.
 *
 * A busy working week shows nothing at all. A fortnight is unmistakable and
 * still unmistakably alive.
 */
export const TENDING_HALF_LIFE_DAYS = 5;

/**
 * The dimmest the body may go: exactly tier 1 of `BODY_TIERS`. See the floor
 * note above — this is one full step brighter than the form that reads as
 * gone out, and that step is the whole of the old ruling that survives.
 */
export const TENDING_FLOOR = 0.34;

/**
 * How tended the companion is, 0 to 1, from the one fact this measures.
 *
 * Takes its clock as an argument rather than reading `Date.now()`, for the
 * reason `noticeLight` and `canvas/scale.ts` do: a test with no browser to
 * run frames in has to be able to ask what a fortnight looks like.
 *
 * @param lastKeptMs when the newest memory on the ground was kept, or `null`
 *                   if nothing has ever been kept
 * @param nowMs      the moment being drawn
 */
export function tended(lastKeptMs: number | null, nowMs: number): number {
  if (lastKeptMs === null) return 1;
  const days = (nowMs - lastKeptMs) / DAY_MS;
  /* A memory kept in the future is a clock disagreement, not a fact about the
     person; it reads as tended rather than as anything stranger. */
  if (days <= TENDING_GRACE_DAYS) return 1;
  return clamp01(Math.pow(2, -(days - TENDING_GRACE_DAYS) / TENDING_HALF_LIFE_DAYS));
}

/**
 * The body's light, floored. This is what `bodyLit` becomes.
 */
export function companionLight(lastKeptMs: number | null, nowMs: number): number {
  return clamp01(TENDING_FLOOR + tended(lastKeptMs, nowMs) * (1 - TENDING_FLOOR));
}

/**
 * Which baked form that light selects — the same expression the frame uses,
 * exported so a test can assert the STATE a person sees rather than a float
 * nobody can look at.
 */
export function companionTier(lastKeptMs: number | null, nowMs: number): number {
  return Math.round(companionLight(lastKeptMs, nowMs) * (BODY_TIERS - 1));
}
