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
async function goSurface(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
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

      await page.locator('button:has-text("Keep something")').first().click();
      await page.waitForTimeout(900);
      await page.fill(
        'textarea[aria-label="something worth keeping"]',
        `a lift button that dims once it has heard you ${uniq()}`,
      );
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5_000);

      const after = await fieldLight();
      /* Measured 2026-08-23 on a brand-new account: the field reads ~0.07
         empty, ~0.05 after the first keep, and ~1.95 once the page is
         RELOADED. So the orb exists and simply is not drawn until something
         re-solves the ground. A tenfold floor is far below the reload value
         and far above the noise between two empty frames. */
      const ok = after !== null && after > before * 10 && after > 0.5;
      return { ok, detail: `fieldLight ${before} -> ${after} (reload shows ~1.95)` };
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
          style.textContent = ".jar-edge, .jar-way { opacity: 0 !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);
      const seen = await page.evaluate(() => {
        const marks = Array.from(document.querySelectorAll<HTMLElement>(".jar-edge, .jar-way"));
        const inView = marks
          .map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              text: (el.innerText || "").trim(),
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
        for (let i = 0; i < inView.length; i++) {
          for (let j = i + 1; j < inView.length; j++) {
            const a = inView[i];
            const b = inView[j];
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
    id: "parking-lot",
    name: "every flat screen can be left again",
    /* WHY THIS EXISTS. The `≡` menu was the only door from the world into the
       flat routes — and because it opened FROM the world, it was also the way
       home. Emptying the holding pen removed the door and, with it, the exit.

       Measured 2026-08-24 on the running build: the world has ZERO links into
       any of these six routes, and the surface footer had no link back. Arrive
       at one from a bookmark, an old link, or the terminal flow, and the only
       ways out were the browser's own back button and the URL bar. Six screens
       you could reach and not leave.

       These routes are a parking lot — they hold the few things not yet
       designed into the world, and they are on their way out. A parking lot
       still has to have an exit. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "no-way-home");
          style.textContent = ".sf-verb-world { display: none !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);
      const FLAT = [
        "/capture",
        "/inspirations",
        "/signals",
        "/principles",
        "/top-of-mind",
        "/rooms",
      ];
      const stranded: string[] = [];
      const landed: string[] = [];
      for (const path of FLAT) {
        await goSurface(page, base, path);
        /* VISIBLE, not merely present. `page.$` finds a `display: none`
           element perfectly well, and clicking it then waits thirty seconds
           for it to appear — so an exit that exists and cannot be seen was
           reported as a timeout rather than as the missing exit it is. */
        const home = await page.$(".sf-verb-world");
        const reachable = home !== null && (await home.isVisible());
        if (!reachable) {
          stranded.push(`${path} (no way back${home ? " — present but not visible" : ""})`);
          continue;
        }
        await home.click();
        await page.waitForTimeout(3_500);
        /* ARRIVING IS NOT THE SAME AS THE WORLD BEING THERE. A push to `/`
           that renders nothing is still stranded, just at a different
           address, so the canvas has to exist on the other side. */
        const where = await page.evaluate(() => ({
          path: location.pathname,
          canvases: document.querySelectorAll("canvas").length,
        }));
        if (where.path !== "/" || where.canvases < 1) {
          stranded.push(`${path} -> ${where.path} (${where.canvases} canvases)`);
        } else {
          landed.push(path);
        }
      }
      return {
        ok: stranded.length === 0,
        detail:
          stranded.length === 0
            ? `${landed.length}/${FLAT.length} flat screens return to a live world`
            : `stranded: ${stranded.join(", ")}`,
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
    name: "a thumb can hit what it aimed at, and read what it hit",
    /* THREE RULES, ONE WALK, AT 390x844 WITH TOUCH ON.

       SIZE and CROWDING are finding 8. Measured before: 21-22 controls per
       surface under 44px, and — the shape that actually matters — "take it
       down" at 21x21 sitting 21px from "hold" at 22x22. A destructive control
       at half the minimum, touching a harmless one. Undo exists and fading
       never deletes, but an undo you have to reach for is a mis-tap that
       already happened. The two smallest in the product were worse: the
       principle arrows were **11x20**.

       The rules are not "44px everywhere", because that is not what the
       evidence supports and pretending otherwise would mean overriding
       decisions this repo made deliberately. `.sf-control` is 32px with the
       reason written beside it, and its nearest neighbour is 94px away. So:
       a floor on size, and a floor on distance that only 44px targets are
       allowed to cross.

       CONTRAST is a second finding this walk turned up on the way. See below.

       THE SABOTAGE puts the post-it's marks back to 21px a pixel apart, which
       is finding 8 exactly as it shipped. */
    breaks: async (ctx) => {
      await ctx.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.setAttribute("data-sabotage", "small-crowded-marks");
          style.textContent =
            ".sf-act { width: 21px !important; height: 21px !important; margin: 0 !important; }" +
            ".sf-postit-acts { gap: 1px !important; margin: 0 -5px 0 0 !important; }";
          document.head.appendChild(style);
        });
      });
    },
    run: async (page, base) => {
      await signUp(page, base);

      /* AND IT HAS TO HAVE SOMETHING TO MEASURE.
         A fresh account has no memories, no signals and no principles, so the
         first version of this walked six empty screens, found six controls on
         each — the footer nav — and passed. The `--negative` run said so in
         one word: it SURVIVED its own sabotage, because there was not a single
         post-it on the page for the sabotage to shrink. That is the harness
         doing exactly what it is for.

         So the journey makes the things it is about: one memory, which is a
         post-it with a "hold" and a "take it down" on it, and one principle,
         which is the row carrying the two arrows that used to be 11x20. */
      const phrase = `the funicular counts down in stops not minutes ${uniq()}`;
      await goSurface(page, base, "/capture");
      await page.fill('textarea[aria-label="What caught you?"]', phrase);
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(4_000);

      /* A REAL DIRECTIVE, WITH NO UNIQUE SUFFIX. The first version appended
         `uniq()` out of habit, and `routeDeclaration` correctly refused to
         call a sentence ending in a random number a principle — it filed it
         as an inspiration instead, `201 {"created":"inspiration"}`, so the
         principle verbs this journey exists to measure were never on the
         page. Nothing needs to be unique here: the account is new every run.

         The failure was silent by construction and the per-family count is
         the only reason it surfaced — one combined total stayed comfortably
         above zero on the post-it marks alone. */
      await goSurface(page, base, "/principles");
      const declare = await page.$(".pr-declare-input");
      if (declare) {
        await declare.fill("prefer the small tool over the platform, always");
        await declare.press("Enter");
        await page.waitForTimeout(6_000);
      }

      /* A PHONE, MEASURED AS GEOMETRY, AND ONLY NOW — the setting up above
         types into the surface, and it does that at the size every other
         journey uses so a failure there is a failure they would all see.

         The harness gives every journey a 1440x900 context and `hasTouch`
         cannot be changed after a context is made, so this resizes the page
         rather than emulating a finger. Every rule below is about boxes and
         distances, which the viewport alone decides. Said out loud so nobody
         reads this as a touch run that it is not. */
      await page.setViewportSize({ width: 390, height: 844 });

      const ROUTES = [
        "/capture",
        "/inspirations",
        "/signals",
        "/principles",
        "/top-of-mind",
        "/rooms",
      ];
      /* 24px is WCAG 2.5.8's floor; 44px is the distance below which two
         targets are close enough that one absorbs a miss meant for the
         other, and only a pair that is itself 44px in both axes may be that
         close. */
      const MIN_SIZE = 24;
      const MIN_APART = 44;
      const problems: string[] = [];
      const notes: string[] = [];
      /* the controls this journey actually exists for — if none of them are
         on any page, the walk proved nothing and has to say so */
      const FAMILIES = ["postit", "principle", "reread"] as const;
      const marks: Record<(typeof FAMILIES)[number], number> = {
        postit: 0,
        principle: 0,
        reread: 0,
      };

      for (const path of ROUTES) {
        await goSurface(page, base, path);
        const found = await page.evaluate(
          ([minSize, minApart]) => {
            const boxes = Array.from(
              document.querySelectorAll<HTMLElement>(
                "button, a[href], input, select, textarea",
              ),
            )
              .filter((el) => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return (
                  r.width > 0 &&
                  r.height > 0 &&
                  cs.visibility !== "hidden" &&
                  cs.display !== "none"
                );
              })
              .map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  name:
                    (el.getAttribute("aria-label") || el.innerText || el.className || "?")
                      .trim()
                      .slice(0, 24) || "?",
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  cx: r.x + r.width / 2,
                  cy: r.y + r.height / 2,
                };
              });

            const tooSmall = boxes.filter((b) => b.w < minSize || b.h < minSize);
            const crowded: string[] = [];
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const b = boxes[j];
                /* a pair that is 44px in both axes may be as close as it
                   likes — two big targets cannot steal each other's misses */
                if (a.w >= minApart && a.h >= minApart && b.w >= minApart && b.h >= minApart) {
                  continue;
                }
                const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
                if (d < minApart) {
                  crowded.push(
                    `${a.name} (${a.w}x${a.h}) & ${b.name} (${b.w}x${b.h}) ${Math.round(d)}px apart`,
                  );
                }
              }
            }

            /*
              AND WHETHER THE PAGE CAN BE READ AT ALL. Colours are collected
              here and the contrast is computed in the harness — partly
              because the arithmetic is easier to check there, and partly
              because a named helper declared inside `page.evaluate` picks up
              esbuild's keep-names shim and dies on `__name is not defined`.
            */
            const ground = getComputedStyle(
              document.querySelector(".sf") || document.body,
            ).backgroundColor;
            /* The sentence AND the title. `.sf-roomname` failed at the same
               1.15:1 by a different road: `chrome.css` carries bare
               `h1, h2 { color: var(--w-ink) }` blocks, and an element
               selector in another sheet beats a colour `.sf` sets and lets
               inherit — so the largest words on the page were the world's
               near-white on this surface's paper. Checking only the body text
               would have missed it. */
            const sentences = Array.from(
              document.querySelectorAll<HTMLElement>(
                ".sf-postit-text, .pr-statement, .sf-roomname, .sf-headline",
              ),
            )
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width >= 1 && r.height >= 1;
              })
              .map((el) => {
                /* a post-it paints its own ground, so it is measured against
                   that rather than against the wall behind it */
                const sheet = el.closest<HTMLElement>(".sf-postit");
                return {
                  text: ((el as HTMLTextAreaElement).value || el.textContent || "")
                    .trim()
                    .slice(0, 20),
                  fg: getComputedStyle(el).color,
                  bg: sheet ? getComputedStyle(sheet).backgroundColor : ground,
                };
              });
            return {
              count: boxes.length,
              /* PER FAMILY, NOT ONE TOTAL. Declaring a principle needs a
                 model call, so on a stack with no key the principle verbs —
                 the 11x20 arrows, the worst case this journey exists for —
                 simply are not on the page, while the post-it marks are. One
                 combined count would stay comfortably above zero and the
                 narrower coverage would never be said out loud. */
              marks: {
                postit: document.querySelectorAll(".sf-act").length,
                principle: document.querySelectorAll(".pr-action").length,
                reread: document.querySelectorAll(".sf-reread").length,
              },
              tooSmall,
              crowded,
              sentences,
            };
          },
          [MIN_SIZE, MIN_APART] as const,
        );

        if (found.tooSmall.length > 0) {
          problems.push(
            `${path}: under ${MIN_SIZE}px — ${found.tooSmall
              .map((b) => `${b.name} (${b.w}x${b.h})`)
              .join(", ")}`,
          );
        }
        if (found.crowded.length > 0) {
          problems.push(`${path}: crowded — ${found.crowded.slice(0, 4).join("; ")}`);
        }
        const faint = found.sentences
          .map((sen) => ({ ...sen, ratio: contrast(sen.fg, sen.bg) }))
          .filter((sen) => sen.ratio < 4.5)
          .map((sen) => `"${sen.text}" at ${sen.ratio.toFixed(2)}:1`);
        if (faint.length > 0) {
          problems.push(`${path}: unreadable — ${faint.slice(0, 3).join("; ")}`);
        }
        notes.push(`${path}:${found.count}`);
        for (const family of FAMILIES) marks[family] += found.marks[family];
      }

      /* A CLEAN WALK OVER NOTHING IS NOT A CLEAN WALK. */
      const total = FAMILIES.reduce((n, family) => n + marks[family], 0);
      if (total === 0) {
        problems.push(
          "no post-it mark, principle verb or re-read on any screen — this walk measured only chrome",
        );
      }
      /* …and a walk that covered SOME of them says which it missed, rather
         than reporting a round number that reads like full coverage. */
      const missing = FAMILIES.filter((family) => marks[family] === 0);
      const seen = FAMILIES.map((family) => `${family}:${marks[family]}`).join(" ");
      const gap = missing.length > 0 ? ` — NOT CHECKED: ${missing.join(", ")}` : "";
      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `every control >= ${MIN_SIZE}px, no sub-${MIN_APART}px pair crowded, every sentence readable — ${seen}${gap} over ${notes.join(" ")}`
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
          /* the rule exactly as it shipped */
          style.textContent =
            ".jar-board-acts { opacity: 0 !important; pointer-events: none !important; }";
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
      await goSurface(page, base, "/capture");
      for (const text of SITTING) {
        await page.fill('textarea[aria-label="What caught you?"]', text);
        await page.click('button:has-text("keep")');
        await page.waitForTimeout(1_200);
      }

      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      /* The board arrives out of band. Poll rather than sleep, and say so if
         it never comes — a walk with no board proves nothing about buttons
         that only exist beside one. */
      let appeared = false;
      for (let i = 0; i < 60; i += 1) {
        appeared = await page.evaluate(
          () => document.querySelectorAll(".jar-board-act").length >= 3,
        );
        if (appeared) break;
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
          };
        });
      });

      const problems: string[] = [];
      if (reachable.length < 3) problems.push(`only ${reachable.length} entry actions rendered`);
      for (const act of reachable) {
        if (!act.onScreen) problems.push(`"${act.label}" has no box`);
        else if (!act.hit) {
          problems.push(
            `"${act.label}" cannot be hit at its own centre (opacity ${act.opacity})`,
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
      await goSurface(page, base, "/capture");
      await page.fill('textarea[aria-label="What caught you?"]', `I keep thinking about ${secret}.`);
      await page.click('button:has-text("keep")');
      await page.waitForTimeout(2_500);

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
    id: "locale",
    name: "the product speaks the language you chose, and still does tomorrow",
    /* WHY THIS EXISTS, AND WHY THE STATIC CHECK WAS NOT ENOUGH.
       `docs/goals/every-workflow-works.md` J1 read "locale still unproven"
       while the audit recorded "Korean coverage is genuinely complete". Both
       were true, because they were about different things: `ko-KR.json` has
       all 367 keys `en-US.json` has and none missing, which is a fact about
       two files. Whether a person who picks Korean gets a Korean product is a
       fact about a browser, and nothing had ever opened one to find out.

       THREE FAILURES THIS SHAPE IS AGAINST, all of which leave the files
       perfectly complete:

         - The choice does not survive. `Profile.tsx` writes the preference to
           `localStorage` AND to `/api/auth/me/preferences`, and
           `auth-context` restores it from the PROFILE on the next load. So a
           preference that saves locally and never reaches the server looks
           correct until the next visit, which is the worst possible time to
           find out.
         - Raw ICU reaches the screen. This happened during this session:
           `{count, plural, other {{count} behind it}}` printed verbatim,
           because ICU cannot nest a placeholder inside a branch. Every
           existing message keeps the placeholder outside for that reason, and
           nothing was checking.
         - A key prints instead of its message. `t()` returns the key when a
           lookup misses, so a typo renders as `signalHoldFaint` on the page —
           legible enough to survive review, and not a word in any language.

       None of the three throws. All three are visible only to something that
       looks at the rendered text, which is what this does. */
    /* THE PATH IS `/auth/me/profile`, AND GETTING IT WRONG COST A FALSE PASS.
       The first version of this sabotage broke `/api/auth/me/preferences` — a
       path that appears in `auth-agent-boundary.test.ts` and nowhere in the
       web client. `updateAuthProfile` PATCHes `/api/auth/me/profile`. So the
       save succeeded, the journey passed, and `--negative` reported it as
       decoration for a reason that had nothing to do with the journey. A
       sabotage aimed at a route that does not exist is indistinguishable from
       no sabotage at all, and it fails silently in the direction of green. */
    breaks: (ctx) => breakRoute(ctx, (p) => p === "/api/auth/me/profile"),
    run: async (page, base) => {
      const { email } = await signUp(page, base);

      await goSurface(page, base, "/profile");
      const picker = page.locator("select.field-input").first();
      if ((await picker.count()) === 0) return { ok: false, detail: "no language picker on /profile" };
      /* THE BUTTON IS ALREADY IN KOREAN BY THE TIME WE REACH FOR IT.
         `Profile.tsx` derives `locale` straight from the picker's state, so
         choosing Korean re-renders the whole form — including this button's
         label — before anything is saved. That is the product being right and
         a text selector being monolingual: the first version of this journey
         looked for `save profile` and timed out for 30 seconds against a
         button that now said 저장. Submit is addressed by its ROLE, which is
         the one thing about it that does not translate. */
      await picker.selectOption("ko-KR");
      await page.click('button.btn-primary[type=submit]');
      await page.waitForTimeout(3_500);

      /* A RELOAD IS NOT THE TEST. THIS IS THE SECOND VERSION OF THIS JOURNEY.
         The first reloaded the page and asserted Korean, and it SURVIVED ITS
         OWN SABOTAGE — reported as decoration by `--negative`, which is the
         only reason any of this was found. The reason it survived is the
         finding: the picker persisted the choice to `localStorage` the moment
         it changed, so a save that 500'd still left this browser in Korean
         forever. Reloading reads back the very thing the sabotage did not
         prevent.

         "Still does tomorrow" means a DIFFERENT browser — a second device,
         a cleared cache, a colleague's laptop. So the reading that counts is
         taken in a fresh context with empty storage, signing in from nothing.
         The only channel that can carry the preference there is the server,
         which is exactly what the sabotage breaks. */
      const browser = page.context().browser();
      if (!browser) return { ok: false, detail: "no browser to open a second context from" };
      const tomorrow = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await stubExternals(tomorrow, base);
      const fresh = await tomorrow.newPage();
      const hangul = /[\uAC00-\uD7A3]/;
      const problems: string[] = [];
      try {
        await fresh.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
        await fresh.fill("input[name=email]", email);
        await fresh.fill("input[name=password]", SIGNUP_PASSWORD);
        await fresh.click("button[type=submit]");
        await fresh.waitForTimeout(6_000);
        await goSurface(fresh, base, "/profile");
        /* NOT `bodyText` — the picker's own options are always in their native
           names, so `/profile` always contains Hangul. See `translatableText`. */
        if (!hangul.test(await translatableText(fresh))) {
          problems.push(
            "signed in on a clean browser and the product is back in English — the choice " +
              "never left this machine",
          );
        }
      } finally {
        await tomorrow.close();
      }

      /* Every flat surface, not just the one carrying the picker — the
         preference is account-wide and a surface that missed the provider
         would still render English while /profile looked fine. */
      const surfaces = ["/capture", "/inspirations", "/signals", "/top-of-mind", "/rooms", "/principles"];
      const silent: string[] = [];
      const rawIcu: string[] = [];
      const bareKeys: string[] = [];
      for (const path of surfaces) {
        await goSurface(page, base, path);
        const text = await translatableText(page);
        if (!hangul.test(text)) silent.push(path);
        /* `{` immediately followed by a word and a comma is ICU that never
           got formatted. Plain prose does not contain it. */
        if (/\{\s*\w+\s*,/.test(text)) rawIcu.push(path);
        /* A message key that printed itself: lowerCamelCase, no spaces, long
           enough not to be a variable name a person would write in prose,
           and standing alone on its line. */
        for (const line of text.split("\n")) {
          const bare = line.trim();
          if (/^[a-z][a-zA-Z]{11,}$/.test(bare) && !hangul.test(bare)) bareKeys.push(`${path}:${bare}`);
        }
      }
      if (silent.length > 0) problems.push(`still English: ${silent.join(", ")}`);
      if (rawIcu.length > 0) problems.push(`unformatted ICU on screen: ${rawIcu.join(", ")}`);
      if (bareKeys.length > 0) {
        problems.push(`message key printed instead of its message: ${bareKeys.slice(0, 3).join(", ")}`);
      }

      return {
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `Korean reached a clean browser and holds across ${surfaces.length} surfaces; no raw ICU, no bare keys`
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
