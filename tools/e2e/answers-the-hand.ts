/**
 * ═══ DOES IT ANSWER THE HAND? ═══════════════════════════════════════════
 *
 * The founder has reported the same defect in four different costumes:
 *
 *   "hovering/clicking on characters in the background should show the name
 *    of the person above the character temporarily and character should also
 *    brighten up temporarily"
 *   "using keyboard to move left and right should brighten the respective
 *    button as well temporarily"
 *   "the ways at the side read more apparently"
 *   "line is not only hard to drag, but moves around"
 *
 * Every one of them is the same complaint: I put my attention on this thing
 * and the thing did not admit it. That is not four bugs, it is one rule with
 * four places it had not been applied — and the founder found all four by
 * looking, which is exactly the work this file exists to stop being theirs.
 *
 * WHAT IT ASKS. For every control a person can reach on a surface: put the
 * pointer on it, and see whether ANYTHING changes — its own paint, any
 * descendant's paint, or something appearing on the page (a name over a
 * character is not a change to the character). A control where nothing at
 * all changes is a control that does not answer the hand.
 *
 * WHY IT ASKS THE BROWSER AND NOT THE STYLESHEET. `home.css` has hover rules
 * that decide nothing — beaten by a later rule, applied to a parent that takes
 * no pointer, or written for a class the JSX stopped emitting. The only thing
 * that knows whether a hover is felt is the engine that paints it. This is the
 * same instrument as `e2e:dead-css`, pointed at behaviour instead of rules.
 *
 * EVIDENCE, NOT A VERDICT. A control that is disabled, already chosen, or
 * deliberately quiet has nothing to say and should not be made to. Those live
 * in QUIET_BY_DECISION below, each with the reason — the same shape as
 * `wall-chrome.test.ts`'s allowlist, and for the same reason: an exemption
 * with no argument next to it is indistinguishable from an oversight.
 *
 *     pnpm e2e:answers-the-hand [--base-url <url>]
 */
import { type Browser, type Page } from "playwright";
import { settleAfterArrival } from "./arrival";
import { launchChromium } from "./browser";
import { openTheNotepad, saveAnInspiration } from "./keep";

const DEFAULT_BASE = "http://127.0.0.1:3010";
const PASSWORD = "answers-the-hand-1";

/**
 * Controls with nothing to say, and why. A key is matched against the
 * control's own report line (`selector — name`), as a substring.
 */
const QUIET_BY_DECISION: Record<string, string> = {
  ':disabled': "a control that cannot be pressed must not look pressable",
  '[aria-selected="true"]':
    "already chosen — its lit state IS its answer, and brightening the one " +
    "you are standing on says the hand did something when it did not",
  '[aria-current="page"]':
    "the row of the bar you are standing on. Same decision as " +
    '[aria-selected="true"] — it is already lit, and brightening it says the ' +
    "hand did something when it did not.",
  '[aria-disabled="true"]': "same as :disabled, said the accessible way",
  '.waka-menu-scrim':
    "a window-sized invisible button whose only job is to dismiss the card " +
    "in front of it. Nothing is drawn on it — dimming the world to ask a " +
    "two-word question is the modal weight this product spends its time " +
    "removing — so there is nothing to brighten. `.waka-new-away`, the plus " +
    "sheet's own version, is the same control and is exempt with it.",
};

interface Dead {
  surface: string;
  where: string;
  label: string;
  /** what the pointer actually landed on, when it was not this control */
  over?: string;
}

/**
 * A control's whole appearance, itself and everything under it.
 *
 * The subtree matters: `.jar-ask button:hover .jar-caret` lights a CHILD, and
 * a snapshot of the button alone would call that button dead. So would a
 * snapshot that missed the page's own text, because the answer to hovering a
 * member of a room is their NAME appearing somewhere else entirely.
 */
