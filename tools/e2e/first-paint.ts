#!/usr/bin/env tsx
/**
 * THE GATE THAT WOULD HAVE CAUGHT THE BLACK RECTANGLE.
 *
 * On 2026-08-22 a signed-in visitor whose network could not reach
 * `fonts.googleapis.com` OR `cdn.jsdelivr.net` — either one alone was enough
 * — got `/` as a black rectangle. `#root` had zero children, zero canvases,
 * zero characters. No spinner, no message, no retry. The account was fine and
 * the flat screens still worked; only the world, which is the product, was
 * gone. It reproduced in under ten seconds.
 *
 * It survived every gate in the repo because **nothing runs the production
 * build**. The unit suites import source. `check-vocabulary` and
 * `check-seams` read source. The one thing a user actually receives — a
 * built, hashed, code-split bundle served over HTTP — was checked by nobody,
 * and the defect lived precisely there: in Vite's preload helper, which does
 * not exist in dev.
 *
 * So this harness asserts the smallest true thing: **a person who signs in
 * sees the world, on a network that answers for this origin and nothing
 * else.** Every third-party request is failed outright, which is not a
 * pessimistic simulation — it is Tuesday in mainland China, on a corporate
 * network that blocks CDNs, behind a strict content blocker, or during any
 * CDN incident.
 *
 * WHY IT BLOCKS RATHER THAN STUBS. A stub proves the app works when the
 * network works, which was never in doubt. The failure mode is the network
 * not working, and the only honest way to test it is to break it.
 *
 * THE SECOND STEP IS THE ONE THAT GENERALISES. Fonts were the trigger, not
 * the bug. The bug was that a rejected lazy chunk had nowhere to go, so it
 * rendered as nothing forever — and the likeliest cause of that in production
 * is not a CDN at all, it is a visitor holding an `index.html` from before
 * the last deploy asking for a hashed chunk that no longer exists. Step 2
 * forces exactly that and requires a legible failure with a way out.
 *
 * Run it against a stack serving the BUILT app:
 *
 *     pnpm dev:local                 # terminal A — builds, then serves dist
 *     pnpm e2e:first-paint           # terminal B
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010),
 *        `--email <addr>` / `--password <pw>` (an account that already
 *        exists; defaults match `pnpm demo:seed`'s documented invocation).
 */
import { type Browser, type BrowserContext, type Route } from "playwright";
import { launchChromium } from "./browser";
interface Args {
  baseUrl: string;
  email: string;
  password: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: "http://127.0.0.1:3010",
    email: "demo@example.test",
    password: "local-only-demo-password",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--email") args.email = take();
    else if (flag === "--password") args.password = take();
    else if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: pnpm e2e:first-paint [--base-url <url>] [--email <addr>] [--password <pw>]",
      );
      process.exit(0);
    } else {
      console.error(`[first-paint] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

const results: Array<{ n: number; name: string; ok: boolean; detail: string }> = [];

function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${n}. ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Fail every request that is not this origin. No allowlist, on purpose. */
async function isolate(ctx: BrowserContext, baseUrl: string): Promise<void> {
  await ctx.route(
    (url) => !url.href.startsWith(baseUrl),
    (route: Route) => route.abort("failed"),
  );
}

/**
 * GET THROUGH THE DOOR, AND MAKE AN ACCOUNT IF THERE ISN'T ONE.
 *
 * This signed in as `demo@example.test` and gave up if that failed, so on any
 * machine where `pnpm demo:seed` had not been run it stayed on `/login` — and
 * then reported `the world renders with every third-party host unreachable —
 * FAIL`, naming the world for a missing row in a database. A gate that says
 * the product is broken when the truth is "no account" is worse than no gate:
 * it is a red suite nobody can act on, and it is exactly the "breaks in the
 * middle" failure the founder asked to be rid of (2026-08-25).
 *
 * Every other browser suite in this repo signs UP, with a unique address, and
 * so is runnable on a cold stack. This one now does the same — it prefers an
 * existing account so a seeded demo is still what gets walked, and falls back
 * to making one. If neither works it says which, rather than blaming the page
 * it never reached.
 */
async function signIn(
  ctx: BrowserContext,
  { baseUrl, email, password }: Args,
): Promise<import("playwright").Page> {
  const page = await ctx.newPage();
  const landed = (): boolean => !new URL(page.url()).pathname.startsWith("/login");

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 })
    .catch(() => {});
  if (landed()) return page;

  console.log(`[first-paint] no account for ${email}; making one`);
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `first-paint-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "first-paint-password-1");
  await page.fill("input[name=name]", "First Paint");
  await page.click("button[type=submit]");
  await page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 })
    .catch(() => {});
  if (!landed()) {
    /* Neither route worked. Say so here, so the case below reports a door that
       would not open rather than a world that would not draw. */
    console.log("[first-paint] could not sign in OR sign up — the door itself is shut");
  }
  return page;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[first-paint] base url: ${args.baseUrl}`);
  console.log("[first-paint] every non-same-origin request will be failed\n");

  let browser: Browser | undefined;
  try {
    /* `WAKA_CHROMIUM_PATH` lets a machine whose Playwright browser build does
       not match this repo's pinned version point at the Chromium it already
       has, rather than downloading a second one. Unset everywhere normal. */
    browser = await launchChromium();

    /* ---- 1. the world renders with the outside world unreachable ---- */
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await isolate(ctx, args.baseUrl);
      const page = await signIn(ctx, args);
      await page.waitForTimeout(6_000);

      const state = await page.evaluate(() => ({
        path: window.location.pathname,
        rootChildren: document.getElementById("root")?.children.length ?? 0,
        canvases: document.querySelectorAll("canvas").length,
        text: document.body.innerText.trim().length,
      }));

      const ok =
        state.path === "/" && state.rootChildren > 0 && state.canvases > 0 && state.text > 0;
      record(
        1,
        "the world renders with every third-party host unreachable",
        ok,
        `path=${state.path} rootChildren=${state.rootChildren} canvases=${state.canvases} text=${state.text}`,
      );
      await ctx.close();
    }

    /* ---- 2. a chunk that truly cannot load fails out loud ---- */
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      /* Same isolation, plus the world's own JavaScript withheld — the stale
         `index.html` case, which no amount of font hosting prevents. */
      await isolate(ctx, args.baseUrl);
      await ctx.route(
        (url) => /\/assets\/Home-[^/]*\.js$/.test(url.pathname),
        (route: Route) => route.abort("failed"),
      );
      const page = await signIn(ctx, args);
      await page.waitForTimeout(6_000);

      const state = await page.evaluate(() => {
        const root = document.getElementById("root");
        const text = document.body.innerText.trim();
        return {
          rootChildren: root?.children.length ?? 0,
          text,
          hasAlert: !!document.querySelector('[role="alert"]'),
          hasButton: [...document.querySelectorAll("button")].some(
            (b) => (b.innerText || "").trim().length > 0,
          ),
        };
      });

      const ok = state.rootChildren > 0 && state.text.length > 0 && state.hasAlert && state.hasButton;
      record(
        2,
        "a chunk that cannot load says so, with a way out",
        ok,
        ok
          ? `alert shown, retry offered`
          : `rootChildren=${state.rootChildren} alert=${state.hasAlert} button=${state.hasButton} text=${JSON.stringify(state.text.slice(0, 80))}`,
      );
      await ctx.close();
    }
  } catch (err) {
    console.error(`\n[first-paint] harness error: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser?.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[first-paint] ${results.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
