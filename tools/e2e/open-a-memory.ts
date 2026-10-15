/**
 * OPENING A MEMORY, WRITTEN ONCE — the same reason `keep.ts` exists.
 *
 * Three gates had their own copy of this by 2026-10-15: `journeys.ts`, which
 * worked it out and wrote the reasoning below; `when-it-fails.ts`, which was
 * still on the dead `.jar-saved` sweep; and `at-scale.ts`, which was too. Two
 * of the three were measuring nothing, and the one that was right had no way
 * to tell the others. `keep.ts`'s header says what that costs — "that is not
 * eleven bugs; it is one fact written down eleven times, and the eleventh
 * copy is as stale as the first" — so the fact lives here now.
 *
 * IT IS ALSO THE DOOR INTO THE GROUND, not only the way to open a card. The
 * descent used to be `.jar-saved` at the bottom edge of the world; that class
 * has no renderer, and `openSearchResult` navigates with `section: 'field'`,
 * so landing a memory IS arriving in the field. Callers that want the ground
 * — `.jar-reach` and its options — get there by calling this.
 *
 * `journeys.ts`'s own account of why the sweep went follows, unchanged.
 */
import type { Page } from "playwright";

/**
 * OPENING A MEMORY, BY ASKING THE WORLD FOR IT.
 *
 * ── THIS CLICKED THREE HUNDRED COORDINATES AND COULD NOT GET IN ───────────
 *
 * It pressed `.jar-saved` to descend into the field and then swept a grid of
 * `mouse.click` across the canvas looking for one painted orb. Both halves
 * are gone. `.jar-saved` has no renderer — the only mentions left in
 * `Home.tsx` hand the string to `querySelector` — so the descent could only
 * time out, after which the sweep clicked three hundred times on the world's
 * chrome and reported "no memory would open in the field".
 *
 * MEASURED 2026-10-12, LOOKING FOR THE DOOR RATHER THAN CONCLUDING FROM ITS
 * ABSENCE, because the first conclusion was wrong:
 *
 *   `?view=field` DOES NOT WORK. `view-location.ts` parses the parameter, but
 *   a cold load at that address lands on `/` with it dropped.
 *   `standIn` CALLS `toGround()` and is group-only, so it went with rooms.
 *   FIND DOES WORK. `/` opens the search — `Home.tsx` puts it there on
 *   purpose, "find → the FIELD. It is a verb about memories, so it sits with
 *   them and answers with `/`" — and `openSearchResult` navigates with
 *   `section: 'field'` and the memory's own id, which lands in the ground with
 *   `.jar-panel` already open on it.
 *
 * ── AND THE HARNESS GETS A CLAIM IT COULD NOT MAKE BEFORE ─────────────────
 *
 * The sweep could not aim: whichever orb it happened to hit was the memory
 * that opened, so every caller's claim had to be weakened to "any of them"
 * ("insisting on a particular one would only be insisting the harness can
 * aim"). Asking for a memory BY ITS WORDS opens that one. `phrase` is
 * optional so the old any-of-them callers are unchanged, and the ones that
 * care can now say which.
 *
 * The viewport argument is gone with the sweep. It existed because the grid
 * was in viewport pixels and `the-hand` walks at 390x844, where every x past
 * 390 is off the glass — "a sweep that silently clicked into space for two
 * thirds of its passes and then reported no memory opened as if the product
 * had failed". A search field and a list of results need no coordinates at
 * all, so the whole class of defect goes with the argument.
 */
export async function openAMemory(page: Page, phrase?: string): Promise<boolean> {
  const panels = async (): Promise<number> =>
    (await page.evaluate(() => document.querySelectorAll(".jar-panel").length)) as number;
  try {
    /* ── A WORD THAT IS REALLY ON THIS WALL, ASKED OF THE WALL ────────────
       With no phrase given, any memory will do — but the search ignores a
       query shorter than two characters (`InspirationSearch`: `if
       (query.length < 2) { setRead(null); … }`), and the first version of
       this typed `a` and got nothing. It then reported "no memory would open
       in the field", which is a statement about the product and was a
       statement about the query. Caught by running it.
       Guessing a longer word is the same bet one letter longer: the phrases
       these journeys keep are ordinary English and share almost nothing. So
       the word is taken FROM the wall — the longest in the newest memory's
       own preview — which cannot miss unless the archive is empty, and an
       empty archive is a different finding that the caller already makes. */
    const want =
      phrase ??
      ((await page.evaluate(async () => {
        const r = await fetch("/api/inspirations?limit=1", { credentials: "include" });
        if (!r.ok) return "";
        const body = (await r.json()) as { inspirations?: Array<{ textPreview: string }> };
        const words = (body.inspirations?.[0]?.textPreview ?? "").split(/[^A-Za-z]+/);
        let best = "";
        for (const word of words) if (word.length > best.length) best = word;
        return best;
      })) as string);
    if (want.trim().length < 2) return false;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("/");
    await page.waitForTimeout(1_500);
    if ((await page.locator(".jar-inspiration-search").count()) === 0) return false;
    await page.keyboard.type(want);
    await page.waitForTimeout(3_500);
    const result = page
      .locator(".jar-search-results button", {
        hasText: new RegExp(want.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      })
      .first();
    if ((await result.count()) === 0) return false;
    await result.click({ timeout: 8_000 });
    await page.waitForTimeout(6_000);
    if ((await panels()) === 0) return false;
    /* THE "STAYS" IS LOAD-BEARING and is kept from the sweep: a closing card
       lingers in the DOM for 200ms, so a check that stops at the first
       `.jar-panel` it sees can catch the tail of one already dismissed. */
    await page.waitForTimeout(1_200);
    return (await panels()) > 0;
  } catch (err) {
    /* A THROW IS NOT "NO MEMORIES", AND SAYING SO MATTERS. Six gates route
       through this helper, and in `dead-css` a `false` puts the card's whole
       selector family on the "never on screen" list — which that file says
       itself gets rules DELETED. A page error, a timeout, a 500 and an empty
       archive all returned the same bare `false`, so the most alarming of
       those four was indistinguishable from the most ordinary. The return
       stays `false` (every caller handles it), but the reason is printed so
       a caller's "not walked" can be read against what actually happened. */
    console.log(
      `  [open-a-memory] threw rather than finding nothing: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    );
    return false;
  }
}
