#!/usr/bin/env tsx
/**
 * THE SKY, MEASURED IN LIGHT, AGAINST AN ACCOUNT THAT HAS NONE.
 *
 * ── THE GAP THIS EXISTS TO CLOSE ──────────────────────────────────────────
 *
 * `journeys.ts`'s `ways-out` journey covers the promise that the world goes
 * somewhere: left, right, down, and up. Three of those four are DOM signposts
 * and it measures them properly. The fourth is the sky leaning down into
 * headquarters, and on a brand-new account it cannot measure that at all. It
 * says so out loud, every run:
 *
 *     sky leaning (1) but EMPTY — no statements on this account to elect
 *
 * A sky is made of signals. Signals only ever come from derivation, there is
 * no route that writes one, and `journeys` has to stay key-free so it can run
 * on every pull request. That half of that journey is structurally
 * unmeasurable there, and no amount of care inside it changes that.
 *
 * This suite is the other half. It spends real model calls to grow a real sky
 * and then measures the thing that actually shipped broken.
 *
 * ── WHY THIS MEASURES PIXELS AND NOT THE MODEL ────────────────────────────
 *
 * This is the whole design, and getting it wrong would have produced a suite
 * that passed on the broken build.
 *
 * The bug that shipped was `SKY_PEEK_DEPTH = 0.62`. Under it the peek elected
 * the right statements, eased them to `peekY` **to the pixel**, and drew
 * nothing a person could see — because `rasterNebula` bakes a cloud's alpha as
 * `peak · (1 − u)^2.4` under a mask already at zero by the rim, so everything
 * past roughly half a radius has no light left in it. The clouds arrived
 * perfectly, inside their own dead zone.
 *
 * So every model-level assertion — was a statement elected, did it reach
 * `peekY`, is `skyPeek()` 1 at headquarters — was GREEN on the broken build.
 * They are still checked here, so that a failure says WHICH half broke, but
 * they are not the gate. The gate is a photometer.
 *
 * ── WHY THE CONTROL IS A SECOND ACCOUNT ───────────────────────────────────
 *
 * A photometer needs something to read against, and two candidates that look
 * obvious are both wrong:
 *
 *   - **Before and after reaching for the top edge.** There is no such reach.
 *     `skyPeek()` is `1 - cam.y / minCam` — the CAMERA's position, never the
 *     pointer. Standing at headquarters it is already 1 and the sky is already
 *     leaning at full strength. A hover A/B would compare a frame against
 *     itself and call the null result a pass.
 *   - **Moving the camera away.** Descending into the field leaves `skyPeek()`
 *     at 1 (the sky is simply a viewport away and culled), and climbing up
 *     into the sky fills the screen with it. Neither gives a dark frame.
 *
 * So the control is a second account, signed up in the same run, with nothing
 * captured and therefore no sky — the exact state `ways-out` walks. Same
 * camera, same viewport, same first frame at headquarters; the only difference
 * between the two readings is whether there is anything up there. That is the
 * A/B `first-paint.ts` uses for fonts, and it is the only one here that
 * isolates the thing being claimed.
 *
 * Measured 2026-08-24, top 12% of the canvas at headquarters, by this suite:
 *
 *     account with no sky (control)                    0.02
 *     account with a real sky, 5 statements up         0.87   <- 43x
 *
 * And the same band on the build that shipped, where `SKY_PEEK_DEPTH` was
 * 0.62, read 0.05 against a top-edge brightness of 0.05 empty — the broken
 * build and the empty account were indistinguishable. That is precisely the
 * point: this suite is the only thing in the repo that can tell them apart.
 *
 * The floors below sit an order of magnitude under the lit reading and an
 * order of magnitude over the dark one, so neither a dimmer sky nor a noisier
 * control moves the verdict.
 *
 * ── `--negative` ──────────────────────────────────────────────────────────
 *
 * `SKY_PEEK_DEPTH` is a bundled constant, so nothing an init script can reach
 * puts `0.62` back. What CAN be injected is the state that produces the same
 * photometry: `/api/signals` returning an empty list, so the subject account
 * has no sky either. The band collapses to the control's and the gate must
 * fail.
 *
 * In negative mode the "nothing up there" guard is deliberately NOT taken as
 * grounds to decline — an emptied sky is the sabotage, and bailing out of it
 * would let the suite report neither pass nor fail on the one run designed to
 * break it.
 *
 * ── RUNNING IT ────────────────────────────────────────────────────────────
 *
 *     pnpm dev:local          # terminal A, with VITE_SHOW_INTERNAL=1
 *     pnpm e2e:sky            # terminal B
 *     pnpm e2e:sky --negative # the sky is emptied; this must FAIL
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010), `--negative`.
 *
 * Two things make this suite decline to run rather than report a false pass:
 * a build without `VITE_SHOW_INTERNAL=1` has no `window.wakaField()` to read,
 * and a stack that cannot derive never grows a signal. Both exit 0 with a NOT
 * RUN line naming which one it was, the way CI's gated steps do — a suite that
 * cannot see is not the same as a product that is broken.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { capture, listSignals, signUp, type Session } from "./organic.js";

interface Args {
  baseUrl: string;
  negative: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", negative: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    if (flag === "--base-url") args.baseUrl = (inline ?? argv[++i] ?? "").replace(/\/+$/, "");
    else if (flag === "--negative") args.negative = true;
  }
  return args;
}

const PASSWORD = "sky-local-password-1";
const DERIVATION_TIMEOUT_MS = 180_000;

/**
 * Five captures that are ABOUT one thing, so the distiller has a pattern to
 * find rather than noise to invent. Five rather than one because a single
 * capture can fail to yield anything at all, and this suite needs a cloud
 * more than it needs a good one — it is measuring light, not judgement.
 */