async function look(page: Page, index: number): Promise<string> {
  return (await page.evaluate((i: number) => {
    const el = (window as unknown as { __hands: HTMLElement[] }).__hands[i];
    if (!el) return "gone";
    /* EVERY CHANNEL A FIX COULD USE, or the gate reports its own blindness as
       the product's silence. The first run of this found four dead controls;
       two of the four fixes then answered in `text-shadow` and
       `text-decoration-color`, neither of which was on this list — so the
       gate went on calling them dead while looking straight at the light it
       had asked for. An instrument that cannot see the remedy it demands is
       worse than no instrument: it sends you back to a finished job. */
    const props = [
      "color", "backgroundColor", "opacity", "transform", "filter",
      "borderColor", "borderTopColor", "borderBottomColor", "borderLeftColor",
      "borderRightColor", "boxShadow", "textShadow", "textDecorationLine",
      "textDecorationColor", "textDecorationThickness", "textUnderlineOffset",
      "letterSpacing", "outlineColor", "backdropFilter", "scale", "translate",
      "rotate", "fontWeight", "fill", "stroke", "visibility",
    ];
    /* NO NAMED FUNCTION IN HERE. This body is bundled before it is sent, and
       the bundler wraps named functions in a `__name` helper that exists in
       the tool's module scope and not in the page's — so a tidy little
       `const of = (node) => …` throws `__name is not defined` inside the
       browser and takes the whole walk with it. Plain loops only. */
    const nodes: Element[] = [el];
    for (const kid of Array.from(el.querySelectorAll("*")).slice(0, 40)) nodes.push(kid);
    const parts: string[] = [];
    for (const node of nodes) {
      const s = getComputedStyle(node) as unknown as Record<string, string>;
      const one: string[] = [];
      for (const p of props) one.push(s[p]);
      parts.push(one.join("|"));
    }
    /* and what the rest of the page is saying, so a name that appears above a
       character counts as the answer it is */
    parts.push(String(document.body.innerText.length));
    parts.push(String(document.querySelectorAll("*").length));
    return parts.join("//");
  }, index)) as string;
}

/**
 * Every control on this surface a person could put a pointer on, in document
 * order, parked on `window.__hands` so each one can be measured by index
 * rather than by a selector that may not be unique.
 */
