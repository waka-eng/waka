/**
 * SAVING AN INSPIRATION, WRITTEN ONCE.
 *
 * Eleven gates needed a world with something in it, and eleven gates said so
 * by pasting the same four lines:
 *
 *     await page.locator(".jar-mouth-rest").first().click();
 *     await page.waitForTimeout(700);
 *     await page.fill('textarea[aria-label="Capture inspiration"]', text);
 *     await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
 *
 * `.jar-mouth-where` HAS NOT EXISTED IN A COMPONENT FOR WEEKS. It survives
 * only as unreachable rules in `home.css`, so every one of those locators
 * waits thirty seconds and throws — `pnpm e2e:by-keyboard` crashes on it
 * outright. That is not eleven bugs; it is one fact written down eleven
 * times, and the eleventh copy is as stale as the first.
 *
 * It also explains why a whole class of defect shipped unaudited. The
 * keyboard gate is the one that would have found three invisible tab stops
 * on the home screen, and it has not completed a run since the composer was
 * reworked. A gate that cannot reach the product is not a loose gate, it is
 * an absent one, and it reports nothing while looking exactly like a gate.
 *
 * WHICH DOOR THIS USES, AND WHY NOT THE ADDRESS. `?compose=1` opens the
 * notepad too and is one line shorter, and it navigates — which several of
 * these gates cannot afford mid-flow, and which is in any case not the
 * gesture under test. The dock's plus is what a person presses, it works
 * from every screen, and it leaves the page where it was.
 *
 * AND `.jar-mouth-rest` IS NOT A DOOR AT ALL ANY MORE. It is the closed
 * composer slot — `opacity: 0`, and now `inert`, because it was in the tab
 * order on every screen in the product. Playwright would have refused to
 * click it, which is the correct refusal: a person cannot click it either.
 */
import type { Page } from "playwright";

/** Open the notepad from the dock's plus, write, and keep it. Resolves once
    the save has had time to land and the creature has finished saying so. */
export async function saveAnInspiration(
  page: Page,
  text: string,
  { touch = false }: { touch?: boolean } = {},
): Promise<void> {
  const press = async (selector: string) => {
    const target = page.locator(selector).first();
    if (touch) await target.tap();
    else await target.click();
  };
  await press(".waka-dock-item--new");
  await page.waitForTimeout(400);
  /* THE PLUS OFFERS EXACTLY TWO VERBS, in the order the product makes
     things: a new inspiration, then a new chat. Taken by position rather
     than by label so this does not break on a word, and asserted so that a
     third row arriving is a failure here rather than a silent wrong press. */
  const verbs = page.locator(".waka-new-one");
  if ((await verbs.count()) !== 2) {
    throw new Error(`the plus offered ${await verbs.count()} verbs, expected 2`);
  }
  if (touch) await verbs.first().tap();
  else await verbs.first().click();
  await page.waitForTimeout(700);
  await page.fill(".jar-composer-text", text);
  /* SAVE APPEARS ONLY ONCE THERE IS SOMETHING TO KEEP — "an always-present
     Save on a blank page is a button for a thing that does not exist" — so
     it is waited for rather than assumed. */
  await page.locator(".jar-note-save").waitFor({ state: "visible", timeout: 8_000 });
  await press(".jar-note-save");
  await page.waitForTimeout(4_500);
}
