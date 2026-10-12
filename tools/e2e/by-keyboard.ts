/**
 * BY KEYBOARD — the world, with the mouse unplugged.
 *
 * ── THE QUESTION NO GATE HAS ASKED ─────────────────────────────────────────
 *
 * The usability audit covered contrast, target sizes and the Nielsen
 * heuristics. It could not have covered this, because **the field is a
 * canvas**: an orb is painted pixels, not an element. There is nothing for
 * Tab to land on and nothing for a screen reader to announce, and no amount
 * of contrast checking notices that.
 *
 * So a person who cannot use a pointer — a broken wrist, a tremor, a screen
 * reader, or simply someone who works from the keyboard — meets a product
 * whose central act may be unreachable. Every other walk in this repo drives
 * a mouse, including the ones written to be thorough: `dead-css` sweeps the
 * canvas by clicking a grid of coordinates, which is a confession that the
 * things it wants are not addressable any other way.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * Tab from the top of the world and record, in order, everything focus lands
 * on: what it is, what it says, and whether the person can SEE where they
 * are. Then try to do the product's two central acts with the keyboard alone
 * — say something into the mouth, and open a memory to read it.
 *
 *   reached      how many distinct stops a Tab cycle finds
 *   unnamed      stops with no accessible name — a reader announces "button"
 *   invisible    stops with no visible focus indicator, measured by asking
 *                the browser for the computed outline/box-shadow while focused
 *   the mouth    can a memory be kept without a pointer
 *   a memory     can one be opened and read without a pointer — through the
 *                bar's `Inspirations` row and a row of the archive it opens
 *   the reach    is the ground named, does its cursor move, and does a
 *                memory open on it — reached with `/`, a word and Enter,
 *                because no tab stop at headquarters goes into the field
 *   a sheet      does Escape hand focus back to what opened it
 *   a bar's place does arriving in a destination keep your place, or drop it
 *   the wall      can the creature's other form be reached and stood in
 *
 * AND TWO THINGS IT REPORTS WITHOUT BREAKING ON, each with its reason beside
 * the measurement: that the field is not in the tab order at all (it is
 * reached through Find, which is a door and not a tab stop), and that a
 * room's wall is no longer walked because its door was removed. The rule both
 * obey is this file's own, learned the hard way on 2026-08-27 and written
 * down at the bottom: "a check which is always red is a check everyone learns
 * to skip".
 *
 * `a way` USED TO BE IN THIS LIST and is not any more. It was the mechanism
 * of a destination that unmounts the control you pressed to reach it, and the
 * world has none left — see the tombstone where its two measurements stood.
 *
 * A canvas that cannot be tabbed into is not a bug in the canvas. It is a
 * question about whether the product has a keyboard path to its own content,
 * and the answer belongs in an audit rather than in a lint rule.
 *
 * Usage:
 *     pnpm dev:local
 *     pnpm e2e:by-keyboard
 *
 * Flags: `--base-url <url>`, `--headed`, `--keep <n>` (memories to seed).
 */
import { type BrowserContext, type Page, type Route } from "playwright";
import postgres from "postgres";
import { launchChromium } from "./browser";
import { saveAnInspiration } from "./keep";

/** The same seam `at-scale` and `the-timeline` use. Optional here — see below. */
const dbUrl = (): string | undefined =>
  process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