async function handsOn(page: Page): Promise<{ where: string; label: string; quiet: string | null }[]> {
  return (await page.evaluate(() => {
    const REACHABLE =
      'button, a[href], [role="button"], summary, input[type="checkbox"], input[type="radio"], [tabindex]:not([tabindex="-1"])';
    const found = Array.from(document.querySelectorAll<HTMLElement>(REACHABLE)).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      if (Number(s.opacity) === 0) return false;
      /* off screen is not reachable by a hand that has not scrolled */
      if (r.bottom < 0 || r.top > window.innerHeight) return false;
      /* and neither is anything the pointer passes straight through */
      if (s.pointerEvents === "none") return false;
      /**
       * ── NOR ANYTHING WITH SOMETHING ELSE ON TOP OF IT ──────────────────
       *
       * THE DEFECT THIS WAS WRITTEN FOR, FOUND BY THIS WALK BEING REPOINTED
       * AT A MODAL. The account card is a card in the corner with a
       * full-screen `.waka-menu-scrim` behind it, which is how it is
       * dismissed. Every control in the world and in the bar is still in the
       * document while it is open — and `askSurface` hovers each one by
       * moving the pointer to its centre, where the SCRIM is. So the hover
       * lands on the scrim, the control does not light, and the walk reported
       * forty-four controls as "said nothing when the pointer arrived" on a
       * product where none of them is reachable by a hand at that moment.
       *
       * A control the pointer cannot land on is not a quiet control. It is
       * not a control, from a hand's point of view, which is the only point
       * of view this file has. The information was already being collected —
       * `askSurface` prints the intercepting element on every finding, which
       * is how the pattern was visible — and this is the filter using it.
       *
       * ITSELF OR A DESCENDANT, not strict identity: a button with a span of
       * text in it resolves to the span at its own centre, and that is the
       * button answering, not something covering it.
       *
       * Measured at the centre, which is where `askSurface` moves the mouse.
       * A control half-covered is still a control, and this walk does not
       * have an opinion about where a person aims inside one.
       */
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (mid !== null && mid !== el && !el.contains(mid)) return false;
      return true;
    });
    (window as unknown as { __hands: HTMLElement[] }).__hands = found;
    return found.map((el) => {
      const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean).join(".");
      const quiet =
        el.matches(":disabled") ? ":disabled"
        : el.getAttribute("aria-selected") === "true" ? '[aria-selected="true"]'
        /* THE SAME DECISION, SAID A THIRD WAY. `aria-current="page"` is how
           the bar marks the row you are standing on, and the reasoning for
           exempting it is word-for-word the `aria-selected` entry's: its lit
           state IS its answer. Without this the walk reported the bar's
           current row on EVERY surface it is visible from — seven findings
           for one ruling the file already encodes. */
        : el.getAttribute("aria-current") === "page" ? '[aria-current="page"]'
        : el.getAttribute("aria-disabled") === "true" ? '[aria-disabled="true"]'
        /* the window-sized invisible target that dismisses a card. It is the
           top element at its own centre, so the occlusion filter above
           correctly keeps it; it has nothing drawn on it to light, which is
           the design — see the entry in QUIET_BY_DECISION. */
        : el.classList.contains("waka-menu-scrim") || el.classList.contains("waka-new-away")
          ? ".waka-menu-scrim"
          : null;
      return {
        where: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`,
        label: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 40),
        quiet,
      };
    });
  })) as { where: string; label: string; quiet: string | null }[];
}

/**
 * AND THE SAME QUESTION FOR THE KEYBOARD.
 *
 * The founder ruled "never show the white focus box anywhere", and that
 * ruling removed the browser's own answer from every control in the product.
 * Removing an answer obliges giving one: a person tabbing through this world
 * has to be able to see where they are, and the ruling was about the BOX, not
 * about being lost.
 *
 * IT WALKS WITH TAB RATHER THAN CALLING `focus()`. `:focus-visible` is a
 * heuristic about how the focus was acquired — a programmatic `focus()` does
 * not necessarily match it, so a gate built on `focus()` would report every
 * control as dark and be wrong about all of them. Tab is what a person
 * presses, so Tab is what this presses.
 */
async function askByKeyboard(page: Page, surface: string, dead: Dead[]): Promise<number> {
  const hands = await handsOn(page);
  const resting: (string | null)[] = [];
  for (let i = 0; i < hands.length; i += 1) resting.push(hands[i].quiet ? null : await look(page, i));

  /* start from the top of the document so the walk is the person's walk */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen = new Set<number>();
  let asked = 0;
  /* a generous bound: some surfaces have more tab stops than reachable
     controls (a field is a stop and not a control), and the walk stops
     early anyway once focus starts repeating */
  for (let step = 0; step < hands.length * 3 + 20; step += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(90);
    const at = (await page.evaluate(() => {
      const hands = (window as unknown as { __hands: HTMLElement[] }).__hands;
      return hands.indexOf(document.activeElement as HTMLElement);
    })) as number;
    if (at < 0) continue;
    if (seen.has(at)) continue;
    seen.add(at);
    const rest = resting[at];
    if (rest === null || rest === undefined || rest === "gone") continue;
    const lit = await look(page, at);
    asked += 1;
    if (lit !== "gone" && lit === rest) {
      dead.push({ surface, where: hands[at].where, label: hands[at].label });
    }
  }
  console.log(`  ${surface.padEnd(24)} ${String(asked).padStart(3)} controls tabbed to`);
  return asked;
}

/** Walk one surface: hover every control on it and see what answers. */
async function askSurface(page: Page, surface: string, dead: Dead[]): Promise<number> {
  /* PUT THE LIGHT OUT BEFORE MEASURING, because this walk turns one on.
     Every surface runs this pass and then the keyboard pass, and the keyboard
     pass leaves focus wherever it last tabbed to. `.jar-saved` — and it is not
     alone — answers `:focus-visible` with the SAME ink it answers `:hover`
     with, so the next surface measured a control already lit by the previous
     pass, and a hover had nothing left to change. The gate reported the
     product silent when the gate itself was holding the light.

     It cost three CI runs to see, and only because the report finally carried
     the colour: `rgb(232, 237, 244)` with the pointer away, where this world
     rests that control at `rgba(232, 237, 244, 0.55)`. On a fast machine the
     tab order and the poster's press happened to move focus off it first,
     which is why it passed here every time and failed there every time. */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(150);
  const hands = await handsOn(page);
  let asked = 0;
  for (let i = 0; i < hands.length; i += 1) {
    const hand = hands[i];
    if (hand.quiet) continue;
    const before = await look(page, i);
    if (before === "gone") continue;
    const box = await page.evaluate((n: number) => {
      const el = (window as unknown as { __hands: HTMLElement[] }).__hands[n];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, i);
    await page.mouse.move(box.x, box.y);
    /* LOOK TWICE, AND THE SECOND TIME LATE.
       The first version waited 220ms — which happens to be exactly the
       `transition: color 0.22s` the ways carry, and that is a coincidence
       worth not relying on. A hover has to travel: pointer move, hit test,
       style recalc, first animated frame. On this machine that is over in a
       few milliseconds and any sample after it reads the new colour. On a
       loaded runner, painting a canvas world at the same time, the transition
       can have rendered NO frame by the sample — and a transition that has
       not started reads exactly like a control with no answer written for it.
       CI called `.jar-saved` dead on a surface where it answers here, three
       runs out of three.
       So: look once early, and if nothing moved, look again well after any
       transition in this stylesheet could still be running. The claim being
       made is that the control answers, not that it answers inside 220ms. */
    await page.waitForTimeout(250);
    let after = await look(page, i);
    if (after === before) {
      await page.waitForTimeout(450);
      after = await look(page, i);
    }
    /* and off again, so the next control is measured from rest rather than
       from whatever the last hover left lit */
    await page.mouse.move(2, 2);
    await page.waitForTimeout(60);
    asked += 1;
    if (after !== "gone" && after === before) {
      /* AND WHAT WAS AT ITS CENTRE WHEN NOTHING HAPPENED.
         "This control said nothing" is a symptom with two very different
         causes: the control has no answer written for it, or something else
         is lying over it and the pointer never reached it at all. CI reported
         `button.jar-saved` dead on a surface where it answers here, and the
         report gave nothing to go on. A hover that lands on another element
         is that element's hover, so naming it is the difference between a
         finding and a search. */
      const over = await page.evaluate((n: number) => {
        const el = (window as unknown as { __hands: HTMLElement[] }).__hands[n];
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        /* AND WHETHER THE ENGINE THINKS THE POINTER IS ON IT AT ALL.
           `elementFromPoint` says who WOULD get the event; `:hover` says who
           IS getting it. They can disagree — a pointer that never actually
           arrived reads as "itself" on the first and false on the second —
           and the difference is the whole diagnosis. Reported with the box
           and the viewport because the one control that has ever failed only
           on CI sits ten pixels off the bottom edge. */
        const hovering = el.matches(":hover");
        const where = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${window.innerWidth}x${window.innerHeight}`;
        const who =
          !at ? "(nothing)"
          : at === el || el.contains(at) ? "itself"
          : `${at.tagName.toLowerCase()}.${(at.className || "").toString().trim().split(/\s+/).join(".")}`;
        return `${who}; :hover=${hovering}; ${where}; colour ${getComputedStyle(el).color}`;
      }, i);
      dead.push({ surface, where: hand.where, label: hand.label, over });
    }
  }
  console.log(`  ${surface.padEnd(24)} ${String(asked).padStart(3)} controls asked`);
  return asked;
}

