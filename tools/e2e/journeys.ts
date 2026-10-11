#!/usr/bin/env tsx
/**
 * THE JOURNEYS, DRIVEN THE WAY A PERSON PERFORMS THEM.
 *
 * Six harnesses already prove this product over HTTP — `organic`, `signals`,
 * `top-of-mind`, `groups`, `cold-start`, `principles`. Between them they show
 * that a client calling the API gets a memory system back, and on 2026-08-22
 * they ran 45 steps green.
 *
 * Not one of them opens a browser. So on the same day, against the same green
 * stack, a signed-in person whose network could not reach a font CDN got `/`
 * as a black rectangle — the entire product missing, while every API suite
 * stayed passing, because the API was never what broke.
 *
 * This harness covers what only a browser can reach: a form filled in, a
 * canvas rendered, a confirmation seen, a name that survives a reload.
 *
 * ── WHY THERE IS A `--negative` MODE, AND WHY IT IS NOT OPTIONAL ───────────
 *
 * A browser assertion that has only ever been green proves the harness ran.
 * It does not prove the harness would notice. That distinction is the whole
 * reason this file exists, so it is enforced rather than promised: every
 * journey carries a `breaks` function that sabotages the one API call it
 * depends on, and `--negative` runs each journey against its own sabotage and
 * requires it to FAIL.
 *
 * A journey that passes in `--negative` is decoration. It is reported as a
 * failure of this harness, not of the product, and it is deleted rather than
 * kept — `docs/goals/every-workflow-works.md` Phase 2 gate.
 *
 * Read the two modes as one claim: "this journey works, **and** here is the
 * proof that I would have told you if it did not."
 *
 * ── RUNNING IT ────────────────────────────────────────────────────────────
 *
 *     pnpm dev:local              # terminal A — builds, then serves dist
 *     pnpm e2e:journeys           # terminal B — every journey must pass
 *     pnpm e2e:journeys --negative   # every journey must fail when broken
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010), `--negative`,
 *        `--only <id>` to run one journey by id.
 *
 * Third-party fonts are stubbed rather than blocked. `first-paint.ts` owns the
 * hostile-network case and blocks them outright; here they are noise, and a
 * stub keeps a font CDN outage from being reported as a broken journey.
 */
