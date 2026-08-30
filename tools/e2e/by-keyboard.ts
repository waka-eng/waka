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
 *   a memory     can one be opened and read without a pointer
 *   the reach    is the ground named, and does its cursor move
 *   a sheet      does Escape hand focus back to what opened it
 *   a way        does arriving somewhere keep your place, or drop it
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
      await page.locator(".jar-mouth-rest").first().click({ timeout: 8_000 });
      await page.waitForTimeout(700);
      await page.fill(
        'textarea[aria-label="capture inspiration"]',
        `something worth finding again ${i} ${uniq()}`,
      );
      await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
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

    let keptByKeyboard = false;
    try {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        const isMouth = (await page.evaluate(() =>
          String((document.activeElement as HTMLElement | null)?.className ?? "").includes(
            "jar-mouth-rest",
          ),
        )) as boolean;
        if (!isMouth) continue;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        await page.keyboard.type("kept with no mouse at all");
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4_500);
        keptByKeyboard = (await page.evaluate(async () => {
          const r = await fetch("/api/inspirations?limit=50", { credentials: "include" });
          const b = (await r.json()) as { inspirations?: Array<{ textPreview: string }> };
          return (b.inspirations ?? []).some((x) => x.textPreview.includes("no mouse at all"));
        })) as boolean;
        break;
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

    /* the one real sheet in the world's chrome */
    const sheetLandedOn = await focusAfterKey("jar-account", "Escape");
    const sheetReturns = sheetLandedOn.includes("jar-account");

    /* and the two ways out of the wall, each of which unmounts behind you */
    const ways: Array<{ way: string; landedOn: string; kept: boolean }> = [];
    for (const way of ["jar-values", "jar-saved"]) {
      const landedOn = await focusAfterKey(way, null);
      ways.push({ way, landedOn, kept: landedOn !== "(the document)" });
    }

    /* AND READING ONE BACK. The door is a real button, so it can be reached;
       what matters is whether anything BEHIND it can be. */
    let memoryOpened = false;
    let openedTheAnnouncedWay = false;
    let reachName = "";
    let reachRole = "";
    let reachMoves = false;
    try {
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        const onDoor = (await page.evaluate(() =>
          String((document.activeElement as HTMLElement | null)?.className ?? "").includes(
            "jar-saved",
          ),
        )) as boolean;
        if (!onDoor) continue;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3_500);
        /**
         * TWO WAYS IN, AND BOTH ARE ASKED.
         *
         * The announced one first: whatever the ground says it answers to is
         * pressed, exactly as somebody who heard its label read out would
         * press it. A route only a blind walk can find is a route nobody is
         * told about, and this half is what says the label is true.
         *
         * Then the blind one — keep tabbing and pressing Enter, so any route
         * at all is found even if it is undocumented. It needs a leash:
         * pressing Enter on everything eventually presses Enter on the way
         * back UP, and the rest of the walk then hunts for a memory on a wall
         * that has none. That is exactly how this reported "the archive is
         * write-only" against a working ground, the first time the ground took
         * focus on arrival — the instrument left the room it was searching and
         * never noticed it had gone. So each round checks it is still standing
         * in the ground, and walks back down if it is not.
         */
        const inTheGround = async (): Promise<boolean> =>
          (await page.locator(".jar-reach").count()) > 0;

        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(1_200);
        if ((await page.locator(".jar-panel").count()) > 0) {
          memoryOpened = true;
          openedTheAnnouncedWay = true;
        }

        for (let j = 0; j < 25 && !memoryOpened; j += 1) {
          if (!(await inTheGround())) {
            for (let k = 0; k < 20; k += 1) {
              await page.keyboard.press("Tab");
              await page.waitForTimeout(100);
              const backOnDoor = (await page.evaluate(() =>
                String((document.activeElement as HTMLElement | null)?.className ?? "").includes(
                  "jar-saved",
                ),
              )) as boolean;
              if (!backOnDoor) continue;
              await page.keyboard.press("Enter");
              await page.waitForTimeout(3_000);
              break;
            }
            if (!(await inTheGround())) break;
          }
          await page.keyboard.press("Tab");
          await page.waitForTimeout(100);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(400);
          if ((await page.locator(".jar-panel").count()) > 0) memoryOpened = true;
        }

        if (memoryOpened) {
          {
            /**
             * AND WHAT IT WAS THAT OPENED IT.
             *
             * "A memory opened" is satisfied by one lucky Enter on anything.
             * The route is only a route if it can be described: something
             * focused, named for a listener, holding a cursor that moves. So
             * the element that did it is asked what it is, moved once, and
             * asked again.
             */
            const before = (await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el) return null;
              return {
                cls: el.className,
                role: el.getAttribute("role") ?? "",
                name: (el.getAttribute("aria-label") ?? "").trim(),
                at: el.getAttribute("aria-activedescendant") ?? "",
              };
            })) as { cls: string; role: string; name: string; at: string } | null;
            reachName = before?.name ?? "";
            reachRole = before?.role ?? "";
            await page.keyboard.press("ArrowLeft");
            await page.waitForTimeout(400);
            const after = (await page.evaluate(
              () =>
                (document.activeElement as HTMLElement | null)?.getAttribute(
                  "aria-activedescendant",
                ) ?? "",
            )) as string;
            /* A cursor that does not move is a cursor that reaches exactly one
               memory, which is a door with one thing behind it. */
            reachMoves = before !== null && before.at !== "" && after !== "" && after !== before.at;
          }
        }
        break;
      }
    } catch {
      memoryOpened = false;
    }

    console.log(
      `\n  ${unnamed.length} of ${stops.length} stops announce nothing to a reader` +
        `\n  ${dark.length} of ${stops.length} stops show no visible focus` +
        `\n  the canvas ${canvasFocusable ? "can be focused" : "CANNOT be focused — no tabindex"}` +
        `\n  keeping a memory with keys alone: ${keptByKeyboard ? "works" : "DID NOT WORK"}` +
        `\n  opening one to read it:          ${memoryOpened ? "works" : "DID NOT WORK"}` +
        `\n  the ground answers to:           ${
          reachName === "" ? "NOTHING NAMED" : `${reachRole || "no role"} — "${reachName}"`
        }` +
        `\n  arrows move along it:            ${reachMoves ? "yes" : "NO"}` +
        `\n  ...the way its own label says:   ${openedTheAnnouncedWay ? "yes" : "no — found by a blind walk"}`,
    );
    console.log(
      `\n  a sheet closed with Escape hands focus back: ${
        sheetReturns ? "yes" : `NO — lands on ${sheetLandedOn}`
      }`,
    );
    console.log("\n  travelling with keys keeps your place:");
    for (const w of ways) {
      console.log(
        `    ${w.kept ? "yes " : "NO  "}  .${w.way.padEnd(12)} arrives with focus on ${w.landedOn}`,
      );
    }
    /**
     * ── THE GROUND THAT IS NOT YOURS ───────────────────────────────────────
     *
     * Everything above stands on the viewer's own wall. A room's ground is a
     * different source entirely — its members' public memories, arriving
     * through a different fetch into a different ref — and an agent's is a
     * third. The reach reads all three, and only one of them had ever been
     * walked: the shape of a keyboard path that works in the demo.
     *
     * Travelled to with keys only. The way to another wall is a real button
     * that opens a real menu of real buttons, so the whole journey is
     * tab-and-Enter and nothing here touches a pointer.
     */
    const groundReach = (): { travelled: boolean; options: number; opened: boolean } => ({
      travelled: false,
      options: 0,
      opened: false,
    });

    /**
     * The journey both neighbours share: to the way-to-another-wall, through
     * the menu it opens, down through the door, and one press of the key the
     * ground's own label names. `matches` picks the neighbour out of the menu
     * by the words on its button, which is all a person has too.
     */
    const walkToNeighbour = async (
      matches: (name: string) => boolean,
    ): Promise<{ travelled: boolean; options: number; opened: boolean }> => {
      const out = groundReach();
      try {
        await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(7_000);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(100);
          const here = (await page.evaluate(
            () => String((document.activeElement as HTMLElement | null)?.className ?? ""),
          )) as string;
          if (!here.includes("jar-here-more")) continue;
          await page.keyboard.press("Enter");
          await page.waitForTimeout(800);
          for (let j = 0; j < 12; j += 1) {
            await page.keyboard.press("Tab");
            await page.waitForTimeout(120);
            const name = (await page.evaluate(
              () => (document.activeElement as HTMLElement | null)?.textContent ?? "",
            )) as string;
            if (!matches(name)) continue;
            await page.keyboard.press("Enter");
            await page.waitForTimeout(6_000);
            out.travelled = true;
            break;
          }
          break;
        }

        if (!out.travelled) return out;

        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(100);
          const here = (await page.evaluate(
            () => String((document.activeElement as HTMLElement | null)?.className ?? ""),
          )) as string;
          if (!here.includes("jar-saved")) continue;
          await page.keyboard.press("Enter");
          await page.waitForTimeout(4_000);
          break;
        }
        out.options = (await page.evaluate(
          () => document.querySelectorAll('.jar-reach [role="option"]').length,
        )) as number;
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(1_500);
        out.opened = (await page.locator(".jar-panel").count()) > 0;
      } catch {
        /* left as whatever it reached — a throw here is a finding, not a crash */
      }
      return out;
    };

    let roomReach = groundReach();
    let agentReach = groundReach();
    try {
      /* Both neighbours need a ground before they have one to reach. A
         person's memories are private by default and a room draws only what
         its members marked public, so they are published first; the agent is
         given memories of its own, because an agent's wall is built from the
         agent's OWN captures and never from its owner's. Everything here goes
         through the same API a click would call. */
      const roomName = `Room ${uniq()}`;
      await page.evaluate(async (name) => {
        const listed = await fetch("/api/inspirations?limit=50", { credentials: "include" });
        const body = (await listed.json()) as { inspirations?: Array<{ id: string }> };
        for (const row of body.inspirations ?? []) {
          await fetch(`/api/inspirations/${row.id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ visibility: "public" }),
          });
        }
        await fetch("/api/groups", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });

        const madeAgent = await fetch("/api/profiles", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Scout" }),
        });
        const agent = (await madeAgent.json()) as { profile?: { id: string } };
        const agentId = agent.profile?.id;
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
      }, roomName);

      roomReach = await walkToNeighbour((name) => name.toLowerCase().includes("room"));
      agentReach = await walkToNeighbour((name) => name.toLowerCase().includes("scout"));
    } catch {
      /* left as whatever it reached — a throw here is a finding, not a crash */
    }
    console.log("\n  the two grounds that are not your own, travelled to with keys only:");
    for (const [what, r] of [
      ["a room", roomReach],
      ["an agent", agentReach],
    ] as const) {
      console.log(
        `    ${what.padEnd(9)} reached: ${r.travelled ? "yes" : "NO "}   ` +
          `memories the keyboard can see: ${String(r.options).padStart(3)}   ` +
          `one opens: ${r.opened ? "yes" : "NO"}`,
      );
    }

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
    if (!memoryOpened) broke.push("no keyboard route opens a memory — the archive is write-only again");
    if (memoryOpened && reachName === "") {
      broke.push("the ground opens to the keyboard but announces nothing to a reader");
    }
    if (memoryOpened && !reachMoves) {
      broke.push("the ground's cursor does not move — the keyboard reaches one memory, not the ground");
    }
    if (memoryOpened && !openedTheAnnouncedWay) {
      broke.push("the ground's label promises keys that do not open a memory");
    }
    if (!sheetReturns) broke.push(`a sheet closed with Escape drops focus to ${sheetLandedOn}`);
    for (const w of ways) {
      if (!w.kept) broke.push(`travelling through .${w.way} drops focus to the document`);
    }
    /* THE OTHER TWO GROUNDS, HELD AS TIGHTLY AS YOUR OWN.
       The reach reads three sources and a fix that only lands on one of them
       is the shape of a keyboard path that works in the demo. Both of these
       were true the day they were first walked, on a fresh account seeded
       through the same API a click would call, so losing either is somebody's
       edit rather than an open question. */
    for (const [what, r] of [
      ["a room", roomReach],
      ["an agent", agentReach],
    ] as const) {
      if (!r.travelled) {
        broke.push(`${what}'s wall cannot be reached with the keyboard`);
      } else if (r.options === 0) {
        broke.push(`${what}'s ground offers the keyboard nothing`);
      } else if (!r.opened) {
        broke.push(`${what}'s ground can be moved along but nothing opens`);
      }
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
