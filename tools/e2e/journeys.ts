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
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

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

async function signUp(page: Page, base: string): Promise<{ email: string; name: string }> {
  const email = `journey-${uniq()}@example.test`;
  const name = "Journey Tester";
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "journey-local-password-1");
  await page.fill("input[name=name]", name);
  await page.click("button[type=submit]");
  await page.waitForTimeout(6_000);
  return { email, name };
}

/** The flat surfaces navigate by a footer of text buttons. */
async function goSurface(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
}

const bodyText = (page: Page): Promise<string> =>
  page.evaluate(() => document.body.innerText.trim());

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
      await goSurface(page, base, "/capture");
      await page.fill('textarea[aria-label="What caught you?"]', phrase);
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(4_000);

      /* Two claims, and the second is the one that matters. "kept" appearing
         is the product saying so; the archive holding it is the product
         meaning it. A confirmation without persistence is the worse bug. */
      const acknowledged = /kept/i.test(await bodyText(page));
      await goSurface(page, base, "/inspirations");
      const persisted = (await bodyText(page)).includes(phrase);
      return {
        ok: acknowledged && persisted,
        detail: `acknowledged=${acknowledged} persisted=${persisted}`,
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
      await goSurface(page, base, "/capture");
      await page.fill('textarea[aria-label="What caught you?"]', `a word nobody repeats: ${needle}`);
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(3_000);

      /* Bury it, so the assertion is about search rather than about recency. */
      for (let i = 0; i < 3; i += 1) {
        await page.fill('textarea[aria-label="What caught you?"]', `filler capture ${i} ${uniq()}`);
        await page.click('button:has-text("keep")');
        await page.waitForTimeout(1_200);
      }

      await goSurface(page, base, "/inspirations");
      await page.fill('input[aria-label="What were you circling?"]', needle);
      await page.waitForTimeout(3_500);
      const found = (await bodyText(page)).includes(needle);
      return { ok: found, detail: `found=${found} needle=${needle}` };
    },
  },

  {
    id: "reflect",
    name: "a reflection answered on a memory is still there when you come back",
    breaks: (ctx) => breakRoute(ctx, (p, m) => /reflection/.test(p) && m === "POST"),
    run: async (page, base) => {
      await signUp(page, base);
      await goSurface(page, base, "/capture");
      await page.fill(
        'textarea[aria-label="What caught you?"]',
        `a bus map that admits which routes are slow ${uniq()}`,
      );
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(3_500);

      await goSurface(page, base, "/inspirations");
      await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll("*")).find(
          (e) => e.children.length === 0 && /bus map that admits/.test((e as HTMLElement).innerText || ""),
        );
        (row as HTMLElement | undefined)?.click();
      });
      await page.waitForTimeout(2_500);

      /* TWO fields, and the button is gated on the FIRST — a reflection here is
         a question the person writes for themselves, then their answer to it
         (`Surface.tsx:2147`, `disabled={!reflectionQuestion.trim()}`). An
         earlier version of this journey filled only "your answer", watched
         "keep this too" stay disabled, and very nearly filed it as a product
         defect. It is not one; it was this harness not knowing the shape of
         the thing it was driving. */
      const question = `why did this catch me ${uniq()}`;
      const answer = `because the admission is the useful part ${uniq()}`;
      const questionField = await page.$('input[aria-label="a question"]');
      const answerField = await page.$('textarea[aria-label="your answer"]');
      if (!questionField || !answerField) {
        return {
          ok: false,
          detail: `missing reflection fields (question=${!!questionField} answer=${!!answerField})`,
        };
      }
      await questionField.fill(question);
      await answerField.fill(answer);
      await page.click('button:has-text("keep this too")');
      await page.waitForTimeout(3_500);

      /* Reload rather than trust the optimistic render. */
      const url = page.url();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);
      const text = await bodyText(page);
      const survived = text.includes(answer) && text.includes(question);
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
      await goSurface(page, base, "/capture");
      await page.fill('textarea[aria-label="What caught you?"]', phrase);
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(3_500);

      await goSurface(page, base, "/inspirations");
      await page.evaluate((needle) => {
        const row = Array.from(document.querySelectorAll("*")).find(
          (e) => e.children.length === 0 && (e as HTMLElement).innerText?.includes(needle),
        );
        (row as HTMLElement | undefined)?.click();
      }, phrase);
      await page.waitForTimeout(2_500);

      page.once("dialog", (d) => void d.accept());
      await page.click('button:has-text("delete this capture")');
      await page.waitForTimeout(3_500);

      await goSurface(page, base, "/inspirations");
      const gone = !(await bodyText(page)).includes(phrase);
      return { ok: gone, detail: `goneFromArchive=${gone}` };
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
    const executablePath = process.env.WAKA_CHROMIUM_PATH?.trim() || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});

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