import { type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { settleAfterArrival } from "./arrival";
import { launchChromium } from "./browser";
import { openTheNotepad, saveAnInspiration } from "./keep";
interface Args {
  baseUrl: string;
  negative: boolean;
  only: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", negative: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--negative") args.negative = true;
    else if (flag === "--only") args.only = take();
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:journeys [--base-url <url>] [--negative] [--only <id>]");
      process.exit(0);
    } else {
      console.error(`[journeys] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

/** What a journey reports. `detail` is printed either way, so a pass is auditable too. */
interface Outcome {
  ok: boolean;
  detail: string;
}

interface Journey {
  id: string;
  /** Reads as a sentence about the person, not about the code. */
  name: string;
  /** Sabotage for `--negative`: break the one call this journey rests on. */
  breaks: (ctx: BrowserContext) => Promise<void>;
  run: (page: Page, base: string) => Promise<Outcome>;
}

// ---------------------------------------------------------------------------
// Shared helpers

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Stub every third-party asset so a CDN cannot color a journey's result. */
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

/** Fail one API path with a 500, leaving everything else alone. */
async function breakRoute(
  ctx: BrowserContext,
  match: (pathname: string, method: string) => boolean,
): Promise<void> {
  await ctx.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (match(url.pathname, route.request().method())) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "sabotaged by --negative" }),
        });
      }
      return route.fallback();
    },
  );
}

/** One password for every journey's account, so a journey can sign back in. */
const SIGNUP_PASSWORD = "journey-local-password-1";

async function signUp(page: Page, base: string): Promise<{ email: string; name: string }> {
  const email = `journey-${uniq()}@example.test`;
  const name = "Journey Tester";
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", SIGNUP_PASSWORD);
  await page.fill("input[name=name]", name);
  await page.click("button[type=submit]");
  await page.waitForTimeout(6_000);
  return { email, name };
}

/** The flat surfaces navigate by a footer of text buttons. */
/**
 * `/profile` IS NOT A FLAT SCREEN IN THE SENSE THAT WAS RETIRED, so this stays.
 * There is no memory to stand in before you are authenticated, and account
 * work wants focus traps and plain confirmations that in-layout UI cannot
 * give. The eleven routes this used to reach — `/capture`, `/inspirations`,
 * `/signals`, `/principles`, `/top-of-mind`, `/rooms`, `/agents`, `/graph` —
 * were deleted on 2026-08-25 and their journeys now walk the world instead.
 */
async function goSurface(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
}

/**
 * KEEPING SOMETHING, THE WAY A PERSON DOES IT NOW.
 *
 * This was `goto /capture`, fill `What caught you?`, press `keep`. That screen
 * is gone; the act lives in the world's mouth, which is where it always
 * happened for anyone who did not know the flat routes existed.
 */
/**
 * WHAT THE BOTTOM EDGE SAYS IS BEHIND THE DOOR — the world's own count, as
 * words. `-1` when the door is not on screen, which is the case with nothing
 * kept yet.
 */
async function countInWorld(page: Page): Promise<number> {
  return (await page.evaluate(() => {
    const el = document.querySelector(".jar-saved-count");
    if (!el) return -1;
    const m = /(\d+)/.exec(el.textContent ?? "");
    return m ? Number(m[1]) : -1;
  })) as number;
}

async function keepInWorld(page: Page, base: string, text: string): Promise<number> {
  if (!new URL(page.url()).pathname.match(/^\/$/)) {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
  }
  await saveAnInspiration(page, text);
  /* WHAT THE WORLD SAID, READ WHILE IT IS SAYING IT. The character's voice
     clears itself after four seconds, so a caller that waits for the keep to
     settle and THEN reads the page finds the resting label and concludes
     nothing was acknowledged. Caught exactly that way. */
  await page.waitForTimeout(4_500);
  return countInWorld(page);
}

/**
 * WHAT THE ARCHIVE HOLDS, ASKED OF THE ARCHIVE.
 *
 * `/inspirations` printed the archive as a list and these journeys read the
 * page's text to ask "is it still there". The world draws the archive as a
 * FIELD OF ORBS — there is no text to read, by design, and a canvas cannot
 * answer a question about a phrase.
 *
 * So persistence is asked of the same endpoint the world itself reads, in the
 * page, with the session's own cookie. That is not a weaker claim than the
 * old one: the flat list was a rendering of exactly this. What the WORLD does
 * with a keep is a separate claim and has its own journey — `first-keep`
 * asserts the orb arrives.
 */
/**
 * OPENING A MEMORY, WHICH IN THE WORLD MEANS FINDING ITS ORB.
 *
 * The flat list had rows to click. The field has orbs on a canvas, placed by
 * the frame loop, and nothing outside the page knows where they are — so this
 * descends through the count and sweeps until a card opens AND STAYS open.
 *
 * The "stays" is load-bearing: a closing card lingers in the DOM for 200ms, so
 * a sweep that stops at the first `.jar-panel` it sees keeps catching the tail
 * of one an earlier click already dismissed, and then measures an empty field.
 * Learned by doing exactly that.
 */
/**
 * THE SWEEP IS IN VIEWPORT PIXELS, SO THE VIEWPORT HAS TO BE SAID. The
 * defaults are the harness's own 1440x900 and every caller but one takes
 * them. `the-hand` walks at 390x844, where every x past 390 is off the glass
 * and `mouse.click` there reaches nothing at all — a sweep that silently
 * clicked into space for two thirds of its passes and then reported "no
 * memory opened" as if the product had failed.
 */
async function openAMemory(
  page: Page,
  bounds: { xs: number[]; ys: number[] } = {
    xs: Array.from({ length: 28 }, (_, i) => 160 + i * 28),
    ys: [390, 350, 430, 310, 470, 270, 510, 230, 550],
  },
): Promise<boolean> {
  const panels = async (): Promise<number> =>
    (await page.evaluate(() => document.querySelectorAll(".jar-panel").length)) as number;
  try {
    await page.locator(".jar-saved").first().click({ timeout: 20_000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(4_000);
  for (const y of bounds.ys) {
    for (const x of bounds.xs) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(500);
      if ((await panels()) === 0) continue;
      await page.waitForTimeout(1_200);
      if ((await panels()) > 0) return true;
    }
  }
  return false;
}

async function archiveHolds(page: Page, phrase: string): Promise<boolean> {
  return (await page.evaluate(async (needle: string) => {
    const r = await fetch("/api/inspirations?limit=200", { credentials: "include" });
    if (!r.ok) return false;
    const body = (await r.json()) as { inspirations?: Array<{ textPreview: string }> };
    return (body.inspirations ?? []).some((row) => row.textPreview.includes(needle));
  }, phrase)) as boolean;
}

const bodyText = (page: Page): Promise<string> =>
  page.evaluate(() => document.body.innerText.trim());

/**
 * The page's words, MINUS anything inside a `<select>`.
 *
 * `/profile`'s language picker lists its options by native name — `English`
 * and `한국어` — and that is correct: you should be able to find your own
 * language whatever language the product is currently in. It also means the
 * page contains Hangul at all times, so "is there Hangul on screen" is a
 * question that cannot come back no on that route.
 *
 * That cost a false pass. The `locale` journey's fresh-browser check read
 * `document.body.innerText`, found `한국어` in the picker, and reported a
 * Korean product while every label around it said DISPLAY NAME and LANGUAGE.
 * It was caught by tracing why only one of two assertions had fired, not by
 * anything in the harness noticing.
 */
const translatableText = (page: Page): Promise<string> =>
  /* NO CALLBACKS INSIDE `evaluate`, AND NOT FOR STYLE. The first version used
     a TreeWalker with an `acceptNode` filter and died on `__name is not
     defined` — esbuild's keep-names shim reaches into function expressions
     passed to `page.evaluate` and the helper it references does not exist in
     the page. Plain loops are the only reliable shape in here, and this is the
     second place in this harness to learn it.

     The selects are hidden in the LIVE document rather than stripped from a
     clone, because `innerText` is what respects visibility and it returns
     nothing useful on a detached node. They are put back immediately. */
  page.evaluate(() => {
    const selects = document.querySelectorAll<HTMLSelectElement>("select");
    const previous: string[] = [];
    for (let i = 0; i < selects.length; i += 1) {
      previous.push(selects[i]!.style.display);
      selects[i]!.style.display = "none";
    }
    const text = document.body.innerText.trim();
    for (let i = 0; i < selects.length; i += 1) {
      selects[i]!.style.display = previous[i]!;
    }
    return text;
  });

/** WCAG relative luminance of an `rgb(…)` / `rgba(…)` string. */
function luminance(css: string): number {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((raw) => {
    const u = Number(raw) / 255;
    return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb(…)` strings, 1:1 to 21:1. */
function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------
// The journeys

const JOURNEYS: Journey[] = [
  {
    id: "cold-start",
    name: "a brand-new person signs up and the world is standing there",
    /* Withhold the world's own chunk. The account is fine; the product is not. */
    breaks: async (ctx) => {
      await ctx.route(
        (url) => /\/assets\/Home-[^/]*\.js$/.test(url.pathname),
        (route) => route.abort("failed"),
      );
    },
    run: async (page, base) => {
      await signUp(page, base);
      const state = await page.evaluate(() => ({
        path: window.location.pathname,
        canvases: document.querySelectorAll("canvas").length,
        text: document.body.innerText.trim(),
      }));
      /* An empty world must still SAY something — #262 exists because it used
         to say nothing at all, which reads as broken rather than as new. */
      const speaks = /nothing is forming yet|forming/i.test(state.text);
      const ok = state.path === "/" && state.canvases > 0 && speaks;
      return {
        ok,
        detail: `path=${state.path} canvases=${state.canvases} emptyStateSpeaks=${speaks}`,
      };
    },
  },

  {
    id: "keep",
    name: "something kept is acknowledged, and is there afterwards",
    breaks: (ctx) => breakRoute(ctx, (p, m) => p === "/api/inspirations" && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);
      const phrase = `the funicular counts down in stops not minutes ${uniq()}`;
      const before = await countInWorld(page);
      const after = await keepInWorld(page, base, phrase);

      /* TWO CLAIMS, AND THE SECOND IS THE ONE THAT MATTERS. The world saying
         so is the product saying so; the archive holding it is the product
         meaning it. A confirmation without persistence is the worse bug.
         
         WHAT "SAYING SO" IS IN THE WORLD, and it took a failed run to get
         right. The flat screen printed a quiet "kept". A plain `save` here
         answers in the two channels the world has — the companion flares and
         an orb drops — and BOTH ARE CANVAS EVENTS with no text to read. Only
         `reflect` prints the word, because it is about to open a sheet over
         the keep and has to say the keep happened first.
         
         So the acknowledgement asked for here is the one the world writes in
         words: the count on the bottom edge, which is the door into what you
         have kept and prints how much is behind it. It rising IS the product
         saying so, in the only text the act produces. */
      const acknowledged = after === before + 1 || (before === -1 && after === 1);
      const persisted = await archiveHolds(page, phrase);
      return {
        ok: acknowledged && persisted,
        detail: `the count read ${before} then ${after}; the archive holds it: ${persisted}`,
      };
    },
  },

  {
    id: "first-keep",
    name: "the very first memory a person keeps appears in the field",
    /* The keep itself is what this rests on. With the POST failing there is
       nothing to appear, so the field stays dark and the journey fails —
       which is also exactly what it looks like when the bug is present. */
    breaks: (ctx) => breakRoute(ctx, (p, m) => p === "/api/inspirations" && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);

      /* Read the FIELD off the canvas rather than the DOM. There is nothing in
         the DOM to read: an orb is painted, and the whole claim of this
         journey is about paint. The band is the bottom quarter, which is where
         `assignHomes` fits the ground. */
      const fieldLight = () =>
        page.evaluate(() => {
          const c = document.querySelector("canvas");
          if (!c) return null;
          const g = c.getContext("2d");
          if (!g) return null;
          const y = Math.floor(c.height * 0.72);
          const h = Math.floor(c.height * 0.26);
          const d = g.getImageData(0, y, c.width, h).data;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 4 * 17) {
            sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
            n += 1;
          }
          return Math.round((sum / n) * 100) / 100;
        });

      const before = await fieldLight();
      if (before === null) return { ok: false, detail: "no canvas to read the field from" };

      /* THE MOUTH BY ITS CLASS, NOT BY ITS WORDS. The resting phrase has been
         renamed twice — "Keep something" then "Capture inspiration" (founder,
         2026-08-25) — and it is not even a constant: the slot carries the
         companion's line whenever the creature has just spoken, so a
         text-matched selector misses on a run where the greeting happens to
         be showing. `.jar-mouth-rest` is what the control IS. */
      await openTheNotepad(page);
      await page.waitForTimeout(900);
      await page.fill(
        /* The mouth's own label, which matches its visible placeholder — an
           accessible name that does not is its own bug. It has read "something
           worth keeping" and "keep something" before now; a selector naming a
           label the product no longer has does not fail loudly, it times out
           for thirty seconds and reports the journey broken. Kept as the label
           rather than the class BECAUSE the accessible name is the claim: a
           person using a screen reader has to be told what this field is. */
        'textarea[aria-label="Capture inspiration"]',
        `a lift button that dims once it has heard you ${uniq()}`,
      );
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5_000);

      const after = await fieldLight();
      /* Measured 2026-08-23 on a brand-new account: the field reads ~0.07
         empty, ~0.05 after the first keep WHEN THE BUG IS PRESENT — the orb
         exists and is simply not drawn until something re-solves the ground —
         and ~1.95 once the page is RELOADED. So the three states are well
         separated and the absolute floor is what tells them apart: 0.5 sits
         six times over the empty frame and three times under the reload.

         THE RATIO IS THE BRITTLE HALF, and it was ×10. It multiplies a
         near-zero baseline, so an empty frame that reads 0.09 instead of 0.07
         moves the bar from 0.7 to 0.9 and a genuine, visible, seven-fold rise
         to 0.63 is reported as "the first memory does not appear in the
         field". It is ×5 now: still a real relative claim, no longer a
         measurement of how dark this particular empty frame happened to be.

         A fresh orb is DIMMER than the same orb after a reload, and that is
         the product being honest rather than a shortfall: nothing has been
         read from a memory one second old, so it carries nothing and is drawn
         carrying nothing. The re-light when the distillation pass lands is
         what gives it whatever it turns out to hold up. */
      const ok = after !== null && after > before * 5 && after > 0.5;
      return { ok, detail: `fieldLight ${before} -> ${after} (reload shows ~1.95)` };
    },
  },

  {
    id: "keep-from-elsewhere",
    name: "a memory kept from somebody else's wall says where it went",
    /* The keep is what this rests on: with the POST failing the archive does
       not hold it and the world says the failure instead, so both halves go
       red — which is also what the bug looked like, minus the failure line. */
    breaks: (ctx) => breakRoute(ctx, (p, m) => p === "/api/inspirations" && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);

      /* SOMEWHERE THAT IS NOT YOUR OWN WALL. A room is the reachable one — an
         agent's wall needs an agent, a room needs only the person. Made
         through the world's own door rather than the API, because the wall
         this journey stands on has to be one the product actually built. */
      await page.locator(".jar-here-more").first().click();
      await page.waitForTimeout(800);
      await page.getByText(/^add new$/i).first().click();
      await page.waitForTimeout(1_200);
      await page.locator(".jar-newplace-row", { hasText: /a room/i }).first().click();
      await page.waitForTimeout(1_200);
      /* `.jar-roomform` scopes it and `make it` confirms it: the agent form
         shares the box class and says `give it a wall`. */
      await page.fill(".jar-roomform .jar-roomform-box", "Studio");
      await page.locator(".jar-roomform button", { hasText: /^make it$/i }).first().click();
      await page.waitForTimeout(8_000);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.locator(".jar-here-more").first().click();
      await page.waitForTimeout(900);
      const studio = page.locator(".jar-hq button", { hasText: /^studio$/i });
      if ((await studio.count()) === 0) {
        return { ok: false, detail: "no room was made, so there was nowhere else to stand" };
      }
      await studio.last().click();
      await page.waitForTimeout(4_000);

      const restSlot = (): Promise<string> =>
        page.evaluate(() => {
          const el = document.querySelector(".jar-mouth-rest");
          return el ? (el.textContent ?? "").trim() : "";
        });

      const resting = await restSlot();
      if (resting === "") {
        return { ok: false, detail: "the room's wall offers no mouth, so nothing could be kept" };
      }

      const phrase = `kept while standing somewhere else ${uniq()}`;
      await openTheNotepad(page);
      await page.waitForTimeout(700);
      await page.fill('textarea[aria-label="Capture inspiration"]', phrase);
      /* Enter rather than the `save` button `keepInWorld` presses: the same
         act, and the one a person writing a sentence actually reaches for. */
      await page.keyboard.press("Enter");

      /* READ IT WHILE IT IS BEING SAID. The line is a whisper and clears
         itself after four seconds — the same trap `keepInWorld` documents
         from the other direction. */
      await page.waitForTimeout(1_500);
      const said = await restSlot();
      const persisted = await archiveHolds(page, phrase);

      /* WHY THIS IS A JOURNEY OF ITS OWN. On your own wall the receipt is the
         orb: it drops into the ground in front of you and that IS the world
         saying so. Standing in a room the ground is somebody else's, so no
         orb drops — and measured on 2026-08-31 nothing else happened either:
         no orb, no line, and no count, because the archive door is not on a
         room's wall at all. The memory landed and the mouth just emptied. A
         person who cannot tell whether it took writes it again.

         So the claim is both halves together, and neither alone is worth
         much: the world SAID something other than its resting phrase, and the
         archive actually HOLDS it. */
      const spoke = said !== "" && said !== resting;
      return {
        ok: spoke && persisted,
        detail: `standing in a room, the mouth read ${JSON.stringify(said)} (at rest: ` +
          `${JSON.stringify(resting)}); the archive holds it: ${persisted}`,
      };
    },
  },

  {
    id: "seek",
    name: "a memory can be found again by a word from inside it",
    breaks: (ctx) =>
      breakRoute(ctx, (p, m) => p === "/api/inspirations" && m === "GET"),
    run: async (page, base) => {
      await signUp(page, base);
      const needle = `pumpernickel-${uniq()}`;
      await keepInWorld(page, base, `a word nobody repeats: ${needle}`);

      /* Bury it, so the assertion is about search rather than about recency. */
      for (let i = 0; i < 3; i += 1) await keepInWorld(page, base, `filler capture ${i} ${uniq()}`);

      /* THE WORLD'S OWN FIND, which is `/` — the gesture people already have
         for searching a page, put on the layout rather than in a menu. It asks
         the server for the whole archive rather than filtering the window in
         hand, which is the same search the flat list ran.
         
         AND THE ASSERTION IS THE PRODUCT'S OWN VERDICT. The flat screen
         printed matching rows and this read them back. The world lights the
         orbs it found and says "nothing here says that" when it found none —
         so the question "was it found" is answered by whether the world says
         that sentence. There is no list of words to read, by design. */
      /* THE WORLD HAS TO BE LISTENING BEFORE IT CAN HEAR A KEY — AND ONCE,
         IT NEVER STARTED.

         This walk flaked about one run in four with a bare Playwright timeout
         — "waiting for locator(input[placeholder=…])" — which says only that
         the field never came and nothing about why. Three questions closed
         it. What did the page look like at the moment of the press? Ready:
         canvas, headquarters, no loading ground, nothing focused. How long
         would it stay that way? Twenty presses over twenty seconds, all
         ignored — so not a startup window. And was the key even being
         delivered? A `keydown` dispatched from inside the page did nothing
         either: the listener was not late, it was ABSENT.

         `/` is attached by the effect that builds the frame loop, and that
         effect re-runs on a signature of the archive. The signature said the
         same thing about "the archive has not answered" and "the archive
         answered, and it is empty" — both `""` — which are exactly the two
         states a brand-new account passes through, in that order. If the
         profiles call landed first, the effect ran early against a null
         archive, bailed, and never saw a reason to run again. The world stood
         there looking finished and could not be touched: no `/`, no arrows,
         no Escape, no drag. `packages/web/src/space/pour-signature.ts` holds
         the fix and the whole story; `pour-signature.test.ts` fails if anyone
         collapses those two states again.

         THE PRESS STAYS A LOOP, AND IT IS NOT A RETRY-UNTIL-GREEN. A person
         who presses a key at a world that did not answer presses it again;
         this does the same and PRINTS HOW LONG the world took to answer. A
         window that reopens shows up in the log as a growing number instead
         of coming back as a flake for someone else to chase. */
      const FIND = 'input[placeholder="Which words do you remember?"]';
      const askedAt = Date.now();
      let answeredMs: number | null = null;
      for (let i = 0; i < 20 && answeredMs === null; i += 1) {
        await page.keyboard.press("/");
        const line = await page.waitForSelector(FIND, { timeout: 1_000 }).catch(() => null);
        if (line) answeredMs = Date.now() - askedAt;
      }
      if (answeredMs === null) {
        const at = await page.evaluate(() =>
          document.activeElement ? document.activeElement.tagName.toLowerCase() : "(none)",
        );
        return {
          ok: false,
          detail: `pressing "/" opened no find line in 20s — focus was on ${at}`,
        };
      }
      await page.fill('input[placeholder="Which words do you remember?"]', needle);
      await page.waitForTimeout(3_500);
      const verdict = (await page.evaluate(
        () => document.querySelector(".jar-seek")?.textContent ?? "",
      )) as string;
      const found = !/nothing here says that/i.test(verdict);
      return {
        ok: found,
        detail: `found=${found} needle=${needle}; the world answered "/" after ${answeredMs}ms`,
      };
    },
  },

  {
    id: "reflect",
    name: "a reflection answered on a memory is still there when you come back",
    breaks: (ctx) => breakRoute(ctx, (p, m) => /reflection/.test(p) && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);
      const phrase = `a bus map that admits which routes are slow ${uniq()}`;

      /* ONE VERB, NOT A JOURNEY ACROSS TWO SCREENS. The flat walk kept on
         `/capture`, went to `/inspirations`, found the row, and filled two
         fields — a question the person wrote for themselves and then their
         answer to it. In the world `reflect` in the mouth keeps the memory AND
         opens the question over it in one press, with the question already
         written. So the harness no longer has to know the shape of a
         two-field form; it answers the question the world asked. */
      await saveAnInspiration(page, phrase);
      await page.waitForTimeout(5_000);

      const box = await page.$(".jar-reflect-room .jar-reflect-box");
      if (!box) return { ok: false, detail: "the reflection never opened over the keep" };
      const answer = `because the admission is the useful part ${uniq()}`;
      await box.fill(answer);
      await page.locator(".jar-reflect-room button", { hasText: /^keep$/ }).first().click();
      await page.waitForTimeout(4_000);

      /* Reload rather than trust the optimistic render, and ask the archive
         rather than the canvas — the world draws a reflection as light on an
         orb, and light is not a string. */
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
      const survived = (await page.evaluate(async (needle: string) => {
        const list = await fetch("/api/inspirations?limit=50", { credentials: "include" });
        const body = (await list.json()) as { inspirations?: Array<{ id: string }> };
        for (const row of body.inspirations ?? []) {
          const one = await fetch(`/api/inspirations/${row.id}`, { credentials: "include" });
          const got = (await one.json()) as {
            inspiration?: { reflections?: Array<{ answer: string | null }> };
          };
          if ((got.inspiration?.reflections ?? []).some((r) => (r.answer ?? "").includes(needle))) {
            return true;
          }
        }
        return false;
      }, answer)) as boolean;
      return { ok: survived, detail: `survivedReload=${survived}` };
    },
  },

  {
    id: "let-go",
    name: "a memory taken down is actually gone",
    breaks: (ctx) => breakRoute(ctx, (p, m) => /\/api\/inspirations\//.test(p) && m === "DELETE"),
    run: async (page, base) => {
      await signUp(page, base);
      const phrase = `a lift button that dims once it has heard you ${uniq()}`;
      /* Several, because a memory is opened here by finding its ORB and one
         orb on a whole field is a needle. The phrase above is the one that
         matters; the rest are targets. */
      await keepInWorld(page, base, phrase);
      for (let i = 0; i < 4; i += 1) await keepInWorld(page, base, `alongside it ${i} ${uniq()}`);
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);

      if (!(await openAMemory(page))) {
        return { ok: false, detail: "no memory would open in the field" };
      }
      /* WHICH memory opened is whichever orb the sweep hit, so the claim is
         about the ONE ON SCREEN rather than about `phrase`. That is not a
         weaker claim — "a memory taken down is actually gone" is true of any
         of them, and insisting on a particular one would only be insisting the
         harness can aim. */
      const doomed = (await page.evaluate(
        () => document.querySelector(".jar-panel-text")?.textContent?.trim() ?? "",
      )) as string;
      if (!doomed) return { ok: false, detail: "the card opened with no words in it" };

      const del = page.locator(".jar-panel button", { hasText: /^delete$/ });
      await del.first().click();
      await page.waitForTimeout(2_000);
      /* THE ASK, AND ITS WORDS ARE NOT A GUESS. Deleting asks only when a
         signal stands on the memory — a warning with nothing to warn about is
         friction wearing a safety costume — and by the time these five keeps
         have been distilled, one usually does. The confirm reads
         `delete it anyway`, beside `keep it`, which is lit: this is a door
         that would rather not be walked through.
         
         An earlier version of this looked for "yes, take it down", found
         nothing, pressed nothing, and reported the product as failing to
         delete. The network log said it plainly — no DELETE was ever sent. */
      /* the ask lives on the card's own foot now, not a floating sheet
         (founder, 2026-08-27: no card over a card) */
      const anyway = page.locator(".jar-panel-askrow button", { hasText: /delete it anyway/i });
      if (await anyway.count()) {
        await anyway.first().click();
      }
      await page.waitForTimeout(4_500);

      const gone = !(await archiveHolds(page, doomed.slice(0, 40)));
      return { ok: gone, detail: `goneFromArchive=${gone} (${doomed.slice(0, 44)}…)` };
    },
  },

  {
    id: "account",
    name: "a new display name survives a reload",
    breaks: (ctx) => breakRoute(ctx, (p, m) => /\/api\/(profiles|auth\/me)/.test(p) && m === "PATCH"),
    run: async (page, base) => {
      await signUp(page, base);
      const renamed = `Renamed ${uniq()}`;
      await goSurface(page, base, "/profile");
      const field = await page.$('input[name=name], input[autocomplete=name]');
      if (!field) return { ok: false, detail: "no display-name field on /profile" };
      await field.fill(renamed);
      await page.click('button:has-text("save profile")');
      await page.waitForTimeout(3_500);

      await goSurface(page, base, "/profile");
      const value = await page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>(
          'input[name=name], input[autocomplete=name]',
        );
        return el?.value ?? "";
      });
      return { ok: value === renamed, detail: `readBack=${JSON.stringify(value)}` };
    },
  },

  {
    id: "keeper-key",
    name: "a keeper key is minted once, shown once, and revocable",
    breaks: (ctx) => breakRoute(ctx, (p, m) => p === "/api/keeper-keys" && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);
      await goSurface(page, base, "/profile");
      await page.click('button[role=tab]:has-text("Memories & connections")');
      await page.waitForTimeout(600);

      await page.fill('input[placeholder="what machine is this for"]', "journey laptop");
      await page.click('button:has-text("mint a key")');
      await page.waitForTimeout(2_500);

      // The secret's one appearance: a waka_keeper_ credential on screen,
      // beside the words that say it will never be shown again.
      const secret = await page.evaluate(
        () => document.querySelector(".profile-secret")?.textContent ?? "",
      );
      if (!secret.startsWith("waka_keeper_")) {
        return { ok: false, detail: `no minted secret on screen (${JSON.stringify(secret.slice(0, 24))})` };
      }
      await page.click('button:has-text("I have it")');
      await page.waitForTimeout(600);
      const secretGone =
        (await page.evaluate(() => document.querySelectorAll(".profile-secret").length)) === 0;
      const rowShows = await page
        .locator(".profile-row-title", { hasText: "journey laptop" })
        .isVisible();

      // Revocation asks its question through window.confirm; answer yes.
      page.once("dialog", (dialog) => void dialog.accept());
      await page.click('li:has-text("journey laptop") button:has-text("revoke")');
      await page.waitForTimeout(2_500);
      const rowGone =
        (await page.locator(".profile-row-title", { hasText: "journey laptop" }).count()) === 0;

      return {
        ok: secretGone && rowShows && rowGone,
        detail: `secret=${secret.slice(0, 16)}… shownOnce=${secretGone} listed=${rowShows} revoked=${rowGone}`,
      };
    },
  },

  {
    id: "agent-grants",
    name: "the sibling door opens by the owner's hand, and closes by it",
    breaks: (ctx) => breakRoute(ctx, (p, m) => p === "/api/agent-grants" && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);
      await goSurface(page, base, "/profile");
      await page.click('button[role=tab]:has-text("Memories & connections")');
      await page.waitForTimeout(600);
      // The audit surfaces are folded by default; the journey opens the door.
      await page.click('.profile-disclose button:has-text("grants")');
      await page.waitForTimeout(400);

      // Two agents, made through the same screen that will pair them. Each
      // creation now hands over the machine key — the box must show a real
      // agent secret, and pressing "I have it" returns the create row.
      for (const name of ["Scout", "Courier"]) {
        await page.fill('input[placeholder="Add an agent memory"]', name);
        await page.click('button:has-text("Add memory")');
        await page.waitForTimeout(1_500);
        const secret = await page.evaluate(
          () => document.querySelector(".profile-minted .profile-secret")?.textContent ?? "",
        );
        if (!secret.startsWith("waka_agent_")) {
          return { ok: false, detail: `no machine key handed over for ${name}` };
        }
        await page.click('.profile-minted button:has-text("I have it")');
        await page.waitForTimeout(400);
      }

      const pick = async (label: string, name: string) =>
        page.selectOption(`select[aria-label="${label}"]`, { label: name });
      await pick("which agent", "Scout");
      await pick("may read which", "Courier");
      await page.click('button:has-text("grant")');
      await page.waitForTimeout(2_000);

      const rowShows = await page
        .locator(".profile-row-title", { hasText: "Scout reads Courier" })
        .isVisible();
      if (!rowShows) return { ok: false, detail: "the grant row never appeared" };

      await page.click('li:has-text("Scout reads Courier") button:has-text("revoke")');
      await page.waitForTimeout(2_000);
      const rowGone =
        (await page.locator(".profile-row-title", { hasText: "Scout reads Courier" }).count()) ===
        0;

      return { ok: rowGone, detail: `granted=true revoked=${rowGone}` };
    },
  },

  {
    id: "agent-ground",
    name: "an agent's ground holds its own keeps, on camera",
    breaks: (ctx) =>
      breakRoute(ctx, (p, m) => p === "/api/inspirations" && m === "GET"),
    run: async (page, base) => {
      /* The 2026-08-30 family in one walk: the count, the reach, and the
         PIXELS must agree. The count said six while the ground stood one
         screen to the right of its camera for as long as the walls have
         existed — data-level assertions all passed; only light would have
         caught it. */
      await signUp(page, base);
      await goSurface(page, base, "/profile");
      await page.click('button[role=tab]:has-text("Memories & connections")');
      await page.fill('input[placeholder="Add an agent memory"]', "GroundScout");
      await page.click('button:has-text("Add memory")');
      await page.waitForTimeout(1_500);
      const key = await page.evaluate(
        () => document.querySelector(".profile-minted .profile-secret")?.textContent ?? "",
      );
      if (!key.startsWith("waka_agent_")) {
        return { ok: false, detail: "creation handed over no machine key" };
      }
      await page.click('.profile-minted button:has-text("I have it")');

      const texts = [
        "Ground keep one, by the machine.",
        "Ground keep two, by the machine.",
        "Ground keep three, by the machine.",
      ];
      for (const text of texts) {
        const res = await fetch(`${base}/api/inspirations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.status !== 201) return { ok: false, detail: `keep via key → ${res.status}` };
      }

      await goSurface(page, base, "/");
      await page.waitForTimeout(6_000);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(9_000);

      const foot = await page.evaluate(
        () => document.querySelector(".jar-saved-count")?.textContent ?? "",
      );
      if (!foot.startsWith("3")) return { ok: false, detail: `foot says ${JSON.stringify(foot)}` };

      await page.click(".jar-saved");
      await page.waitForTimeout(6_000);

      const reach = await page.evaluate(() =>
        [...document.querySelectorAll(".jar-reach [role=option]")].map(
          (o) => o.textContent ?? "",
        ),
      );
      const allListed = texts.every((t) => reach.some((r) => r.includes(t.slice(0, 20))));
      if (!allListed) return { ok: false, detail: `reach holds ${reach.length}, not the three` };

      /* and the light: the ground's canvas must actually paint them. A wall
         whose data is perfect and whose camera looks elsewhere fails HERE. */
      const lit = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return -1;
        const g = c.getContext("2d");
        if (!g) return -1;
        const img = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < img.length; i += 40) {
          if (img[i]! + img[i + 1]! + img[i + 2]! > 150) n++;
        }
        return n;
      });
      return {
        ok: lit > 200,
        detail: `foot=3 reach=${reach.length} litSamples=${lit}`,
      };
    },
  },

  {
    id: "a11y-floor",
    name: "every control in the world can be named out loud",
    /* THE FIRST SABOTAGE HERE DID NOT WORK, AND THE GATE SAID SO.
       It stripped `aria-label`, `title` and text from every control on an
       interval. React re-rendered them faster than the strip ran, the
       assertion measured a fully-named page, and the journey PASSED under
       `--negative` — which is the definition of decoration. It was reported,
       not quietly retried.
       What replaced it is not a weaker sabotage but a truer one. The
       regression this journey exists to catch is nobody stripping labels
       wholesale; it is one control shipped without a name. So that is what
       is injected — a visible, unnamed button — and the assertion has to
       find it. A check that cannot see one unnamed control is not protecting
       anything, whatever it does against a hostile stripper. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          setTimeout(() => {
            const orphan = document.createElement("button");
            orphan.type = "button";
            orphan.setAttribute("data-sabotage", "unnamed-control");
            orphan.style.cssText = "position:fixed;left:8px;bottom:8px;width:40px;height:40px";
            document.body.appendChild(orphan);
          }, 3_000);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);
      /* VISIBILITY IS MEASURED FROM THE BOX, NOT FROM `offsetParent`.
         It used to use `offsetParent === null`, which is null for every
         `position: fixed` element — so a fixed, unnamed control was invisible
         to the check that exists to find unnamed controls. The `--negative`
         run is what surfaced that: the injected orphan button was fixed, the
         journey kept passing, and the hole was in the assertion rather than
         in the sabotage. Rect plus computed style sees what a person sees. */
      const unnamed = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button,a,input,select,textarea"))
          .filter((el) => {
            const e = el as HTMLElement;
            const rect = e.getBoundingClientRect();
            const style = getComputedStyle(e);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none";
            if (!visible) return false;
            const name =
              e.getAttribute("aria-label") ||
              e.getAttribute("title") ||
              (e.innerText || "").trim() ||
              (e as HTMLInputElement).placeholder ||
              "";
            return name.length === 0;
          })
          .map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className || "?"}`),
      );
      return {
        ok: unnamed.length === 0,
        detail:
          unnamed.length === 0
            ? "every visible control has a name"
            : `${unnamed.length} unnamed: ${unnamed.slice(0, 5).join(", ")}`,
      };
    },
  },

  {
    id: "ways-out",
    name: "standing in the world, you can see that it goes somewhere",
    /* WHAT THIS EXISTS FOR. A person told us they had no idea they could go
       left, right, up or down. Three separate things were true at once and
       every one of them was invisible rather than wrong:

         - `.jar-hq` carries `pointer-events: none`, and an element that takes
           no pointer can never match `:hover`, so `.jar-hq:hover .jar-edge`
           had never once fired. Every way out of a wall sat at opacity 0 on
           every desktop there has ever been.
         - Two conflicting `.jar-edge` blocks in one stylesheet meant the two
           signposts sharing each margin printed straight through each other.
         - The sky had no peek at all, so the top edge was plain black while
           the ground below announced itself.

       None of these threw, none broke a count, and the whole suite stayed
       green through all of it. That is the shape of failure this journey is
       shaped against: a promise that is kept by BEING SEEN, and whose absence
       looks exactly like a quiet screen.

       THE SABOTAGE IS THE ORIGINAL BUG. Not a stripper, not an injected
       element — the literal rule that was there, put back. If this journey
       can survive `.jar-edge { opacity: 0 }` it would have shipped the thing
       it was written for. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "ways-out-hidden");
          style.textContent =
            ".jar-edge, .jar-way, .jar-here-more, .jar-values, .jar-up { opacity: 0 !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);
      const seen = await page.evaluate(() => {
        /* EVERY WAY THIS LAYOUT ACTUALLY HAS, not only the two in the margins.
           A person's FIRST account has exactly one wall, so there is no
           neighbour to point at and `.jar-way` renders nothing at all — this
           journey was asserting a promise that cannot hold on the very run it
           is most often executed on, and reporting "no way out is on screen"
           about a world that has three.

           Sideways is one of five: the caret beside the name in the top-left
           corner opens every wall AND the offer to make another (it replaced
           a strip of wall names along the bottom edge on 2026-08-24), and the
           way up is `.jar-values` standing at headquarters or `.jar-up`
           standing down in the ground — never both at once, because one of
           the two is always the wrong direction.

           BOTH OF THOSE HAVE TO BE NAMED, and for a while neither was. The
           selector said `.jar-overhead`, which was the way up until it was
           rebuilt and renamed; then it said `.jar-up`, which is real but only
           renders in the field, and this journey stands at headquarters. A
           way-out check that names no element on the screen it runs on does
           not fail — it counts the margins, finds them empty on a first
           account, and reports that a world with two exits has none.

           The claim is unchanged — standing here, you can SEE that this goes
           somewhere — and the sabotage hides all of them, so hiding any one
           still fails it. */
        const marks = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".jar-edge, .jar-way, .jar-here-more, .jar-values, .jar-up",
          ),
        );
        const inView = marks
          .map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              text: (el.innerText || "").trim(),
              margin: el.classList.contains("jar-way") || el.classList.contains("jar-edge"),
              opacity: Number(cs.opacity),
              x: Math.round(r.left),
              y: Math.round(r.top),
              w: Math.round(r.width),
              h: Math.round(r.height),
              onScreen:
                r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight,
            };
          })
          /* the walls off to either side render their own signposts at their
             own columns; only the ones on this screen are a promise to anyone */
          .filter((m) => m.onScreen && m.w > 0 && m.h > 0);
        /* two signposts share each margin — travel at eye level, the offer to
           grow the axis below it — and they used to be printed on the same
           line. Overlap here is that bug coming back. */
        const overlaps: string[] = [];
        /* Only the MARGINS are checked for collision: the axis is a row of
           deliberately adjacent marks, and the bug this guards against was two
           signposts printed on one line at the same edge. */
        const margins = inView.filter((m) => m.margin);
        for (let i = 0; i < margins.length; i++) {
          for (let j = i + 1; j < margins.length; j++) {
            const a = margins[i];
            const b = margins[j];
            if (
              a.x < b.x + b.w &&
              b.x < a.x + a.w &&
              a.y < b.y + b.h &&
              b.y < a.y + a.h
            ) {
              overlaps.push(`${a.text} × ${b.text}`);
            }
          }
        }
        const audit = (
          window as unknown as {
            wakaField?: () => {
              sky?: { lean: number; nebs: Array<{ y: number; homeY: number; peekY: number; r: number }> };
            };
          }
        ).wakaField?.();
        const lean = audit?.sky?.lean ?? null;
        const nebs = audit?.sky?.nebs ?? null;
        const elected = nebs ? nebs.filter((n) => n.peekY !== n.homeY) : [];
        /* an elected statement has to have actually ARRIVED near the seam.
           The first build of the sky peek elected correctly and eased
           correctly and still showed nothing, because it parked the clouds in
           the part of their own sprite that has no light left in it. */
        const stranded = elected.filter((n) => Math.abs(n.y - n.peekY) > n.r * 0.5);
        return {
          inView,
          overlaps,
          skyKnown: nebs !== null,
          lean,
          electedCount: elected.length,
          strandedCount: stranded.length,
        };
      });

      const hidden = seen.inView.filter((m) => m.opacity < 0.5).map((m) => m.text || "(unnamed)");
      const problems: string[] = [];
      if (seen.inView.length === 0) problems.push("no way out is on screen at all");
      if (hidden.length > 0) problems.push(`invisible: ${hidden.join(", ")}`);
      if (seen.overlaps.length > 0) problems.push(`overlapping: ${seen.overlaps.join(", ")}`);
      if (seen.strandedCount > 0) {
        problems.push(`${seen.strandedCount} sky statement(s) elected to peek but never arrived`);
      }
      /* THE SCALAR IS CHECKED EVEN WHEN THERE IS NOTHING TO LEAN.
         A fresh account has no statements, so the count check above is
         vacuous on the exact run this journey is most likely to be executed
         on. `lean` is not: it is the camera's own reading, 1 standing at
         headquarters and 0 up in the sky, and it exists whether or not the
         sky has anything in it. Rip the peek out and this goes to `null`,
         which is the difference between "nothing to show yet" and "the
         mechanism is gone". */
      if (seen.skyKnown && (seen.lean === null || seen.lean < 0.99)) {
        problems.push(`the sky is not leaning at headquarters (lean=${seen.lean})`);
      }
      /* SAID OUT LOUD WHEN IT CHECKED NOTHING. A fresh account has no signals,
         so it has no sky to lean — and a journey that reports a clean pass
         over an empty check is the same lie as a silent truncation. */
      const skyNote = !seen.skyKnown
        ? "sky NOT CHECKED (no audit on this build)"
        : seen.electedCount === 0
          ? `sky leaning (${seen.lean}) but EMPTY — no statements on this account to elect`
          : `${seen.electedCount} sky statement(s) leaning in`;
      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `${seen.inView.length} ways out visible, none overlapping; ${skyNote}`
            : problems.join("; "),
      };
    },
  },

  {
    id: "doorway",
    name: "the door you came to open is the biggest thing on the door",
    /* TWO CLAIMS, BOTH ABOUT THE ONE SCREEN NOBODY CAN SKIP.

       RANK (finding 5). Measured on the old build, by area: a 548x48 white
       "CONTINUE WITH GOOGLE" pill, then the two tab labels, then the field
       labels — and last, at **40x16**, lowercase and underlined at the
       bottom-left, the submit for the form the person had just filled in.
       Every single thing that navigated AWAY outranked the thing that
       finished the job. It is now the largest control on the screen and it
       comes before the alternative rather than after it, without shouting:
       the page keeps one uppercase register and it belongs to eyebrows.

       NOUNS (finding 10). The eyebrow said "WAKA · Signals" over a subtitle
       saying "…return to your inspirations" — two canon LAYER names used as
       branding, on the first screen anyone sees, for one product.

       THE SABOTAGE BREAKS RANK, which is the Major one. The noun count rides
       along and is reported either way, so a regression there is visible even
       on a passing run. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "submit-as-footnote");
          /* the exact treatment it used to have: a lowercase word, not a
             control — 40x16, no ground, hard left */
          style.textContent =
            "body .login-card .btn-doorway { width: auto !important; min-height: 0 !important;" +
            " padding: 0 !important; background: none !important; align-self: flex-start !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      /* THE CANON LAYER NAMES, WHICH ARE NOT BRANDING. `docs/data-model.md`
         names the three layers; a person arriving at a door does not need to
         be taught any of them, and being shown two at once for one product is
         what finding 10 is. Matched whole-word so "signal" does not fire on
         "signalling" and "principle" does not fire inside a longer word. */
      const CANON = ["inspiration", "signal", "top of mind", "principle"];
      const problems: string[] = [];
      const seen: string[] = [];

      for (const mode of ["login", "signup"] as const) {
        await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1_500);
        if (mode === "signup") {
          await page.click("#login-tab-signup");
          await page.waitForTimeout(800);
        }

        const shot = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>(".login-card");
          const controls = Array.from(
            document.querySelectorAll<HTMLElement>("button, a[href]"),
          )
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .map((el, order) => {
              const r = el.getBoundingClientRect();
              return {
                text: (el.innerText || "").trim().slice(0, 30),
                area: Math.round(r.width * r.height),
                isSubmit: el.classList.contains("btn-doorway"),
                isGoogle: el.classList.contains("btn-google"),
                order,
              };
            });
          return { text: (card?.innerText || "").toLowerCase(), controls };
        });

        const submit = shot.controls.find((c) => c.isSubmit);
        const google = shot.controls.find((c) => c.isGoogle);
        if (!submit) {
          problems.push(`${mode}: no submit on the form`);
        } else {
          const bigger = shot.controls.filter((c) => c.area > submit.area);
          if (bigger.length > 0) {
            problems.push(
              `${mode}: submit (${submit.area}px²) outranked by ${bigger
                .map((c) => `${c.text || "?"} (${c.area}px²)`)
                .join(", ")}`,
            );
          }
          /* AND IT COMES FIRST. Equal weight in the wrong order is still the
             alternative asking before the thing it is an alternative to. */
          if (google && google.order < submit.order) {
            problems.push(`${mode}: the alternative is asked before the form`);
          }
        }

        const nouns = CANON.filter((n) =>
          new RegExp(`\\b${n}s?\\b`).test(shot.text),
        );
        seen.push(`${mode}: ${nouns.length === 0 ? "none" : nouns.join("+")}`);
        if (nouns.length > 1) {
          problems.push(`${mode}: ${nouns.length} product nouns for one thing — ${nouns.join(", ")}`);
        }
      }

      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `submit is the largest control and asked first; canon nouns — ${seen.join("; ")}`
            : problems.join("; "),
      };
    },
  },

  {
    id: "the-hand",
    name: "every sentence the world paints can actually be read",
    /* WHAT THIS WALKED BEFORE, AND WHERE THE REST OF IT WENT.
     *
     * Until the flat surface was deleted this journey swept `/capture`,
     * `/inspirations`, `/signals`, `/principles`, `/top-of-mind` and `/rooms`
     * at 390px and asserted three rules over `.sf-*` and `.pr-*`: a size
     * floor, a crowding floor, and contrast. Every one of those routes now
     * redirects to `/` and every one of those classes went out with
     * `surface.css`, so the walk measured the world six times over, counted
     * zero marks, and reported the world's own chrome as a phone failure.
     *
     * SIZE moved to `e2e:phone`, which asks it properly: a real mobile
     * context with `hasTouch`, two viewports, WCAG 2.2's 24px floor and 44 for
     * the acts. Keeping a second copy here would leave two gates with one
     * opinion between them, and the next person to edit one would not know
     * they had just made the other one lie.
     *
     * CROWDING moved there too, and the reason is worth writing down because
     * it was NOT obvious. This journey cannot emulate touch — `hasTouch` is
     * fixed when a context is made and the harness makes one 1440x900 context
     * for every journey — so it resized the page instead and called that a
     * phone. But half the sizes in this product come from
     * `@media (pointer: coarse)`, which a resized fine-pointer page never
     * matches. Rehomed onto the world, the walk duly reported the mouth's
     * verbs at 48x11 and 34x11, crowded against the field, and it was WRONG:
     * measured in a real touch context those same verbs are 45px tall and
     * nothing is crowded. A gate that reports defects a phone does not have
     * costs more than it saves. It is asked in `e2e:phone` now, where the
     * pointer is real — and asking it there immediately found the defect this
     * one could not: the card was never opened by any phone gate at all, and
     * `reflect`, `delete` and the two stepping carets were all under the
     * floor, the carets 32px apart.
     *
     * CONTRAST STAYS, and it is what this journey is now for. It is the one
     * claim here that does not depend on the pointer at all — a colour is the
     * same colour under a thumb — and nothing else in the repo can make it.
     * `contrast.test.ts` reads `home.css` as text and owns the RULING: ink
     * and muted clear AA, faint is de-emphasis, and nothing a person must
     * read may be set in it. What it cannot see is what is actually PAINTED.
     * Two things decide that, and both are invisible to a source gate:
     *
     *   THE CASCADE ACROSS SHEETS. The original finding here was `chrome.css`
     *   carrying a bare `h1, h2 { color: var(--w-ink) }` — an element
     *   selector in another file beating a class colour in this one, so the
     *   largest words on the page came out in the wrong sheet's near-white.
     *
     *   OPACITY ON AN ANCESTOR, which multiplies down a chain no grep can
     *   follow and which no stylesheet states anywhere as a colour.
     *
     * So this composites both: every ancestor's opacity into the text's
     * alpha, every ancestor's background into one opaque colour, and then
     * asks WCAG about the two numbers that actually reached the eye.
     *
     * It still walks at 390x844, because the narrow viewport is where the
     * world reflows and re-layers — a panel over a lit ground composites
     * differently from a panel over an empty one. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "sunk-ink");
          /* the shape of the original finding: a sentence set in a colour
             the ground it is painted on swallows */
          style.textContent =
            ".jar-saved-count, .jar-panel-text { color: #23272e !important; opacity: 1 !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);

      /* IT HAS TO HAVE SOMETHING TO READ. An empty account is the world's
         chrome and nothing else: no count, no keepsake, no card. The first
         version of this journey walked six empty screens and reported them
         clean, and its `--negative` run SURVIVED its own sabotage because
         there was not one sentence on the page for the sabotage to sink.
         That is why the coverage counter below exists and why it is fatal. */
      for (const text of [
        `the funicular counts down in stops not minutes ${uniq()}`,
        `every good hallway smells faintly of someone else's dinner ${uniq()}`,
        `I trust a menu more when it is printed badly ${uniq()}`,
      ]) {
        await keepInWorld(page, base, text);
      }

      await page.setViewportSize({ width: 390, height: 844 });

      /* AND THE WORLD IS LOADED AGAIN AT THAT SIZE RATHER THAN CARRIED OVER.
         The LAYOUT reflows correctly — measured either way, the mouth lands
         at y=513 of 844 — but the CAMERA does not reset, and a camera parked
         one column across at 1440px is a whole viewport away at 390px. The
         first run of this walk failed with "element is outside of the
         viewport" on the mouth and read for a moment like a reflow bug in
         the product. It was the harness's own leftovers. */
      const goHome = async (): Promise<void> => {
        await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(6_000);
      };
      /* the same sweep `openAMemory` does, in pixels that exist at 390px */
      const PHONE_SWEEP = {
        xs: Array.from({ length: 12 }, (_, i) => 40 + i * 26),
        ys: [420, 380, 460, 340, 500, 300, 540, 260, 580],
      };

      /* WCAG 1.4.3: 4.5:1 for body text, 3:1 once the type is large. */
      const AA_TEXT = 4.5;
      const AA_LARGE = 3;
      const problems: string[] = [];
      const notes: string[] = [];
      let dimmed = 0;
      let faint = 0;

      /* The places words appear. If none of them had any, the walk proved
         nothing and has to say so — per family, not as one total, because a
         single number stays comfortably above zero on the chrome alone while
         the card it was supposed to read never opened. */
      const FAMILIES = ["world", "mouth", "card"] as const;
      const words: Record<(typeof FAMILIES)[number], number> = { world: 0, mouth: 0, card: 0 };

      const SURFACES: Array<{ name: string; family: (typeof FAMILIES)[number]; open: () => Promise<void> }> = [
        { name: "the world", family: "world", open: goHome },
        {
          name: "the mouth open",
          family: "mouth",
          open: async () => {
            await goHome();
            await openTheNotepad(page);
            await page.waitForTimeout(900);
          },
        },
        {
          name: "a memory open",
          family: "card",
          open: async () => {
            await goHome();
            await openAMemory(page, PHONE_SWEEP);
            await page.waitForTimeout(900);
          },
        },
      ];

      for (const surface of SURFACES) {
        await surface.open();
        const found = await page.evaluate(() => {
          /* NO NAMED FUNCTION MAY BE DECLARED IN HERE. esbuild's keep-names
             shim wraps every named declaration in a `__name(...)` call that
             does not exist in the page, and the whole probe dies with
             `__name is not defined`. Loops and inline anonymous arrows only. */
          const faintRaw = getComputedStyle(document.documentElement)
            .getPropertyValue("--jar-faint")
            .trim();
          /* the token resolved the way the browser resolves it, so a retune
             re-measures instead of drifting away from a copied string */
          const probe = document.createElement("span");
          probe.style.color = faintRaw || "transparent";
          document.body.appendChild(probe);
          const faintPainted = getComputedStyle(probe).color;
          probe.remove();

          const sentences: Array<{
            text: string;
            fg: string;
            bg: string;
            size: number;
            large: boolean;
            isFaint: boolean;
            alpha: number;
          }> = [];
          const cardOpen = document.querySelectorAll(".jar-panel").length > 0;
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
            /* only elements carrying their OWN words — a wrapper inherits its
               child's problem and would report the same sentence twice */
            let own = "";
            for (const node of Array.from(el.childNodes)) {
              if (node.nodeType === 3) own += node.textContent ?? "";
            }
            own = own.trim();
            if (own.length < 2) continue;
            if (el.closest("[aria-hidden=true]")) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.bottom < 0 || r.top > window.innerHeight) continue;
            if (r.right < 0 || r.left > window.innerWidth) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;

            /* EVERY ANCESTOR'S OPACITY, MULTIPLIED DOWN, and every ancestor's
               background collected on the way up. This is the whole reason a
               source gate cannot answer this question. */
            let through = 1;
            let walk: HTMLElement | null = el;
            const layers: number[][] = [];
            while (walk) {
              const wcs = getComputedStyle(walk);
              through *= Number(wcs.opacity === "" ? 1 : wcs.opacity);
              const parts = (wcs.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
              if (parts.length >= 3) {
                const a = parts.length > 3 ? parts[3]! : 1;
                if (a > 0) layers.push([parts[0]!, parts[1]!, parts[2]!, a * through]);
              }
              walk = walk.parentElement;
            }
            /* the world is painted on black, so anything still translucent
               after every layer is composited resolves against it */
            let br = 0;
            let bg2 = 0;
            let bb = 0;
            for (let i = layers.length - 1; i >= 0; i -= 1) {
              const [lr, lg, lb, la] = layers[i]!;
              br = lr! * la! + br * (1 - la!);
              bg2 = lg! * la! + bg2 * (1 - la!);
              bb = lb! * la! + bb * (1 - la!);
            }

            const fgParts = (cs.color.match(/[\d.]+/g) ?? []).map(Number);
            const fa = (fgParts.length > 3 ? fgParts[3]! : 1) * through;
            const fr = fgParts[0]! * fa + br * (1 - fa);
            const fg = fgParts[1]! * fa + bg2 * (1 - fa);
            const fb = fgParts[2]! * fa + bb * (1 - fa);

            const size = parseFloat(cs.fontSize);
            const weight = Number(cs.fontWeight) || 400;
            sentences.push({
              text: own.replace(/\s+/g, " ").slice(0, 20),
              fg: `rgb(${Math.round(fr)}, ${Math.round(fg)}, ${Math.round(fb)})`,
              bg: `rgb(${Math.round(br)}, ${Math.round(bg2)}, ${Math.round(bb)})`,
              size,
              /* WCAG's own definition of large text, in CSS pixels */
              large: size >= 24 || (size >= 18.66 && weight >= 700),
              isFaint: cs.color === faintPainted,
              alpha: fa,
            });
          }
          return { sentences, cardOpen };
        });

        const unreadable: string[] = [];
        for (const sen of found.sentences) {
          /* DE-EMPHASIS IS NOT A DEFECT, AND IS NOT SILENT EITHER. Faint is
             ruled on by `contrast.test.ts`, which holds the line that nothing
             a person MUST read is set in it; and a sentence still fading in,
             or deliberately dimmed behind what is open over it, is not being
             asked to be read yet. Both are counted and printed rather than
             dropped, so the exemption is auditable from the pass line. */
          if (sen.isFaint) {
            faint += 1;
            continue;
          }
          if (sen.alpha < 0.5) {
            dimmed += 1;
            continue;
          }
          const ratio = contrast(sen.fg, sen.bg);
          const floor = sen.large ? AA_LARGE : AA_TEXT;
          if (ratio < floor) {
            unreadable.push(
              `"${sen.text}" ${ratio.toFixed(2)}:1 at ${Math.round(sen.size)}px (needs ${floor})`,
            );
          }
        }
        if (unreadable.length > 0) {
          problems.push(`${surface.name}: unreadable — ${unreadable.slice(0, 3).join("; ")}`);
        }

        /* the card only counts as read if it actually opened */
        if (surface.family !== "card" || found.cardOpen) {
          words[surface.family] += found.sentences.length;
        }
        notes.push(`${surface.name}:${found.sentences.length}`);
      }

      /* A CLEAN WALK OVER NOTHING IS NOT A CLEAN WALK. */
      const missing = FAMILIES.filter((family) => words[family] === 0);
      if (missing.length === FAMILIES.length) {
        problems.push("not one sentence anywhere — this walk read nothing and proved nothing");
      }
      const gap = missing.length > 0 ? ` — NOT READ: ${missing.join(", ")}` : "";
      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `every painted sentence clears AA (${faint} faint and ${dimmed} dimmed exempt, ruled on by contrast.test.ts) over ${notes.join(" ")}${gap}`
            : problems.slice(0, 4).join(" | "),
      };
    },
  },

  {
    id: "entry-actions",
    name: "you can answer back to what the machine decided about you",
    /* WHAT THIS IS FOR. `every-workflow-works.md` carried E2 — "Entry actions
       — read again, say in my words, not this, undo" — as proven by
       **nothing**. Writing this found out why it needed proving.

       All four sat at `opacity: 0` with `pointer-events: none`, revealed by
       `.jar-hq:hover .jar-board-acts`. `.jar-hq` carries
       `pointer-events: none` so the world underneath stays draggable, and an
       element that takes no pointer CANNOT MATCH `:hover`. So on every
       desktop the four things a person can do about the one sentence the
       machine has concluded about them were in the DOM and unreachable. Only
       the `@media (hover: none)` fallback made them work, which is why they
       worked on a phone.

       That is finding 14 exactly, in a second place. Fixing finding 14 patched
       `.jar-edge` and never swept the file for the other rule that shared the
       selector — one grep would have found it.

       SO THIS ASSERTS HIT-TESTING, NOT STYLE. `elementFromPoint` at each
       control's own centre has to come back as that control. That catches
       `opacity: 0`, an inherited `pointer-events: none`, and anything lying
       on top of it — including whatever the next version of this mistake
       turns out to be, which will not be named `.jar-edge` either. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "acts-unreachable");
          /* THE SABOTAGE THE FIX OUTLIVED. It reproduced the defect exactly as
             it shipped — `opacity: 0; pointer-events: none` on the CONTAINER —
             and the fix for that defect was a rule giving every control inside
             headquarters `pointer-events: auto` back. A child re-enabling the
             pointer beats a parent refusing it, and opacity was never a
             hit-test property at all, so from the day the product was fixed
             this sabotage could not reach the thing it aims at: the buttons
             stayed hit-testable, the journey passed, and it has been
             decoration ever since. CI told us on its first ever run
             (2026-08-27) — "survived sabotage; this journey is decoration".

             What a sabotage must break is the CLAIM, not a historical
             stylesheet: the claim is that the four verbs can be pressed, so
             it takes the pointer away from the verbs themselves. */
          style.textContent =
            ".jar-board-act { pointer-events: none !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);

      /* A board needs something to read. Four unrelated thoughts is what
         `e2e:cold-start` proves is enough — a top of mind is built from
         FORMING signals, so this does not have to wait out the promotion bar
         at three evidence each. */
      const SITTING = [
        "I want to spend a month somewhere I do not speak the language.",
        "The best conversations I have are the ones where nobody is trying to be useful.",
        "I keep buying notebooks I never write in.",
        "I would rather be early and wrong than late and certain.",
      ];
      for (const text of SITTING) await keepInWorld(page, base, text);

      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

      /* CLOSE ANYTHING STANDING OVER THE BOARD BEFORE MEASURING, AND KNOW
         WHAT PUTS IT THERE.

         Seen once in a full sweep on 2026-08-25 and written up then as not
         reproducible alone: all three verbs reported unreachable with "the
         press lands on div.jar-panel.jar-panel--in" — a reading card,
         centred, lying over them. The guess at the time was a card left open
         by an earlier journey, since the account is reused; an Escape here
         was the fix and it passed for two days.

         CI FOUND THE REAL ONE on 2026-08-27, reporting the same failure with
         `p.jar-ask--after.jar-panel-foot` — a card's FOOT — over two of the
         verbs. Nothing left it open. THE WORLD OPENS IT ITSELF: the arrival
         greeting glides to the newest memory 1.4s after the world is ready
         and lets it go 2.6s after that, so for four seconds of every arrival
         with something new in it a card is legitimately centred over the
         board. This journey saves four memories and then arrives, which
         means it walks into that window every single time. It passed locally
         only because a fast machine finishes the greeting before the poster
         band has finished opening; a slower one does not, and the two orders
         are equally correct.

         So the Escape at the start was aimed at the wrong suspect. What this
         case claims is that the four verbs can be pressed on a board with
         nothing over it, and the greeting is a thing over it — a real one,
         by design, that a person waits out. The walk waits it out too, and
         the waiting lives in `arrival.ts` rather than here: `phone` raced the
         same four seconds and read it as "no memory could be opened", so it
         is a fact about arriving at this world and not a fact about this
         journey. A timing none of them control is now one they wait for
         rather than race. */
      const standing = await settleAfterArrival(page);
      if (standing) {
        return {
          ok: false,
          detail: `something stayed open over the board after Escape: .${standing}`,
        };
      }

      /* The board arrives out of band. Poll rather than sleep, and say so if
         it never comes — a walk with no board proves nothing about buttons
         that only exist beside one. */
      let appeared = false;
      for (let i = 0; i < 60; i += 1) {
        /* ASK THE POSTER FIRST. The four verbs sat permanently under the
           ambition until 2026-08-25, when the founder had them folded into
           the poster's own press: a resting page is a sentence, not a
           sentence with a toolbar bolted to it. They open where the grounds
           and the history already open, so this journey now does what a
           person does — press the words, then answer them. */
        /* Only when it is shut: the poster TOGGLES, so pressing it on every
           poll would open the band and close it again on the next pass. */
        await page
          .evaluate(() => {
            const poster = document.querySelector<HTMLElement>(
              'h1.jar-poster[data-jar-chrome="1"]',
            );
            if (poster && poster.getAttribute("aria-expanded") !== "true") poster.click();
          })
          .catch(() => {});
        appeared = await page.evaluate(
          () => document.querySelectorAll(".jar-board-act").length >= 3,
        );
        if (appeared) {
          /* LET IT COME TO REST BEFORE MEASURING. The band the poster opens
             arrives on a curve, and `elementFromPoint` during that arrival
             answers about a layout that is still moving — which reported
             three of the four verbs as unhittable at full opacity. What this
             journey asks is whether a person can hit them, and a person aims
             at a page that has stopped. */
          await page.waitForTimeout(1_200);
          break;
        }
        await page.waitForTimeout(2_000);
      }
      if (!appeared) {
        return {
          ok: false,
          detail: "no board arrived within 120s — there was nothing to answer back to",
        };
      }

      const reachable = await page.evaluate(() => {
        const acts = Array.from(document.querySelectorAll<HTMLElement>(".jar-board-act"));
        return acts.map((el) => {
          const r = el.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const hit = document.elementFromPoint(cx, cy);
          return {
            label: (el.innerText || "").trim(),
            /* a span, not a button, is the "Held up" state — present and
               deliberately not pressable, so it is reported, not required */
            pressable: el.tagName === "BUTTON",
            onScreen: r.width > 0 && r.height > 0,
            opacity: Number(getComputedStyle(el).opacity),
            /* the real question: if a person aimed here, would they hit it */
            hit: hit === el || (hit !== null && el.contains(hit)),
            /* AND WHAT THEY HIT INSTEAD. "cannot be hit at its own centre" is
               a symptom with no suspect: the fix is always something lying
               over it, and naming that thing is the difference between a
               report and a search. */
            hitBy:
              hit === null
                ? "(nothing)"
                : `${hit.tagName.toLowerCase()}.${(hit.className || "").toString().trim().split(/\s+/).join(".")}`,
          };
        });
      });

      const problems: string[] = [];
      if (reachable.length < 3) problems.push(`only ${reachable.length} entry actions rendered`);
      for (const act of reachable) {
        if (!act.onScreen) problems.push(`"${act.label}" has no box`);
        else if (!act.hit) {
          problems.push(
            `"${act.label}" cannot be hit at its own centre (opacity ${act.opacity}) — ` +
              `the press lands on ${act.hitBy}`,
          );
        }
      }

      /* AND ONE OF THEM IS ACTUALLY PRESSED. Reachable is not the same as
         wired: "Read it again" must open its confirmation, which is also the
         one action that previews its consequence before committing to it. */
      if (problems.length === 0) {
        const readAgain = reachable.find((a) => /read it again/i.test(a.label));
        if (!readAgain) problems.push("no 'read it again' among the entry actions");
        else {
          for (const el of await page.$$(".jar-board-act")) {
            if (/read it again/i.test((await el.innerText()).trim())) {
              await el.click();
              break;
            }
          }
          await page.waitForTimeout(900);
          const confirmed = await page.evaluate(() => ({
            warn: document.querySelector(".jar-board-warn")?.textContent?.trim() ?? "",
            acts: Array.from(document.querySelectorAll(".jar-board-act")).map((e) =>
              (e.textContent || "").trim(),
            ),
          }));
          if (confirmed.warn.length === 0) {
            problems.push("'read it again' did not say what would change before changing it");
          }
          /* Backed out rather than committed: a regeneration is a model call,
             and what this journey is about is whether the control reaches its
             own machinery at all. */
          for (const el of await page.$$(".jar-board-act")) {
            if (/leave it/i.test((await el.textContent()) ?? "")) {
              await el.click();
              break;
            }
          }
          await page.waitForTimeout(500);
        }
      }

      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `${reachable.length} entry actions, all hit-testable — ${reachable
                .map((a) => a.label.toLowerCase())
                .join(", ")}; "read it again" previews its consequence`
            : problems.slice(0, 4).join("; "),
      };
    },
  },

  {
    id: "public-page",
    name: "what you publish is only what you said to publish",
    /* J1's public-page half, which `journeys:account` never touched — it
       proved the display name and stopped there.
 
       THIS IS THE HIGHEST-STAKES PRIVACY SURFACE IN THE PRODUCT. The group
       boundary decides what a handful of invited people can see; this one
       decides what the open internet can. A raw capture reaching `/:handle`
       is not a bug that gets reported, it is one that gets discovered.
 
       So the leak check is the same shape `groups.ts` uses and for the same
       reason: capture a phrase that exists nowhere else on the stack, then
       search the whole published page for it. A field-by-field check only
       ever finds the leak you thought of.
 
       AND IT IS READ AS A STRANGER. Cookies are cleared before every look, so
       what is measured is what an anonymous visitor gets — not what the owner
       sees rendered through their own session. */
    breaks: (ctx) =>
      breakRoute(ctx, (p, m) => /\/api\/(profiles|auth\/me)/.test(p) && m === "PATCH"),
    run: async (page, base) => {
      const me = await signUp(page, base);
      const secret = `the porcelain kestrel ${uniq()}`;
      await keepInWorld(page, base, `I keep thinking about ${secret}.`);

      const handle = `e2e${Date.now().toString(36)}`;
      await goSurface(page, base, "/profile");
      const opener = await page.$('button:has-text("make a public page")');
      if (!opener) return { ok: false, detail: "no way to make a public page on /profile" };
      await opener.click();
      await page.waitForTimeout(600);

      const handleField = await page.$('input[name=publicHandle]');
      if (!handleField) return { ok: false, detail: "the public-page form has no handle field" };
      await handleField.fill(handle);
      /* the first toggle is the page itself; the second is the top of mind,
         and it is disabled until the first is on */
      const toggles = await page.$$('.profile-toggle-row input[type=checkbox]');
      if (toggles.length < 2) {
        return { ok: false, detail: `expected two publish toggles, saw ${toggles.length}` };
      }
      await toggles[0]!.check();
      await page.click('button:has-text("save profile")');
      await page.waitForTimeout(3_000);

      /** Look at the page the way anybody on the internet would. */
      const asStranger = async (): Promise<{ status: number; text: string }> => {
        await page.context().clearCookies();
        const response = await page.goto(`${base}/${handle}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(2_500);
        return {
          status: response?.status() ?? 0,
          text: await page.evaluate(() => document.body.innerText),
        };
      };

      const problems: string[] = [];
      const published = await asStranger();
      if (!/top of mind|탑오브마인드/i.test(published.text) && published.text.trim().length === 0) {
        problems.push("the published page rendered nothing at all");
      }
      if (published.text.includes(secret)) {
        problems.push("a raw capture is readable on the public page");
      }

      /* AND IT GOES AWAY AGAIN. A publish toggle that cannot be un-published
         is the same failure as one that never published: the person is not in
         control of it either way. */
      await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await page.fill("input[name=email]", me.email);
      await page.fill("input[name=password]", SIGNUP_PASSWORD);
      await page.click(".btn-doorway");
      await page.waitForTimeout(4_000);

      await goSurface(page, base, "/profile");
      const reopen = await page.$('button:has-text("your page is public")');
      if (!reopen) {
        problems.push("after publishing, /profile does not say the page is public");
      } else {
        await reopen.click();
        await page.waitForTimeout(600);
        const again = await page.$$('.profile-toggle-row input[type=checkbox]');
        await again[0]!.uncheck();
        await page.click('button:has-text("save profile")');
        await page.waitForTimeout(3_000);

        const withdrawn = await asStranger();
        if (withdrawn.text.includes(secret)) {
          problems.push("a raw capture is still readable after un-publishing");
        }
        if (/top of mind|탑오브마인드/i.test(withdrawn.text)) {
          problems.push("the page is still published after being turned off");
        }
      }

      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `published at /${handle} with no capture text on it, and gone again when turned off`
            : problems.join("; "),
      };
    },
  },

  {
    id: "english",
    name: "the product speaks the chosen language, in words rather than in keys",
    /* THIS JOURNEY USED TO BE ITS OWN OPPOSITE, and the swap is a ruling, not
       a refactor. It was `locale`: pick Korean on `/profile`, sign in on a
       clean browser, and prove the choice reached the server rather than only
       this machine. Then the founder ruled the product English only
       (2026-08-24, verbatim: "i dont want any korean used in the product"),
       the language picker left `Profile.tsx` with the second language, and a
       journey that reaches for `select.field-input` on `/profile` now reports
       "no language picker" on every run — a red gate defending a decision that
       has been reversed.

       So it holds the ruling instead. Two of the three failures the old shape
       was against had nothing to do with which language it was, and they are
       kept exactly as they were:

         - RAW ICU REACHES THE SCREEN. `{count, plural, other {{count} behind
           it}}` printed verbatim once, because ICU cannot nest a placeholder
           inside a branch. Every message keeps the placeholder outside for
           that reason and nothing was checking.
         - A KEY PRINTS INSTEAD OF ITS MESSAGE. `t()` returns the key on a
           miss, so a typo renders as `signalHoldFaint` — legible enough to
           survive review, and not a word in any language.

       And the third is inverted into the ruling's own guard: no second
       language on screen, and no control offering one. Neither throws. All of
       it is visible only to something that reads the rendered text.

       THE POSITIVE HALF IS WHAT MAKES THE SABOTAGE MEAN ANYTHING. Every check
       above is an ABSENCE, and a blank page satisfies all of them — so each
       surface must also render a real amount of its own signed-in English.
       Breaking the session read empties exactly that and leaves the absences
       intact, which is the difference between a suite that is passing and one
       that has stopped looking. */
    /* A SABOTAGE HAS TO BREAK THE CLAIM. This one used to kill `/api/auth/me`,
       which is a fine way to break a journey ABOUT SIGNING IN and has nothing
       whatever to do with whether the product speaks English: the surfaces
       render their own words either way, so the journey passed under its own
       sabotage and had been decoration for as long as the claim has been the
       English ruling rather than the locale one. CI said so on its first ever
       run (2026-08-27) — "survived sabotage; this journey is decoration".

       The claim here is three things: no second language, no raw ICU, no bare
       keys. So the sabotage puts raw ICU on the screen — the exact defect the
       journey was written for, when `{count, plural, other {{count} behind
       it}}` printed verbatim because ICU cannot nest a placeholder inside a
       branch. If the scan cannot see that, the scan is not looking. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const leak = document.createElement("p");
          leak.setAttribute("data-sabotage", "raw-icu");
          leak.textContent = "{count, plural, other {{count} behind it}}";
          document.body.appendChild(leak);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);

      const problems: string[] = [];
      /* THE RULING REVERSED (founder, 2026-08-31): the person chooses English
         or Korean, so the picker's ABSENCE is now the failure — the exact
         inversion of the guard that held the 2026-08-24 ruling. */
      await goSurface(page, base, "/profile");
      if ((await page.locator('select[name="preferredLocale"]').count()) === 0) {
        problems.push(
          "the language picker is missing from /profile — the person chooses " +
            "their language (founder, 2026-08-31)",
        );
      }

      /* Every flat surface, not just one: a provider missed on a single route
         would leave that surface rendering something else entirely while
         /profile looked perfectly correct. */
      const surfaces = [
        "/profile",
        "/capture",
        "/inspirations",
        "/signals",
        "/top-of-mind",
        "/rooms",
        "/principles",
      ];
      /* Hangul, Kana, and the CJK block — the second language this product
         used to carry, and any other that might arrive the same way. */
      const otherScript = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/;
      const foreign: string[] = [];
      const rawIcu: string[] = [];
      const bareKeys: string[] = [];
      const silent: string[] = [];
      for (const path of surfaces) {
        await goSurface(page, base, path);
        const text = await translatableText(page);
        /* THE POSITIVE ASSERTION. A surface that rendered nothing passes every
           other check on this list by saying nothing at all. */
        if (text.replace(/\s+/g, " ").trim().length < 40) silent.push(path);
        if (otherScript.test(text)) foreign.push(path);
        /* `{` immediately followed by a word and a comma is ICU that never got
           formatted. Plain prose does not contain it. */
        if (/\{\s*\w+\s*,/.test(text)) rawIcu.push(path);
        /* A message key that printed itself: lowerCamelCase, no spaces, long
           enough not to be a variable name a person would write in prose, and
           standing alone on its line. */
        for (const line of text.split("\n")) {
          const bare = line.trim();
          if (/^[a-z][a-zA-Z]{11,}$/.test(bare)) bareKeys.push(`${path}:${bare}`);
        }
      }
      if (silent.length > 0) {
        problems.push(`rendered almost nothing: ${silent.join(", ")}`);
      }
      if (foreign.length > 0) {
        problems.push(
          `Korean on screen for an English account: ${foreign.join(", ")}`,
        );
      }
      if (rawIcu.length > 0) problems.push(`unformatted ICU on screen: ${rawIcu.join(", ")}`);
      if (bareKeys.length > 0) {
        problems.push(
          `message key printed instead of its message: ${bareKeys.slice(0, 3).join(", ")}`,
        );
      }

      /* THE POSITIVE HALF OF THE REVERSAL: flip the account to Korean on the
         picker and the chrome must actually speak it — a picker wired to
         nothing is the advisory-button lie in a dropdown. Same defect checks
         hold in the other language. */
      await goSurface(page, base, "/profile");
      await page.selectOption('select[name="preferredLocale"]', "ko-KR");
      await page.waitForTimeout(800);
      const koText = await translatableText(page);
      if (!otherScript.test(koText)) {
        problems.push("chose Korean and /profile still speaks only English");
      }
      if (/\{\s*\w+\s*,/.test(koText)) problems.push("unformatted ICU on the Korean screen");

      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `English on ${surfaces.length} surfaces for an English account, the picker ` +
              "stands on /profile, choosing Korean re-speaks the chrome, no raw ICU, no bare keys"
            : problems.join("; "),
      };
    },
  },
];

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.only ? JOURNEYS.filter((j) => j.id === args.only) : JOURNEYS;
  if (selected.length === 0) {
    console.error(`[journeys] no journey with id ${args.only}`);
    return 2;
  }

  console.log(`[journeys] base url: ${args.baseUrl}`);
  console.log(
    args.negative
      ? "[journeys] NEGATIVE mode — each journey runs against its own sabotage and MUST fail\n"
      : "[journeys] each journey must pass\n",
  );

  let browser: Browser | undefined;
  const results: Array<{ id: string; ok: boolean; detail: string }> = [];
  try {
    browser = await launchChromium();

    for (const [i, journey] of selected.entries()) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await stubExternals(ctx, args.baseUrl);
      if (args.negative) await journey.breaks(ctx);
      const page = await ctx.newPage();

      let outcome: Outcome;
      try {
        outcome = await journey.run(page, args.baseUrl);
      } catch (err) {
        /* A thrown journey is a failed journey — and in negative mode that is
           the point, so it is not special-cased into an error. */
        outcome = { ok: false, detail: `threw: ${err instanceof Error ? err.message : err}` };
      }
      await ctx.close();

      /* In negative mode the pass condition inverts: the journey must have
         failed. A journey that survives its own sabotage proves nothing. */
      const satisfied = args.negative ? !outcome.ok : outcome.ok;
      results.push({ id: journey.id, ok: satisfied, detail: outcome.detail });
      console.log(
        `${satisfied ? "PASS" : "FAIL"} ${i + 1}. ${journey.name}${
          outcome.detail ? ` — ${outcome.detail}` : ""
        }${args.negative && !satisfied ? "  << survived sabotage; this journey is decoration" : ""}`,
      );
    }
  } catch (err) {
    console.error(`\n[journeys] harness error: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser?.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[journeys] ${results.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