interface Args {
  baseUrl: string;
  headed: boolean;
  keep: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", headed: false, keep: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--keep") args.keep = Number(take());
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:by-keyboard [--base-url <url>] [--keep <n>] [--headed]");
      process.exit(0);
    } else {
      console.error(`[by-keyboard] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function stubExternals(ctx: BrowserContext, base: string): Promise<void> {
  await ctx.route(
    (url) => !url.href.startsWith(base),
    (route: Route) => {
      const u = route.request().url();
      if (/\.css|css2|pretendard/.test(u)) {
        return route.fulfill({ status: 200, contentType: "text/css", body: "/* stub */" });
      }
      return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    },
  );
}

/** Returns the address it signed up with — the only handle on this account. */
async function signUp(page: Page, base: string): Promise<string> {
  const email = `kb-${uniq()}@example.test`;
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "by-keyboard-local-password-1");
  await page.fill("input[name=name]", "Keyboarder");
  await page.click("button[type=submit]");
  await page.waitForTimeout(6_000);
  return email;
}

interface Stop {
  tag: string;
  cls: string;
  name: string;
  /** Whether anything visibly marks this element as focused. */
  litUp: boolean;
}

/**
 * WHAT THE BROWSER SAYS IS FOCUSED, AND WHETHER IT LOOKS IT.
 *
 * `litUp` compares what the element computes WHILE FOCUSED against what the
 * same element computes with focus taken away — blur, read, focus again. Any
 * difference at all counts, across ten properties: a ring, a shadow, a rule
 * under the word, a brighter ink, a filter, an opacity, a fill.
 *
 * IT SAID IT DID THIS AND IT DID NOT. The first version carried this same
 * paragraph and then checked three fixed properties — outline, box-shadow,
 * a thick bottom border — against nothing, so a design that marks focus by
 * brightening was "dark" and a design that marks it by not changing at all
 * was indistinguishable from one that does. The comment described the right
 * test and the code underneath it did a narrower one, which is worse than
 * either alone: a reader checking whether the audit was sound would have read
 * the paragraph and stopped.
 *
 * It matters more than it did. The founder's ruling on 2026-08-27 — "never
 * show this white border ANYWHERE" — made brightening the whole of how this
 * product says focus, and a probe that cannot see brightening would have
 * failed the build on a world that had just been made to look right.
 */
const FOCUS_PROBE = `(() => {
  var el = document.activeElement;
  if (!el || el === document.body) return null;
  var read = function (node) {
    var cs = getComputedStyle(node);
    return [cs.outlineStyle, cs.outlineWidth, cs.boxShadow, cs.borderBottomWidth,
            cs.color, cs.filter, cs.opacity, cs.backgroundColor,
            cs.textDecorationLine, cs.transform].join('|');
  };
  var lit = read(el);
  el.blur();
  var dark = read(el);
  el.focus();
  return {
    tag: el.tagName.toLowerCase(),
    cls: String(el.className || '').slice(0, 60),
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 48),
    litUp: lit !== dark,
  };
})()`;

async function tabCycle(page: Page, limit = 40): Promise<Stop[]> {
  const stops: Stop[] = [];
  const seen = new Set<string>();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const stop = (await page.evaluate(FOCUS_PROBE)) as Stop | null;
    if (!stop) continue;
    const key = `${stop.tag}.${stop.cls}|${stop.name}`;
    if (seen.has(key)) break; /* the cycle has come round */
    seen.add(key);
    stops.push(stop);
  }
  return stops;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    "[by-keyboard] The world with the mouse unplugged. The field is a canvas, so an\n" +
      "              orb is painted pixels rather than an element — this asks whether\n" +
      "              the product has a keyboard path to its own content.\n",
  );

  const browser = await launchChromium({
    headless: !args.headed,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await stubExternals(ctx, args.baseUrl);
    const page = await ctx.newPage();
    const email = await signUp(page, args.baseUrl);

    /* SOMETHING TO REACH FOR. A field with nothing in it would report a clean
       keyboard pass over an empty world, which is the same vacuous success
       every other gate in this session had to be talked out of. */
    for (let i = 0; i < args.keep; i += 1) {
      await saveAnInspiration(page, `something worth finding again ${i} ${uniq()}`);
      await page.waitForTimeout(4_000);
    }

    /* AND A WALL WITH A PAST, because a wall whose whole life is today has
       nothing to wind back to and does not render the word that says `now` —
       so the timeline, and every key that reaches it, would go unwalked and
       the tab count would silently drop by one.

       Found by this gate going red on 2026-08-30 after the dial became a list
       of dates: "Tab reaches 7 stops, was 8". The missing stop was the word,
       and it was missing because it is correctly absent on a wall like this
       one. The number was never the claim — the claim is that the world is
       reachable — so the fixture grows a past rather than the threshold
       shrinking to fit a smaller world.

       Through the database, because there is deliberately no way through the
       product to keep something last month. Skipped, with a line saying so,
       when no connection string is set: this walk answers plenty of questions
       that need no database, and refusing to run any of them would be worse
       than running most of them. */
    const sql = dbUrl() ? postgres(dbUrl()!, { max: 2 }) : null;
    if (sql) {
      /* SCOPED TO THIS ACCOUNT, THROUGH ITS OWN ADDRESS. The first version
         said `order by created_at limit 1` over the whole table and aged the
         oldest row in the database — somebody else's memory, on a local
         database every walk in this folder shares. It changed nothing on this
         wall, so the walk reported the same failure and looked like the fix
         had not worked. A seed that is not scoped to the account under test
         is not a seed, it is a side effect. */
      /* AND A DATABASE THAT WILL NOT ANSWER COSTS ONE CLAIM, NOT ALL OF THEM.
         Everything else this walk asks — whether the world can be tabbed
         through, named, focused, travelled and read — needs no database at
         all. Letting a connection error escape would turn a hiccup in the
         seed into a red gate about the keyboard, which is a lie about what
         went wrong. It is reported and the walk goes on with a wall that has
         no past; the tab-count check below will then legitimately notice the
         missing word, which is the honest outcome. */
      try {
        const aged = await sql`
          update inspirations set created_at = now() - interval '31 days'
          where id = (
            select i.id from inspirations i
            join profiles p on p.id = i.profile_id
            join accounts a on a.id = p.account_id
            where a.email = ${email}
            order by i.created_at
            limit 1
          )
          returning id
        `;
        if (aged.length === 0) {
          console.log("  (nothing was aged — the wall has no past, so the timeline goes unwalked)");
        }
      } catch (err) {
        console.log(
          `  (the seed could not reach the database: ${err instanceof Error ? err.message : String(err)})`,
        );
      }
      await sql.end({ timeout: 5 }).catch(() => undefined);
    } else {
      console.log("  (no DB_CONNECTION_URL — the wall has no past, so the timeline goes unwalked)");
    }

    await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7_000);

    const stops = await tabCycle(page);
    console.log(`  Tab reaches ${stops.length} stop(s) in the world:\n`);
    for (const s of stops) {
      console.log(
        `    ${s.litUp ? "lit " : "DARK"}  ${(s.name || "(no name)").padEnd(34)} ${s.tag}.${s.cls.split(" ")[0] ?? ""}`,
      );
    }
    const unnamed = stops.filter((s) => s.name === "");
    const dark = stops.filter((s) => !s.litUp);

    /* THE TWO CENTRAL ACTS, ATTEMPTED WITH KEYS ALONE. */
    const canvasFocusable = (await page.evaluate(
      () => document.querySelector("canvas")?.getAttribute("tabindex") !== null,
    )) as boolean;

    /**
     * ── KEEPING SOMETHING WITH NO MOUSE, BY THE DOOR THAT EXISTS ───────────
     *
     * This used to tab until it landed on `.jar-mouth-rest`, press Enter,
     * type and press Enter again. That walk PASSED, and it should not have:
     * `.jar-mouth-rest` is the closed composer slot at `opacity: 0`, so the
     * keyboard route this gate was certifying ran entirely through a control
     * nobody can see. The founder's keyboard "worked" by using the bug.
     *
     * The slot is `inert` now, and the route is the one a sighted person
     * takes: the plus in the dock, then the first of the two verbs it
     * raises, then the field, then Save. Nothing here is reached by class
     * except as a name for the focused element — every press is Tab or
     * Enter, which is the only way this gate can claim what it claims.
     */
    const focused = async (): Promise<string> =>
      (await page.evaluate(() => {
        const at = document.activeElement as HTMLElement | null;
        if (!at) return "";
        const cls = typeof at.className === "string" ? at.className : "";
        return `${cls} ${at.innerText ?? ""} ${at.getAttribute("aria-label") ?? ""}`;
      })) as string;
    /** Tab until the focused element answers to `want`, or give up. */
    const tabTo = async (want: RegExp, limit = 30): Promise<boolean> => {
      for (let i = 0; i < limit; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        if (want.test(await focused())) return true;
      }
      return false;
    };

    let keptByKeyboard = false;
    try {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      if (await tabTo(/waka-dock-item--new/)) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(700);
        /* The sheet is the plus's own child now, so its first row is the
           very next tab stop rather than the last thing on the bar. The
           walk still steps forward rather than assuming it. */
        if (!/waka-new-one/.test(await focused())) await tabTo(/waka-new-one/, 6);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1_200);
        await page.keyboard.type("kept with no mouse at all");
        await page.waitForTimeout(400);
        /* SAVE IS NOT ON THE FIELD'S OWN ENTER HERE. The notepad takes
           multi-line writing, so Enter makes a line; the keep is the button
           in the corner, which is what a person tabs to. */
        await tabTo(/waka-dock-tool--keep/, 10);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4_500);
        keptByKeyboard = (await page.evaluate(async () => {
          const r = await fetch("/api/inspirations?limit=50", { credentials: "include" });
          const b = (await r.json()) as { inspirations?: Array<{ textPreview: string }> };
          return (b.inspirations ?? []).some((x) => x.textPreview.includes("no mouse at all"));
        })) as boolean;
      }
    } catch {
      keptByKeyboard = false;
    }

    /**
     * ── ESCAPE ROUTES, AND WHAT IS ACTUALLY BEING ESCAPED ──────────────────
     *
     * The question the first walk of this file listed as unasked: when
     * something opens over the world and then closes, does focus go back where
     * it came from?
     *
     * Two different things wear the same shape here, and telling them apart is
     * the whole of the measurement:
     *
     *   A SHEET covers the world and goes away again. Escape should put focus
     *   back on the control that opened it, because that control is still
     *   there and it is where the person was.
     *
     *   A WAY takes you somewhere else. `philosophies & values` is not a
     *   dialog — it is `toSky()` — and it exists only in the place you left,
     *   so it UNMOUNTS on arrival and the browser drops focus to the document.
     *   Nothing can be "returned" to. What has to happen instead is that the
     *   place you arrived in takes the focus its own way in dropped.
     *
     * The first version of this called both of them sheets and reported
     * `.jar-values` as a modal that fails to restore focus. Wrong about what
     * the thing is, right that it was broken — and a report that misnames the
     * mechanism sends whoever reads it to the wrong file.
     *
     * Opened with keys only: a pointer-opened control has nowhere in
     * particular to return to and would flatter the result.
     */
    const focusAfterKey = async (opener: string, then: "Escape" | null): Promise<string> => {
      try {
        await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(6_000);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(100);
          const here = (await page.evaluate(
            () => String((document.activeElement as HTMLElement | null)?.className ?? ""),
          )) as string;
          if (!here.includes(opener)) continue;
          await page.keyboard.press("Enter");
          await page.waitForTimeout(then === null ? 4_000 : 1_200);
          if (then !== null) {
            await page.keyboard.press(then);
            await page.waitForTimeout(900);
          }
          return (await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return "(the document)";
            return String(el.className || el.tagName).split(" ")[0] ?? "(unnamed)";
          })) as string;
        }
        return "(never reached it)";
      } catch {
        return "(threw)";
      }
    };

    /* ═══ THE ONE REAL SHEET IN THE WORLD'S CHROME IS THE COG'S CARD ══════
       THIS TABBED FOR `jar-account`, WHICH HAS NO RENDERER. The account pill
       in `.jar-topbar` went when the settings page became a card in the
       corner — founder: "I want all setting-related stuff to be only
       accessible through the drop down and not be its own thing" — and
       `main.tsx:186` carries the ruling. `focusAfterKey` presses 30 Tabs
       looking for a className that cannot appear, returns "(never reached
       it)", and the line below then put `a sheet closed with Escape drops
       focus to (never reached it)` into `broke`. That is worse than a step
       that times out: it is a gate REPORTING A DEFECT THE PRODUCT DOES NOT
       HAVE, against a surface it never opened, and whoever read it would go
       looking for a focus bug in a card that restores focus correctly.

       THE SHEET IS STILL A SHEET, which is why this is a repoint and not a
       deletion. The cog's card covers the world, closes with Escape, and
       `Menu.tsx` holds `settingsTrigger` precisely so Escape "hands focus
       back to the trigger" — so the question this measurement asks is
       unchanged and now has something to ask it of.

       BY THE MODIFIER, NOT THE BASE. `waka-corner` alone is worn by the left
       corner and by the "i" beside the cog, so `includes("waka-corner")`
       would be satisfied by the wrong button in both directions. The opener
       is matched on `waka-corner--settings`; what Escape must hand back is
       only required to BE a corner, because `focusAfterKey` reports the
       landing element's first class and the trigger's is the base. */
    const sheetLandedOn = await focusAfterKey("waka-corner--settings", "Escape");
    const sheetReturns = sheetLandedOn.includes("waka-corner");

    /* ═══ THE TWO "WAYS OUT OF THE WALL" ARE GONE, AND THE RULING THE LAST
       PASS ASKED FOR IS MADE HERE ════════════════════════════════════════════
       WHAT STOOD HERE. A loop over `["jar-values", "jar-saved"]` — the
       up-signpost and the archive door — which opened each with keys and
       asked where focus landed, under this file's WAY heading: a destination
       that unmounts the control you pressed, so nothing can be returned to
       and the place you arrive in has to take the focus its own arrival
       dropped.

       IT WAS NOT FILING A FALSE FAILURE. IT WAS FILING A FALSE PASS, WHICH IS
       WORSE, AND THE REPORT THAT SENT ME HERE HAD IT THE OTHER WAY ROUND.
       Neither class has a renderer, so `focusAfterKey` pressed thirty Tabs
       looking for a className that cannot appear and returned
       `"(never reached it)"` — and `kept` is `landedOn !== "(the document)"`,
       which that string satisfies. Run on 2026-10-12 before this edit, the
       walk printed:

           travelling with keys keeps your place:
             yes   .jar-values   arrives with focus on (never reached it)
             yes   .jar-saved    arrives with focus on (never reached it)

       Two ticks for two journeys nobody took. A gate that says a thing works
       because it could not find the thing is the exact failure this file's
       header was written about one surface along.

       ── THE RULING: THE DOCK IS NEITHER A SHEET NOR A WAY ──────────────────
       The last pass declined to repoint these and said why: both destinations
       open from the dock now, the dock does not unmount, "and a thing you
       reach from a bar that does not unmount is much closer to this file's
       SHEET than to its WAY". That is right about the dock and wrong about
       what follows from it, because this file's two words are not two halves
       of everything — they are two mechanisms it happened to meet, each
       named for the QUESTION it makes answerable:

         a SHEET is identified by Escape handing focus back, because its
         opener outlives it and is where the person was;
         a WAY is identified by nothing to hand focus back TO, because its
         opener died on arrival.

       A dock destination has the sheet's first property and not its second
       question. Measured, with keys only, on 2026-10-12: Escape does not
       close `Inspirations`, `Chats` or `Principles` — the bar's `Now` row
       does, and the row that opened it is still there, still lit, with
       `aria-current="page"`. So "does Escape hand focus back" is not a
       question about these surfaces at all; asking it would have reported a
       focus bug against a control that is not the way out.

       WHAT IS A QUESTION ABOUT THEM IS THE ONE THE WAYS LOOP WAS ASKING:
       does arriving drop your place? It survives the dock intact — in fact it
       matters more, because the row you pressed is still on screen, so focus
       falling to the document means the person is at the top of the page
       looking at a control they are no longer on. SO THE CLAIM MOVES HOUSE
       RATHER THAN BEING DROPPED: `reachTheDockFrom` below already opens each
       of the three destinations with keys alone, and it now records what
       focus landed on when it got there. One journey, three claims, no second
       set of page loads.

       WHAT IS NOT MEASURED ANY MORE, SAID OUT LOUD: nothing in this repo now
       exercises this file's WAY mechanism — a destination that unmounts its
       own opener — because the world no longer has one. `philosophies &
       values` was `toSky()` and is a row in a bar; the archive door was a
       descent into the field and is a row in the same bar. If a travelling
       destination ever comes back, the measurement is `focusAfterKey(opener,
       null)` and the finding is `landedOn === "(the document)"` — and the
       guard that was missing is that `"(never reached it)"` must count as a
       failure to measure, never as a pass. */

    /**
     * ── AND READING ONE BACK, BY THE DOOR THE PRODUCT HAS ─────────────────
     *
     * THIS TABBED FOR `jar-saved` AND REPORTED `the archive is write-only
     * again` ON A PRODUCT WHOSE ARCHIVE READS FINE. That line is this file's
     * loudest, it went into `broke`, and it was false. The run on 2026-10-12
     * before this edit ended:
     *
     *     opening one to read it:          DID NOT WORK
     *     [by-keyboard] the keyboard path got WORSE:
     *                     no keyboard route opens a memory — the archive is
     *                     write-only again
     *
     * `.jar-saved` has no renderer — the only mentions left in `Home.tsx`
     * hand the string to `querySelector` — so the thirty Tabs below it were
     * looking for a class that cannot appear, and the conclusion drawn from
     * not finding it was a statement about the product.
     *
     * WHAT THE DOOR IS NOW, AND IT IS ONE PRESS FROM EVERY SCREEN: the bar's
     * `Inspirations` row opens `SavesOverlay`, which draws the archive as a
     * LIST OF BUTTONS — one `.waka-list-row` per memory, each carrying its
     * own preview and date as its text. Walked with keys only on 2026-10-12:
     * Tab reaches the row immediately after the surface opens, Enter opens
     * the note, and `.waka-note-page` is standing there with the words in it.
     *
     * ── AND THE CLAIM IS NARROWER THAN IT WAS, DELIBERATELY ───────────────
     *
     * The old walk descended into the FIELD and measured the roving cursor
     * there: `.jar-reach`, a `listbox` with one tab stop and an
     * `aria-activedescendant` the arrows move. Those three facts were
     * ratcheted on 2026-08-27 and they are not what this section can hold any
     * more, because the field has no keyboard door at all — see
     * the ground section below, which reaches the field the way the product
     * offers — `/`, a word, Enter on a result — and holds all three. What is
     * held HERE is the other half, and it is the half a person meets first:
     * the archive as a list of words, opened from the bar, read without a
     * pointer, by a control that said what it was.
     *
     * Nothing here is reached by selector except as a name for whatever is
     * focused — every move is Tab or Enter, which is the only way this walk
     * can claim what it claims.
     */
    let memoryOpened = false;
    let rowName = "";
    let rowsOffered = 0;
    try {
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      /* THE BAR'S ROW, NOT ANY WORD THAT HAPPENS TO SAY `Inspirations`.
         `focused()` hands back the className, the text and the aria-label of
         whatever is focused, all in one string, and the archive's own surface
         is labelled "Your Inspirations" — so a bare /Inspirations/ would be a
         bet on which of them Tab met first. Both halves are required, over
         newlines, because the className comes first. */
      if (await tabTo(/waka-dock-item[\s\S]*Inspirations/)) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3_500);
        rowsOffered = await page.locator(".waka-list-row").count();
        /* THE ROW IS FOUND BY ASKING WHAT FOCUS IS STANDING IN, not by a
           class on the focused element itself: a row may be a button that
           CONTAINS the preview, or a button inside one, and which of those it
           is should not be this walk's business. */
        const onARow = async (): Promise<boolean> =>
          (await page.evaluate(() => {
            const at = document.activeElement as HTMLElement | null;
            return Boolean(at && at.closest(".waka-list-row"));
          })) as boolean;
        for (let i = 0; i < 20; i += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(120);
          if (!(await onARow())) continue;
          /* WHAT IT SAYS BEFORE IT IS PRESSED. A route only counts if a
             listener is told where it goes, and the row carries its own
             preview and date as text rather than an `aria-label` — which is
             a name, read out as it stands. */
          rowName = (await page.evaluate(() => {
            const at = document.activeElement as HTMLElement | null;
            const row = at?.closest(".waka-list-row") as HTMLElement | null;
            return ((row?.getAttribute("aria-label") ?? row?.innerText ?? "") as string)
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 48);
          })) as string;
          await page.keyboard.press("Enter");
          await page.waitForTimeout(2_500);
          memoryOpened = (await page.locator(".waka-note-page").count()) > 0;
          break;
        }
      }
    } catch {
      memoryOpened = false;
    }

    /**
     * ── THE FIELD'S OWN GROUND, THROUGH THE DOOR THAT IS NOT IN THE TAB
     *    ORDER ─────────────────────────────────────────────────────────────
     *
     * `.jar-reach` is the ground made addressable without a pointer: a
     * `sr-only` `listbox` with one tab stop over a canvas full of orbs, an
     * `aria-activedescendant` the arrows move, and `.jar-panel` opening on
     * the one the cursor is on. Three facts, ratcheted on 2026-08-27 after
     * this walk had found the archive write-only and the fix was made.
     *
     * IT RENDERS ONLY WHILE YOU ARE IN THE FIELD, AND NO TAB STOP GOES THERE.
     * Measured 2026-10-12: forty Tabs from the top of the world never make
     * the listbox appear. Ten of the eleven stops are the bar and the two
     * corners, and the descent `.jar-saved` used to be is gone.
     *
     * I ALMOST SHIPPED THAT AS THE FINDING, AND IT WOULD HAVE BEEN A NEW
     * FALSE ONE — in the file I was sent to take three of them out of. The
     * first version of this block printed "RENDERED BUT UNREACHABLE". Then I
     * looked for the door instead of concluding from its absence:
     *
     *   `?view=field` DOES NOT WORK. `view-location.ts` parses the parameter,
     *   but a cold load at that address lands on `/` with the parameter
     *   dropped. Not a route in.
     *   `standIn` CALLS `toGround()` and is group-only, so it is gone with
     *   rooms.
     *   FIND DOES WORK, AND IT IS ENTIRELY KEYS. `/` opens the search —
     *   `Home.tsx` puts it there on purpose, "find → the FIELD. It is a verb
     *   about memories, so it sits with them and answers with `/`" — typing
     *   a word lists the matches as real buttons, and Enter on one navigates
     *   with `section: 'field'`. Walked: `.jar-reach` present, three options
     *   in it, `.jar-up` standing there as the way back, `.jar-panel` open on
     *   the memory that was chosen.
     *
     * So the ground has a keyboard door, it is not in the tab order, and the
     * three ratcheted claims can be measured again. They are measured here,
     * through `/`, and they are back in `broke` where they were before —
     * which is the ratchet being honoured rather than loosened, and the
     * opposite of what reasoning from "no tab stop reaches it" would have
     * done to this file.
     *
     * THE SEED IS WHAT MAKES FIND ANSWERABLE. Every keep this walk makes
     * carries `worth finding again`, so the word typed below is one that is
     * really on this wall and the search has something to list. A search for
     * a word nobody kept would report the ground unreachable and mean only
     * that the walk asked for the wrong thing.
     */
    let inTheGround = false;
    let reachName = "";
    let reachRole = "";
    let reachOptions = 0;
    let reachMoves = false;
    let openedTheAnnouncedWay = false;
    try {
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("/");
      await page.waitForTimeout(1_500);
      await page.keyboard.type("worth finding again");
      await page.waitForTimeout(3_500);
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(140);
        if (!/worth finding again/.test(await focused())) continue;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(9_000);
        break;
      }
      inTheGround = (await page.locator(".jar-reach").count()) > 0;
      if (inTheGround) {
        /* WHAT THE GROUND SAYS IT IS, asked of the live DOM — a `role` or a
           label that a prop fails to reach is exactly the kind of thing a
           source-reading gate agrees with and the browser does not. */
        const says = (await page.evaluate(() => {
          const el = document.querySelector(".jar-reach");
          if (!el) return null;
          return {
            role: el.getAttribute("role") ?? "",
            name: (el.getAttribute("aria-label") ?? "").trim(),
            at: el.getAttribute("aria-activedescendant") ?? "",
            options: el.querySelectorAll('[role="option"]').length,
          };
        })) as { role: string; name: string; at: string; options: number } | null;
        reachRole = says?.role ?? "";
        reachName = says?.name ?? "";
        reachOptions = says?.options ?? 0;
        /* THE CURSOR HAS TO MOVE. One that does not is a cursor that reaches
           exactly one memory, which is a door with one thing behind it. The
           listbox is focused first, because `aria-activedescendant` is only
           a cursor while the element holding it has focus. */
        await page.locator(".jar-reach").focus();
        await page.waitForTimeout(400);
        const before = (await page.evaluate(
          () => document.querySelector(".jar-reach")?.getAttribute("aria-activedescendant") ?? "",
        )) as string;
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(600);
        const after = (await page.evaluate(
          () => document.querySelector(".jar-reach")?.getAttribute("aria-activedescendant") ?? "",
        )) as string;
        reachMoves = before !== "" && after !== "" && after !== before;
        /* AND THE KEY ITS OWN LABEL NAMES. A route only a blind walk can find
           is a route nobody is told about; this half is what says the label
           is true. */
        openedTheAnnouncedWay = (await page.locator(".jar-panel").count()) > 0;
      }
    } catch {
      /* left as whatever it reached — a throw here is a finding */
    }

    console.log(
      `\n  ${unnamed.length} of ${stops.length} stops announce nothing to a reader` +
        `\n  ${dark.length} of ${stops.length} stops show no visible focus` +
        `\n  the canvas ${canvasFocusable ? "can be focused" : "CANNOT be focused — no tabindex"}` +
        `\n  keeping a memory with keys alone: ${keptByKeyboard ? "works" : "DID NOT WORK"}` +
        `\n  opening one to read it:          ${memoryOpened ? "works" : "DID NOT WORK"}` +
        `\n  ...from a list of ${String(rowsOffered).padStart(3)} the keyboard reaches` +
        `\n  ...and the row it pressed said:  ${rowName === "" ? "NOTHING NAMED" : `"${rowName}"`}`,
    );
    console.log(
      `\n  a sheet closed with Escape hands focus back: ${
        sheetReturns ? "yes" : `NO — lands on ${sheetLandedOn}`
      }`,
    );
    console.log(
      `\n  the field's own ground, reached with "/" and a word:` +
        `\n    in the field:                  ${inTheGround ? "yes" : "NO — the search's own result did not travel"}` +
        `\n    it answers to:                 ${
          reachName === "" ? "NOTHING NAMED" : `${reachRole || "no role"} — "${reachName}"`
        }` +
        `\n    memories the keyboard can see: ${String(reachOptions).padStart(3)}` +
        `\n    arrows move along it:          ${reachMoves ? "yes" : "NO"}` +
        `\n    ...and one is open:            ${openedTheAnnouncedWay ? "yes" : "NO"}` +
        `\n    (no tab stop at headquarters goes here — the descent .jar-saved used to be` +
        `\n     is gone, and Home.tsx's arrival handoff still names it. Reported, not broken` +
        `\n     on: the ground IS reachable, through the door above.)`,
    );

    /**
     * ── THE WAY OUT OF A DESTINATION, PRESSED WITH THE KEY IT COSTS ────────
     *
     * THE FAILURE THIS WAS WRITTEN FOR, AND IT WAS A GATE EXCUSING ITSELF.
     * The archive, the chats list, the principles and the claims queue all
     * rendered through `DialogSurface` with `role="dialog"`, `aria-modal` and
     * a Tab trap. Meanwhile `styles/claims.css` says the dock "is how you
     * leave one", and `test/way-out.test.ts` exempts all four from Law 2 on
     * exactly that sentence — its own header: "the dock is visible the entire
     * time one is open, it never moves, and its first row is called Now. That
     * is a visible way out costing one press."
     *
     * Both could not be true. Measured here before the fix, on a wall with
     * things on it: open the archive from the bar with the keys, then press
     * Tab sixty times and Shift+Tab sixty times. The bar was never reached,
     * in either direction. For anybody working from the keyboard those four
     * surfaces had NO way out at all — Law 2, the founder's single most
     * repeated complaint, failing on the four most-visited surfaces in the
     * product, and failing invisibly because the exit is right there on the
     * screen and merely unreachable.
     *
     * WHY THIS BELONGS HERE AND NOT IN A UNIT TEST. `way-out.test.ts` reads
     * source text, which is the right instrument for "is there a control that
     * leaves" and no instrument at all for "can focus get to it". It can see
     * that the dock offers each destination and that the bar renders while one
     * is open; it cannot see a `keydown` handler calling `preventDefault` on
     * Tab three files away. Only a browser with a real focus order can answer
     * that, which is what this walk is.
     *
     * HOW IT IS MEASURED. Every destination is arrived at FRESH for each
     * direction. The first version of this reused the page between the two
     * and so measured the second direction from wherever the first had left
     * focus — on the bar, not in the page — and reported six presses for a
     * journey that costs one. A reachability number taken from the wrong
     * starting point is not a weaker measurement, it is a different one.
     *
     * THE CLAIMS QUEUE IS NOT WALKED, and that is the product rather than an
     * omission: it is the one destination with no row of its own in the bar —
     * reached from the home screen, which `way-out.test.ts` states and allows
     * — so there is no word in the dock to Tab to and press. It shares the
     * primitive with the three below, and `test/dialog-surface.test.ts`
     * holds the primitive directly.
     */
    interface Reach {
      /** the word in the bar that goes there */
      word: string;
      opened: boolean;
      /** what the surface says it is, read off the live DOM */
      role: string;
      modal: boolean;
      /** presses to the nearest dock row, 0 meaning never reached */
      forward: number;
      backward: number;
      /**
       * AND WHAT FOCUS WAS ON WHEN IT GOT THERE — the claim that moved house
       * from the deleted `ways` loop; see its tombstone for why. One journey
       * answers it, because the Enter that opens the destination is already
       * being pressed here with keys alone, so the question costs one read
       * rather than three more page loads.
       *
       * `"(the document)"` is the finding. The dock row that was pressed is
       * still on screen and still lit, so focus falling to the body puts the
       * person at the top of the page looking at a control they are no longer
       * standing on — which is the same defect the old loop was shaped
       * against, on a surface that actually exists.
       */
      landedOn: string;
    }

    /** Tab (or Shift+Tab) until focus is on a row of the bar, or give up. */
    const pressesToTheDock = async (back: boolean, limit = 60): Promise<number> => {
      for (let i = 1; i <= limit; i += 1) {
        await page.keyboard.press(back ? "Shift+Tab" : "Tab");
        await page.waitForTimeout(70);
        if (/waka-dock-item/.test(await focused())) return i;
      }
      return 0;
    };

    /**
     * Go to the destination the given word in the bar names, with keys only,
     * and come back with how far the bar is from where you land.
     *
     * Nothing here is reached by selector except as a name for whatever is
     * focused — every move is Tab or Enter, which is the only way this walk
     * can claim what it claims.
     */
    const reachTheDockFrom = async (word: string): Promise<Reach> => {
      const out: Reach = {
        word, opened: false, role: "", modal: false, forward: 0, backward: 0,
        landedOn: "(never opened)",
      };
      for (const back of [false, true]) {
        try {
          await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(7_000);
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          let pressed = false;
          for (let i = 0; i < 40; i += 1) {
            await page.keyboard.press("Tab");
            await page.waitForTimeout(90);
            const here = await focused();
            if (!/waka-dock-item/.test(here) || !here.includes(word)) continue;
            await page.keyboard.press("Enter");
            await page.waitForTimeout(3_500);
            pressed = true;
            break;
          }
          if (!pressed) continue;
          out.opened = (await page.locator(".waka-over").count()) > 0;
          if (!out.opened) continue;
          /* WHAT THE SURFACE SAYS IT IS, asked of the live DOM rather than of
             the source — a `role` that a prop fails to reach is exactly the
             kind of thing a source-reading gate agrees with and the browser
             does not. `aria-modal` is half the bug on its own: it tells a
             reader that nothing outside this node exists, so the bar the
             exemption rests on is gone from the accessibility tree too. */
          const says = (await page.evaluate(() => {
            const el = document.querySelector(".waka-over");
            return el
              ? { role: el.getAttribute("role") ?? "", modal: el.getAttribute("aria-modal") === "true" }
              : null;
          })) as { role: string; modal: boolean } | null;
          out.role = says?.role ?? "";
          out.modal = says?.modal ?? false;
          /* READ ON THE FORWARD PASS ONLY, which is the pass that has not
             moved focus yet. `pressesToTheDock` below walks focus away, and
             the backward pass re-arrives from a fresh load — so taking this
             on both and keeping the last would be reading the same fact
             twice and reporting the second one. */
          if (!back) {
            out.landedOn = (await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el || el === document.body) return "(the document)";
              return String(el.className || el.tagName).split(" ")[0] ?? "(unnamed)";
            })) as string;
          }
          const presses = await pressesToTheDock(back);
          if (back) out.backward = presses;
          else out.forward = presses;
        } catch {
          /* left as whatever it reached — a throw here is a finding */
        }
      }
      return out;
    };

    const destinations: Reach[] = [];
    for (const word of ["Inspirations", "Chats", "Principles"]) {
      destinations.push(await reachTheDockFrom(word));
    }
    console.log("\n  standing in a destination, how far away is the bar that leaves it:");
    for (const d of destinations) {
      console.log(
        `    ${d.word.padEnd(13)} ${d.opened ? `a ${d.role || "(no role)"}${d.modal ? ", aria-modal" : ""}` : "NEVER OPENED"}` +
          `   Shift+Tab: ${d.backward ? `${d.backward} press(es)` : "UNREACHABLE"}` +
          `   Tab: ${d.forward ? `${d.forward} press(es)` : "UNREACHABLE"}` +
          `   arrived with focus on ${d.landedOn}`,
      );
    }

    /**
     * ── THE WALL THAT IS NOT YOURS ─────────────────────────────────────────
     *
     * WHAT STOOD HERE AND WHY IT HAD TO CHANGE. Two walks, a room's wall and
     * an agent's, both reached by tabbing for `.jar-here-more` — the `▾`
     * beside the wall's name — then picking the neighbour out of the menu it
     * opened, then tabbing for `.jar-saved` to descend into that wall's
     * ground and counting what the listbox offered. `.jar-here-more` and
     * `.jar-saved` both have no renderer, so neither walk ever left
     * headquarters, and the run on 2026-10-12 before this edit ended:
     *
     *     a room    reached: NO    memories the keyboard can see:   0
     *     an agent  reached: NO    memories the keyboard can see:   0
     *     [by-keyboard] the keyboard path got WORSE:
     *                     a room's wall cannot be reached with the keyboard
     *                     an agent's wall cannot be reached with the keyboard
     *
     * One of those two was a false finding and the other was true for a
     * reason the line does not give, so they are split.
     *
     * THE ROOM'S WALL IS DELETED, NOT REPOINTED. Rooms went by a founder
     * ruling — "get rid of the rooms and agent related stuff for now",
     * carried in full at `tools/e2e/dead-css.ts` — and the only way into one
     * that survives is a `?join=<code>` address, which is a pointer-free
     * journey this walk cannot make without a second account to issue the
     * code. WHAT COVERAGE WENT: a room's ground is a different source from
     * your own (its members' public memories, through a different fetch into
     * a different ref) and nothing now walks it with a keyboard. WHAT WOULD
     * RESTORE IT: a seeded room and a `?join=` address, which is the same
     * thing `dead-css.ts` asks for and bigger than this file.
     *
     * THE AGENT'S WALL IS REPOINTED, BECAUSE THE DOOR MOVED AND IS BETTER.
     * The creature wears its own form switch now — two buttons, `ME` and
     * `MY AGENT`, in the corner row, under `Home.tsx`'s heading about the
     * character changing form where it stands rather than walking to another
     * column. Both are real buttons with real words on them, so the journey
     * is still tab-and-Enter and nothing here touches a pointer. Measured
     * with keys only on 2026-10-12: Tab reaches both faces, Enter travels,
     * and focus stays on the face you pressed (now `--standing`), which is
     * the arrival behaving.
     *
     * AND WHAT IT CLAIMS THERE IS THE JOURNEY, NOT THE GROUND. The old walk
     * counted `.jar-reach [role="option"]` on the neighbour's ground, which
     * needed the descent `.jar-saved` used to be. The door into the field is
     * Find now, and Find searches the wall you are standing on — so reaching
     * the agent's ground through it is a second journey with a second seed,
     * and the ground's own three claims are already held one section up on
     * the viewer's own wall. What is held here is what was actually false:
     * that the other wall can be reached at all without a pointer, and that
     * it is the agent's form you end up standing in.
     */
    interface Neighbour {
      travelled: boolean;
      /** what the button said, so the route is one a listener can be told */
      by: string;
      /** the form the creature is standing in after the press */
      standing: string;
    }

    const walkToTheAgent = async (): Promise<Neighbour> => {
      const out: Neighbour = { travelled: false, by: "", standing: "" };
      try {
        await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(7_000);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        for (let i = 0; i < 40; i += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(110);
          const here = await focused();
          if (!/jar-char-face/.test(here)) continue;
          /* THE FACE THAT IS NOT THE ONE YOU ARE STANDING IN. Pressing the
             one you are already on is specified to do nothing, so a walk
             that took the first face it met would press `ME` on `ME` and
             report that travel is broken. */
          if (/--standing/.test(here)) continue;
          out.by = (await page.evaluate(
            () => ((document.activeElement as HTMLElement | null)?.innerText ?? "").trim(),
          )) as string;
          await page.keyboard.press("Enter");
          await page.waitForTimeout(8_000);
          out.standing = (await page.evaluate(() => {
            const lit = document.querySelector(".jar-char-face--standing") as HTMLElement | null;
            return (lit?.innerText ?? "").trim();
          })) as string;
          out.travelled = out.standing !== "" && out.standing === out.by;
          break;
        }
      } catch {
        /* left as whatever it reached — a throw here is a finding, not a crash */
      }
      return out;
    };

    let agent: Neighbour = { travelled: false, by: "", standing: "" };
    try {
      /* The neighbour has to exist before it can be reached. Through the same
         API a click would call, and with memories of its own, because an
         agent's wall is built from the agent's OWN captures and never from
         its owner's. */
      await page.evaluate(async () => {
        const made = await fetch("/api/profiles", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Scout" }),
        });
        const agentId = ((await made.json()) as { profile?: { id: string } }).profile?.id;
        if (agentId) {
          for (let i = 0; i < 3; i += 1) {
            await fetch(`/api/inspirations?profile=${agentId}`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: `something the agent kept ${i}` }),
            });
          }
        }
      });
      agent = await walkToTheAgent();
    } catch {
      /* left as whatever it reached — a throw here is a finding, not a crash */
    }
    console.log(
      `\n  the wall that is not your own, travelled to with keys only:` +
        `\n    ${agent.travelled ? "yes" : "NO "}  reached by pressing ` +
        `${agent.by === "" ? "NOTHING NAMED" : `"${agent.by}"`}, and the creature now stands in ` +
        `${agent.standing === "" ? "NO FORM AT ALL" : `"${agent.standing}"`}`,
    );

    console.log(
      "\n[by-keyboard] The canvas still takes no focus of its own, and that is now the\n" +
        "              answer rather than the question: the ground is reached through the\n" +
        "              listbox above, which is what a reader can be told about, and the\n" +
        "              focus a sighted person sees is the orb lighting up out in the field.",
    );

    /* ── WHAT THIS GATE HOLDS ──────────────────────────────────────────────
       Every stop named, every stop visibly focused, the mouth usable with keys
       alone — true once, so losing any of them is somebody's edit rather than
       an open question.

       READING A MEMORY BACK JOINED THEM ON 2026-08-27. It was reported and not
       ratcheted for exactly one day, on the rule that a check which is always
       red is a check everyone learns to skip; the audit had found the archive
       write-only without a pointer and the fix was a design decision, not an
       oversight. The decision was made — roving focus in the world rather than
       a list of saves beside it — so the ground now answers to a `listbox` with
       one tab stop and a cursor the arrows move, and all three facts are held
       here.

       Named AND moving, not merely opened: one lucky Enter on anything
       satisfies "a memory opened", and a route nobody can describe or move
       along is a door with one thing behind it. */
    const broke: string[] = [];
    if (stops.length < 8) broke.push(`Tab reaches ${stops.length} stops, was 8`);
    if (unnamed.length > 0) {
      broke.push(`${unnamed.length} stop(s) announce nothing: ${unnamed.map((s2) => s2.cls).join(", ")}`);
    }
    if (dark.length > 0) {
      broke.push(`${dark.length} stop(s) show no visible focus: ${dark.map((s2) => s2.cls).join(", ")}`);
    }
    if (!keptByKeyboard) broke.push("a memory can no longer be kept with the keyboard alone");
    if (!memoryOpened) {
      broke.push(
        "no keyboard route opens a memory — the bar's Inspirations row, a Tab to a row and " +
          "Enter does not land on a note; the archive is write-only again",
      );
    }
    /* NAMED, NOT MERELY OPENED: one lucky Enter on anything satisfies "a
       memory opened", and a route nobody can be TOLD about is a route nobody
       is told about. The row carries its own preview and date as text, which
       is a name read out as it stands — so this asks the row what it says
       before pressing it rather than looking for an `aria-label` the design
       does not need. */
    if (memoryOpened && rowName === "") {
      broke.push("the archive opens to the keyboard but the row it pressed announces nothing");
    }
    if (memoryOpened && rowsOffered === 0) {
      broke.push("a note opened but the archive offered the keyboard no rows — measured by luck");
    }
    /* ── THE GROUND'S THREE CLAIMS, STILL RATCHETED ────────────────────────
       Ratcheted on 2026-08-27 — "the decision was made — roving focus in the
       world rather than a list of saves beside it — so the ground now answers
       to a `listbox` with one tab stop and a cursor the arrows move, and all
       three facts are held here."

       THEY NEARLY CAME OFF THE RATCHET IN THIS EDIT, ON A MISREADING. Forty
       Tabs from the top of the world never reach the field, so the first
       version of this pass concluded the ground was unreachable and moved all
       three to a printed note. The conclusion was wrong: `/` opens Find, a
       result is a real button, and Enter on one lands in the field with the
       listbox standing there. A ratchet loosened because the walk could not
       find the door is a ratchet loosened for the worst possible reason, and
       it would have been the fourth false finding in a file I was sent to
       remove three from. They stay. */
    if (!inTheGround) {
      broke.push(
        "the field cannot be reached with the keyboard — \"/\", a word that is really on this " +
          "wall, and Enter on a result does not land in the ground",
      );
    }
    if (inTheGround && reachName === "") {
      broke.push("the ground opens to the keyboard but announces nothing to a reader");
    }
    if (inTheGround && reachOptions === 0) {
      broke.push("the ground offers the keyboard nothing — the listbox is there and empty");
    }
    if (inTheGround && !reachMoves) {
      broke.push("the ground's cursor does not move — the keyboard reaches one memory, not the ground");
    }
    if (inTheGround && !openedTheAnnouncedWay) {
      broke.push("arriving in the ground opens no memory — the route ends on an empty field");
    }
    if (!sheetReturns) broke.push(`a sheet closed with Escape drops focus to ${sheetLandedOn}`);
    /* ── THE BAR IS REACHABLE FROM INSIDE EVERY DESTINATION ────────────────
       Three claims, and each of them is the one that was false:

         1. the destination opens from the bar with keys alone — if it does
            not, the rest is unmeasured rather than passing;
         2. it does not declare itself modal. `aria-modal` deletes the bar
            from the accessibility tree, and `role="dialog"` says the exit is
            inside, which on these four is a statement about a control that
            does not exist. A page says `region`;
         3. the bar can actually be reached, backwards AND forwards.

       BACKWARDS IS HELD AT A CEILING, AND THE FIRST DRAFT OF THIS HELD IT AT
       ONE, WRONGLY. The reasoning was that `way-out.test.ts` rests its
       exemption on "a visible way out costing one press", so one Shift+Tab
       ought to be the price — and it measured three on all three
       destinations, which looked like a finding and was a category error. The
       law's "one press" is one ACTIVATION: see the exit, press it once, be
       gone. How far focus has to travel to get onto that control is an
       ordinary keyboard distance, and every control in every product has one.
       Writing the gate so that the law meant "one Tab" would have made it
       red on a product that had just been fixed, and the lesson this file
       already records about itself — "a check which is always red is a check
       everyone learns to skip" — would have arrived a third time.

       So the number is held as a ceiling with a reason rather than a target.
       The three stops behind a destination are the chrome that legitimately
       outranks it: the two corners (`.waka-corners`, z-58 — "ABOVE A
       DESTINATION'S GROUND", `claims.css`) and then the bar's last row. Four
       is that plus one. A number above it means either the chrome grew tab
       stops over a page or the page grew something focusable above its own
       content, and both are worth a look; a number at or below it means the
       bar is where it has always been. The REAL claim is the one underneath:
       reachable at all, in both directions, which is precisely what was
       false.

       FORWARDS IS HELD ONLY AS REACHABLE AT ALL, with no number, because the
       count is the size of the destination: the archive forwards is every
       memory on the wall before the focus order comes round to the chrome.
       Reaching it forwards is the proof there is no trap. */
    const DOCK_IS_AT_MOST = 4;
    for (const d of destinations) {
      if (!d.opened) {
        broke.push(`the bar's "${d.word}" row does not open its destination with the keyboard`);
        continue;
      }
      if (d.modal || d.role === "dialog") {
        broke.push(
          `"${d.word}" is a destination reached from a bar that never leaves the screen, and it ` +
            `renders as ${d.role === "dialog" ? 'role="dialog"' : `role="${d.role}"`}` +
            `${d.modal ? " with aria-modal" : ""} — which says the way out is inside it, and it is not`,
        );
      }
      if (!d.backward) {
        broke.push(
          `standing in "${d.word}", Shift+Tab cannot reach the bar in 60 presses — the surface ` +
            "traps focus, so the dock that way-out.test.ts calls its way out is unreachable and " +
            "this destination has NO way out at all",
        );
      } else if (d.backward > DOCK_IS_AT_MOST) {
        broke.push(
          `standing in "${d.word}", the bar is ${d.backward} presses back, over the ceiling of ` +
            `${DOCK_IS_AT_MOST} — either the chrome gained tab stops over a page or the page ` +
            "gained something focusable above its own content",
        );
      }
      if (!d.forward) {
        broke.push(
          `standing in "${d.word}", Tab cannot reach the bar in 60 presses — focus is trapped ` +
            "going forwards",
        );
      }
      /* THE CLAIM THE `ways` LOOP USED TO MAKE, ON A SURFACE THAT EXISTS.
         `"(the document)"` is the finding and nothing else is: a destination
         is allowed to put focus anywhere inside itself, or to leave it on the
         row that opened it, because that row does not unmount. What it may
         not do is drop it. */
      if (d.landedOn === "(the document)") {
        broke.push(
          `arriving in "${d.word}" with the keyboard drops focus to the document — the row that ` +
            "opened it is still on screen and still lit, so the person is now at the top of the " +
            "page looking at a control they are not standing on",
        );
      }
    }
    /* THE WALL THAT IS NOT YOUR OWN, HELD AS TIGHTLY AS YOURS.
       A fix that only lands on your own wall is the shape of a keyboard path
       that works in the demo. This was true the day it was first walked, on a
       fresh account seeded through the same API a click would call, so losing
       it is somebody's edit rather than an open question. The room's half of
       this went with its door — see the note above `walkToTheAgent` for what
       coverage that cost and what would bring it back. */
    if (!agent.travelled) {
      broke.push(
        agent.by === ""
          ? "the agent's wall cannot be reached with the keyboard — no tab stop in the world " +
            "is one of the creature's two forms"
          : `pressing "${agent.by}" with the keyboard did not change which form the creature ` +
            `stands in — it is still "${agent.standing || "nothing at all"}"`,
      );
    }
    if (broke.length > 0) {
      console.log(`\n[by-keyboard] the keyboard path got WORSE:\n${broke.map((b) => `                ${b}`).join("\n")}`);
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[by-keyboard] crashed:", err);
  process.exit(2);
});