const RELATED = [
  "the lift button that dims once it has heard you is the only part of the building I trust",
  "a kettle with a window is better than a kettle with a readout, because the water is the readout",
  "I keep photographing petrol pumps whose dial moves while it counts, not after",
  "the crossing that chirps while it thinks tells you more than the one that just goes green",
  "every machine I like shows its work while it is working, not in a summary afterwards",
];

/** Third-party fonts are noise here; a CDN outage is `first-paint.ts`'s job. */
async function stubExternals(ctx: BrowserContext, base: string): Promise<void> {
  await ctx.route(
    (url) => !url.href.startsWith(base),
    async (route) => {
      const u = route.request().url();
      if (/\.css|css2|pretendard/.test(u)) {
        return route.fulfill({ status: 200, contentType: "text/css", body: "/* stub */" });
      }
      return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    },
  );
}

/** THE SABOTAGE: the account keeps its signals and the sky never hears of them. */
async function emptyTheSky(ctx: BrowserContext): Promise<void> {
  await ctx.route(
    (url) => url.pathname === "/api/signals",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ signals: [] }),
      }),
  );
}

interface SkyReading {
  /** False when the build exposes no audit — a different state from empty. */
  known: boolean;
  peek: number | null;
  up: number;
  elected: number;
  stranded: number;
  /** Mean channel value across the top band of the canvas, 0–255. */
  band: number | null;
}

/**
 * One reading: what the model thinks, and what the canvas actually shows.
 *
 * The band is the top 12% of the canvas. `SKY_PEEK_DEPTH` is 0.28 of a cloud's
 * radius, so a leaning statement parks just below the seam — well inside this
 * strip, and nowhere near the ground the field lights at the bottom.
 */
function readSky(page: Page): Promise<SkyReading> {
  return page.evaluate(() => {
    const audit = (
      window as unknown as {
        wakaField?: () => {
          sky?: {
            lean: number;
            nebs: Array<{ y: number; homeY: number; peekY: number; r: number }>;
          };
        };
      }
    ).wakaField?.();
    const nebs = audit?.sky?.nebs ?? null;
    const elected = nebs ? nebs.filter((n) => n.peekY !== n.homeY) : [];
    const stranded = elected.filter((n) => Math.abs(n.y - n.peekY) > n.r * 0.5);

    let band: number | null = null;
    const c = document.querySelector("canvas");
    const g = c ? c.getContext("2d") : null;
    if (c && g) {
      const h = Math.max(1, Math.floor(c.height * 0.12));
      const d = g.getImageData(0, 0, c.width, h).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4 * 17) {
        sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
        n += 1;
      }
      band = n > 0 ? Math.round((sum / n) * 100) / 100 : null;
    }

    return {
      known: nebs !== null,
      /* the audit calls this `lean`; it is `skyPeek()`, which is the camera's
         reading and not a pointer's — named here for what it is */
      peek: audit?.sky?.lean ?? null,
      up: nebs ? nebs.length : 0,
      elected: elected.length,
      stranded: stranded.length,
      band,
    };
  });
}

/**
 * Poll until ONE signal exists. Not one that is well-evidenced — one at all.
 *
 * The first draft of this waited for a signal citing two captures, copied
 * from `signals.ts`, and it was wrong in a way worth leaving written down:
 * **the sky is the `emerging` signals** (`Home.tsx` filters on exactly that,
 * and `docs/generation.md` promotes `emerging → active` at three evidence).
 * A well-evidenced signal is therefore precisely the one that has already
 * LEFT the sky. Waiting for convergence here would have spent three minutes
 * making the thing under measurement disappear.
 *
 * One emerging signal is one cloud, and one cloud is enough light to
 * photometer. Convergence is `signals.ts`'s claim, not this one's.
 */
async function waitForSky(session: Session): Promise<number> {
  const deadline = Date.now() + DERIVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const signals = await listSignals(session, { limit: 50 });
    const emerging = signals.filter((s) => s.status === "emerging");
    if (emerging.length > 0) return emerging.length;
    await new Promise((r) => setTimeout(r, 4_000));
  }
  return 0;
}

