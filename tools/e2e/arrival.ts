/**
 * WAITING OUT THE WELCOME.
 *
 * Arriving at the world with something new in it is not a still page. The
 * greeting glides the camera to the newest memory 1.4s after the world is
 * ready, holds it open, and lets it go 2.6s after that — four seconds in
 * which a card is legitimately centred over everything behind it. That is a
 * designed welcome, not a defect: "what arrived while you were gone — shown
 * by going there, not by saying so".
 *
 * It is also four seconds in which no walk can measure anything about the
 * page underneath. Three separate gates raced it and each read the collision
 * as a different bug:
 *
 *   `journeys` (entry-actions)  three of the four verbs "cannot be hit at
 *                               their own centre" — a card's foot was over
 *                               them. It passed on a fast machine, where the
 *                               greeting finishes before the poster band
 *                               opens, and failed on CI, where it does not.
 *   `phone`                     "no memory could be opened" — the sweep spent
 *                               its passes on a card the greeting had already
 *                               opened and was about to close.
 *   `answers-the-hand`          written after the first two, and would have
 *                               been the third.
 *
 * Each one was about to grow its own private timing. So the rule lives here:
 * wait for the world to be READY, wait out the greeting's whole window, and
 * press Escape once for whatever survived. Anything measured after this is
 * measured against a page that has stopped moving.
 *
 * `.jar-hq` ATTACHED, NOT VISIBLE. It is the ready gate itself — the world
 * renders it and the loading ground in the same ternary — so waiting for it
 * is waiting for exactly the condition, not for a proxy. But the layer takes
 * no pointer, so the world stays draggable through it, and Playwright's
 * default `visible` never matches it: waiting the default way times out on a
 * world that is fully standing.
 */
import type { Page } from "playwright";

/** 1.4s to the glide, 2.6s to the release, and a beat for the ease. */
export const GREETING_WINDOW_MS = 1_400 + 2_600 + 600;

/**
 * Hold until the world has arrived, greeted, and gone quiet.
 *
 * @returns the class list of anything still standing over the world, or null
 *          if it is clear — a caller that cares can say what it found rather
 *          than reporting a symptom with no suspect.
 */
export async function settleAfterArrival(page: Page): Promise<string | null> {
  await page.waitForSelector(".jar-hq", { state: "attached", timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(GREETING_WINDOW_MS);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return (await page.evaluate(() => {
    const over = document.querySelector(".jar-panel");
    return over ? over.className : null;
  })) as string | null;
}