async function run(base: string): Promise<number> {
  console.log("[hand] does every control admit the pointer is on it");
  console.log("[hand] asked of the engine that paints the hover, not of the sheet\n");

  let browser: Browser | null = null;
  const dead: Dead[] = [];
  const unlit: Dead[] = [];
  let asked = 0;
  let tabbed = 0;
  try {
    browser = await launchChromium();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    asked += await askSurface(page, "the door (sign in)", dead);
    tabbed += await askByKeyboard(page, "the door (sign in)", unlit);

    await page.click("#login-tab-signup");
    await page.waitForTimeout(900);
    await page.fill("input[name=email]", `hand-${Date.now()}@example.test`);
    await page.fill("input[name=password]", PASSWORD);
    await page.fill("input[name=name]", "The Hand");
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);

    for (const text of [
      "a control that does not answer the hand is a control you press twice",
      "the second press is the person asking whether the first one landed",
      "every surface in this world is asked the same question",
    ]) {
      await saveAnInspiration(page, text);
      await page.waitForTimeout(4_500);
    }

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    /* measuring through the welcome is measuring a moving page — `arrival.ts` */
    await settleAfterArrival(page);
    asked += await askSurface(page, "the world", dead);
    tabbed += await askByKeyboard(page, "the world", unlit);

    /* the poster's band: the four things a person can say back */
    await page.evaluate(() => {
      const poster = document.querySelector<HTMLElement>('h1.jar-poster[data-jar-chrome="1"]');
      if (poster && poster.getAttribute("aria-expanded") !== "true") poster.click();
    });
    await page.waitForTimeout(1_400);
    asked += await askSurface(page, "the poster, answered", dead);
    tabbed += await askByKeyboard(page, "the poster, answered", unlit);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await openTheNotepad(page);
    await page.waitForTimeout(900);
    asked += await askSurface(page, "the mouth open", dead);
    tabbed += await askByKeyboard(page, "the mouth open", unlit);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    /* ═══ YOUR ACCOUNT IS A CARD IN THE CORNER, NOT AN ADDRESS ═════════════
       THIS WALKED TO `/profile`, WHICH STOPPED BEING A ROUTE on 2026-10-11 —
       founder: "I want all setting-related stuff to be only accessible
       through the drop down and not be its own thing." `main.tsx` carries the
       ruling in full under its own heading, and `SettingsPanel.tsx` lists the
       five sections that did not survive the prune.

       IT DID NOT TIME OUT. IT DID SOMETHING WORSE. `/profile` neither 404s
       nor hangs: `main.tsx` has a `/:handle` route, the address matches it,
       and `PublicProfile.tsx` sees a handle that does not start with `@` and
       answers `<Navigate to="/" replace />`. So this walk landed on THE
       WORLD, asked every control in the world whether it answers the pointer
       — which the step two above had already done — and filed the result
       under the heading "your account". Every control passed, because they
       are the world's controls and the world's controls answer the hand. A
       clean hover report about a surface the walk never opened, printed
       beside real findings, is the one failure mode a walk like this must not
       have: it does not merely miss the account card, it ASSERTS the account
       card is fine.

       SO IT PRESSES THE COG, the same door `tools/e2e/dead-css.ts` and
       `tools/e2e/usability.ts` were both rewritten to use, and BY THE
       MODIFIER rather than by `.first()`: the right corner has held two
       buttons since 2026-10-11 — an "i" for how the product works beside the
       cog — and the left corner has worn `.waka-corner` since there was a
       corner, so `.first()` is a bet on document order that would now lose.

       AND THE THREE GROUPS ARE OPENED IN TURN, because the card is a card of
       disclosures and only one is open at a time. Every act inside a folded
       group is absent from the document, not merely invisible, so a walk that
       asked the card with everything folded would ask three or four controls
       and report that every control on your account answers the hand. */
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    const cog = page.locator("button.waka-corner--settings");
    if ((await cog.count()) === 0) {
      console.log("  your account            NOT WALKED — no button.waka-corner--settings in the corner");
    } else {
      await cog.click();
      await page.waitForTimeout(900);
      asked += await askSurface(page, "your account", dead);
      tabbed += await askByKeyboard(page, "your account", unlit);
      const groups = await page.locator(".waka-settings-row").count();
      for (let i = 0; i < groups; i += 1) {
        await page.locator(".waka-settings-row").nth(i).click({ timeout: 5_000 });
        await page.waitForTimeout(600);
        asked += await askSurface(page, `your account, group ${i + 1}`, dead);
        tabbed += await askByKeyboard(page, `your account, group ${i + 1}`, unlit);
        await page.locator(".waka-settings-row").nth(i).click({ timeout: 5_000 });
        await page.waitForTimeout(300);
      }
    }

    await ctx.close();
  } finally {
    await browser?.close();
  }

  console.log("");
  if (unlit.length > 0) {
    console.log(`[hand] ${unlit.length} of ${tabbed} controls showed nothing when the KEYBOARD reached them:\n`);
    for (const d of unlit) console.log(`  ${d.surface.padEnd(24)} ${d.where}${d.label ? `  — ${d.label}` : ""}`);
    console.log("");
  }
  if (dead.length === 0 && unlit.length === 0) {
    console.log(`[hand] every one of ${asked} controls answered the pointer,`);
    console.log(`       and every one of ${tabbed} said where the keyboard was.`);
    return 0;
  }
  if (dead.length === 0) return 1;
  console.log(`[hand] ${dead.length} of ${asked} controls said nothing when the pointer arrived:\n`);
  const bySurface = new Map<string, Dead[]>();
  for (const d of dead) bySurface.set(d.surface, [...(bySurface.get(d.surface) ?? []), d]);
  for (const [surface, list] of bySurface) {
    console.log(`  ${surface}`);
    for (const d of list) {
      const under = d.over ? `\n          ${d.over}` : "";
      console.log(`      ${d.where}${d.label ? `  — ${d.label}` : ""}${under}`);
    }
  }
  console.log(
    `\n[hand] ${Object.keys(QUIET_BY_DECISION).length} kinds are exempt by decision:`,
  );
  for (const [k, why] of Object.entries(QUIET_BY_DECISION)) console.log(`  ${k.padEnd(24)} ${why}`);
  return 1;
}

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
const base = at >= 0 ? args[at + 1] : DEFAULT_BASE;
process.exit(await run(base));