/** Sign in through the door and stand still at headquarters, then read. */
async function readAtHeadquarters(
  browser: Browser,
  base: string,
  email: string,
  sabotage: boolean,
): Promise<SkyReading> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await stubExternals(ctx, base);
  if (sabotage) await emptyTheSky(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);
    /* Parked in the middle, deliberately. The pointer has nothing to do with
       the peek, and leaving it near an edge would only invite the reader to
       think it did. */
    await page.mouse.move(720, 450);
    await page.waitForTimeout(3_000);
    return await readSky(page);
  } finally {
    await ctx.close();
  }
}

/* The floors, from the measurement in the header: ~0.05 dark, 0.73 lit. */
const BAND_LIT_FLOOR = 0.3;
const BAND_RISE_FACTOR = 3;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[sky] base url: ${args.baseUrl}`);
  console.log(
    args.negative
      ? "[sky] negative mode: the sky is emptied, and this must FAIL\n"
      : "[sky] a real sky must carry light where an empty one does not\n",
  );

  /* ── grow a real sky over HTTP, before any browser is opened ──────────── */
  const subject = await signUp({ baseUrl: args.baseUrl, password: PASSWORD, name: "Sky Tester" });
  const control = await signUp({ baseUrl: args.baseUrl, password: PASSWORD, name: "No Sky" });
  for (const text of RELATED) {
    await capture(subject, { text });
  }
  const signalCount = await waitForSky(subject);
  if (signalCount === 0) {
    console.log(
      `NOT RUN — no emerging signal after ${DERIVATION_TIMEOUT_MS / 1000}s, so there is ` +
        "no sky to measure. This is the suite declining to report, not the product " +
        "failing: derivation needs credentials this stack does not have, and without " +
        "them there is nothing here that can be seen.",
    );
    return 0;
  }
  console.log(`[sky] ${signalCount} emerging signal(s) — there is a sky to measure\n`);

  const executablePath = process.env.WAKA_CHROMIUM_PATH?.trim() || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const failures: string[] = [];
  let line = "";
  try {
    const lit = await readAtHeadquarters(browser, args.baseUrl, subject.email, args.negative);
    const dark = await readAtHeadquarters(browser, args.baseUrl, control.email, false);

    line =
      `band ${dark.band} with no sky -> ${lit.band} with ${lit.up} statement(s) up; ` +
      `peek ${lit.peek}; elected ${lit.elected}`;

    if (!lit.known) {
      console.log(
        "NOT RUN — this build exposes no `window.wakaField()`, so the sky cannot be read. " +
          "Serve with VITE_SHOW_INTERNAL=1. Declining to report rather than passing over it.",
      );
      return 0;
    }
    /* In negative mode an emptied sky IS the sabotage, so this is not grounds
       to decline — declining there would let the one run designed to break
       this suite report neither pass nor fail. */
    if (lit.up === 0 && !args.negative) {
      console.log(
        `NOT RUN — ${signalCount} signal(s) exist but none reached the sky, so there is ` +
          "nothing to light. The derivation half worked and the painting half had nothing " +
          "to show; that is a different failure than this suite gates.",
      );
      return 0;
    }

    /* 1. THE GATE. Light, measured, where the broken build drew none. */
    if (lit.band === null || dark.band === null) {
      failures.push("no canvas to photometer the top band from");
    } else if (lit.band < BAND_LIT_FLOOR) {
      failures.push(
        `the top band carries no light: ${lit.band}, floor ${BAND_LIT_FLOOR} — this is ` +
          "what SKY_PEEK_DEPTH = 0.62 looked like: elected, arrived, invisible",
      );
    } else if (lit.band < dark.band * BAND_RISE_FACTOR) {
      failures.push(
        `a real sky is indistinguishable from no sky at all: ${dark.band} -> ${lit.band}, ` +
          `needed ${BAND_RISE_FACTOR}x`,
      );
    }

    /* 2. The sky is leaning at headquarters at all. Green on the broken build;
          kept so a failure names which half went. */
    if (lit.peek === null || lit.peek < 0.99) {
      failures.push(`the sky is not leaning at headquarters (skyPeek=${lit.peek})`);
    }

    /* 3. Something was chosen to come down, and 4. it arrived. Both green on
          the broken build. Same reason for keeping them. */
    if (lit.up > 0 && lit.elected === 0) {
      failures.push(`${lit.up} statement(s) up and none elected to lean in`);
    }
    if (lit.stranded > 0) {
      failures.push(`${lit.stranded} statement(s) elected to lean in but never arrived`);
    }
  } catch (err) {
    failures.push(`threw: ${err instanceof Error ? err.message : err}`);
  } finally {
    await browser.close();
  }

  const ok = failures.length === 0;
  const satisfied = args.negative ? !ok : ok;
  console.log(`${satisfied ? "PASS" : "FAIL"} the sky leans into headquarters, and is seen — ${line}`);
  for (const f of failures) console.log(`  ${args.negative ? "as required" : "problem"}: ${f}`);
  if (args.negative && ok) {
    console.log(
      "  << survived sabotage; this suite is decoration — the sky was emptied and it " +
        "still reported light at the top of the world",
    );
  }
  console.log(`\n[sky] ${satisfied ? "1 passed, 0 failed" : "0 passed, 1 failed"}`);
  return satisfied ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[sky] harness error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  },
);
