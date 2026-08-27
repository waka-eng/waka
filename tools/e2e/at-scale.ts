/**
 * AT SCALE — the world with a year of memories in it.
 *
 * ── WHY THIS HAD NEVER BEEN RUN ────────────────────────────────────────────
 *
 * Every gate in this repo walks a world holding a handful of things.
 * `journeys.ts` keeps five. `when-it-fails.ts` keeps five. `first-sixty.ts`
 * keeps one, on purpose. The largest field any instrument has ever put on
 * screen is about a dozen orbs.
 *
 * The person this product is FOR keeps memories for years. A field of five
 * and a field of five thousand are not the same program: the sim colours,
 * positions and draws every orb every frame, and nothing has ever asked what
 * that costs. A product that is delightful at twelve and unusable at eight
 * hundred is a demo.
 *
 * ── WHY IT SEEDS THE DATABASE DIRECTLY ─────────────────────────────────────
 *
 * Keeping a memory through the product enqueues derivation, and derivation is
 * a model call. Eight hundred keeps would be eight hundred calls against the
 * founder's own key to answer a question that is not about derivation at all.
 * So the rows go in through SQL, which is also the only way to make a field
 * that is a YEAR old rather than a minute old: `captured_at` is spread across
 * the past year, because the world's clock and its age channel both read it
 * and a thousand memories all captured in the same second is not a year's
 * worth of anything.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 *   pour        wall-clock from `goto` until the world says how much it holds
 *   fps         frames per second, sampled from `requestAnimationFrame`
 *   worst frame the longest single gap between frames — the number a person
 *               actually feels, which a mean hides completely
 *   heap        JS heap after the field settles, when the browser reports it
 *   reachable   can a memory still be opened at all
 *
 * Usage:
 *     pnpm dev:local                       # in another shell
 *     pnpm e2e:at-scale                    # 12, 200, 800
 *     pnpm e2e:at-scale --counts 5000
 *
 * Flags: `--base-url`, `--counts a,b,c`, `--headed`.
 */
import { chromium, type Browser, type Route } from "playwright";
import postgres from "postgres";

interface Args {
  baseUrl: string;
  counts: number[];
  headed: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", counts: [12, 200, 800], headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--counts") args.counts = take().split(",").map((n) => Number(n.trim()));
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:at-scale [--base-url <url>] [--counts 12,200,800] [--headed]");
      process.exit(0);
    } else {
      console.error(`[at-scale] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * STUB EVERY THIRD-PARTY ASSET — and this walk in particular cannot skip it.
 *
 * The page preconnects to `fonts.googleapis.com` and `cdn.jsdelivr.net`. On a
 * machine with no route to either they do not fail fast, they HANG, and the
 * document does not reach `domcontentloaded` until they give up.
 *
 * The first run of this file reported a pour of 13,092ms — at twelve memories,
 * at two hundred, at eight hundred and at two and a half thousand, within
 * fifty milliseconds each time. A number that does not move with the load is
 * not measuring the load. Breaking it down put twelve and a half of those
 * seconds BEFORE `domcontentloaded`, with every API call and the canvas
 * landing inside the next 250ms: the world was never slow, the font CDN was
 * unreachable, and this file was the only walk in the repo not stubbing it.
 */
async function stubExternals(ctx: import("playwright").BrowserContext, base: string): Promise<void> {
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

/**
 * The same connection string the API uses. Read from the environment rather
 * than written down: `.env.local` is gitignored and holds a model key beside
 * this, and a tool that hardcodes one secret's neighbour is one edit from
 * printing it.
 */
function connectionUrl(): string {
  const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[at-scale] DB_CONNECTION_URL is not set. This walk seeds the database\n" +
        "           directly — see the header for why — so it needs the same\n" +
        "           connection string the API uses:\n\n" +
        "             export $(grep DB_CONNECTION_URL .env.local | xargs)\n",
    );
    process.exit(2);
  }
  return url;
}

/** A year of things to have thought, so no two orbs carry the same words. */
const STEMS = [
  "the way the light came through the window at",
  "something someone said in passing about",
  "a decision I keep postponing regarding",
  "the reason I stopped going to",
  "what I actually meant when I said",
  "a pattern I notice every time I",
  "the difference between wanting and",
  "how long it takes me to admit",
];

async function seed(sql: postgres.Sql, profileId: string, count: number): Promise<void> {
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rows = Array.from({ length: count }, (_, i) => ({
    profile_id: profileId,
    text: `${STEMS[i % STEMS.length]} ${i} — ${uniq()}`,
    /* SPREAD ACROSS A YEAR, oldest first. The world's clock advances to the
       newest capture it has seen and the age channel reads the spread, so a
       thousand rows sharing one timestamp would measure a very crowded instant
       rather than a year of keeping things.

       The column is `created_at`; the client calls it `capturedMs`. Guessing
       the database used the client's name cost one run. */
    created_at: new Date(now - YEAR_MS + Math.floor((YEAR_MS * i) / count)),
  }));
  /* In chunks: one INSERT with several thousand rows exceeds the parameter
     limit, and the failure mode is an opaque protocol error. */
  for (let i = 0; i < rows.length; i += 500) {
    await sql`INSERT INTO inspirations ${sql(rows.slice(i, i + 500), "profile_id", "text", "created_at")}`;
  }
}

interface Reading {
  count: number;
  pourMs: number;
  fps: number;
  worstFrameMs: number;
  heapMb: number | null;
  reachable: boolean;
  /** The largest number the door prints — what the world claims to HOLD. */
  saidHolding: number;
  /** The door's sentence, whole. Kept because the verdict is about words. */
  doorText: string;
}

async function measure(browser: Browser, base: string, sql: postgres.Sql, count: number): Promise<Reading> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await stubExternals(ctx, base);
    const page = await ctx.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.click("#login-tab-signup");
    await page.fill("input[name=email]", `scale-${uniq()}@example.test`);
    await page.fill("input[name=password]", "at-scale-local-password-1");
    await page.fill("input[name=name]", "Archivist");
    await page.click("button[type=submit]");
    await page.waitForTimeout(6_000);

    const profileId = (await page.evaluate(() =>
      fetch("/api/auth/me", { credentials: "include" })
        .then((r) => r.json())
        .then((v) => v?.profile?.id ?? null),
    )) as string | null;
    if (!profileId) throw new Error("no profile id from /auth/me");

    await seed(sql, profileId, count);

    /* THE POUR, TIMED FROM THE NAVIGATION rather than from React's mount:
       what a person waits through includes the bundle, the boot fetches and
       the first frame, and timing only the last of those flatters it. */
    const started = Date.now();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    /* THE WHOLE SENTENCE, NOT THE FIRST NUMBER IN IT.
       This read one number and compared it to the seeded count, which was the
       right question asked in a way that could only survive one answer. The
       door now prints two when they differ — how many orbs are in the ground,
       and how many the archive holds — and a probe that took the first would
       report the honest sentence `2000 of 2500` as the same defect as the
       silent `2000` it replaced. What is being measured is whether the world
       tells the truth about its size, so the size is the LARGEST number the
       door names, and the sentence is carried out whole for the report. */
    let saidHolding = -1;
    let doorText = "";
    for (let i = 0; i < 120; i += 1) {
      doorText = (await page.evaluate(() => {
        const el = document.querySelector(".jar-saved-count");
        return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      })) as string;
      const numbers = [...doorText.matchAll(/(\d[\d,]*)/g)].map((m) =>
        Number(m[1]!.replace(/,/g, "")),
      );
      saidHolding = numbers.length > 0 ? Math.max(...numbers) : -1;
      if (saidHolding > 0) break;
      await page.waitForTimeout(500);
    }
    const pourMs = Date.now() - started;

    /* FRAMES, SAMPLED IN THE PAGE over four seconds of the field simply
       existing — no interaction, because the resting cost is the floor and
       everything a person does is added to it. */
    await page.waitForTimeout(2_000);
    /* AS A STRING, AND THAT IS NOT A STYLE CHOICE.
       A frame sampler has to call itself, and every way of naming a function
       inside `page.evaluate` — a `const` arrow, a declaration, a property
       assignment — is rewritten by esbuild's keep-names into a call to
       `__name`, which does not exist in the page. It fails as
       `ReferenceError: __name is not defined`, from a line that looks
       perfectly ordinary. A string is handed to the page verbatim and never
       transformed. `dead-css.ts` reached the same conclusion by the same
       route; this file rediscovered it, which is the fourth time in this
       session, so it is written down here too. */
    const frames = (await page.evaluate(`new Promise((resolve) => {
      var gaps = [];
      var last = performance.now();
      var until = last + 4000;
      requestAnimationFrame(function step(t) {
        gaps.push(t - last);
        last = t;
        if (t < until) requestAnimationFrame(step);
        else {
          var total = gaps.reduce(function (a, b) { return a + b; }, 0);
          resolve({
            fps: gaps.length === 0 ? 0 : Math.round((gaps.length / total) * 1000),
            worst: Math.round(Math.max.apply(null, gaps)),
          });
        }
      });
    })`)) as { fps: number; worst: number };

    const heap = (await page.evaluate(() => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
    })) as number | null;

    /* AND IS IT STILL A PRODUCT. A field nobody can open a memory in is not
       slow, it is broken, and the two are worth telling apart. */
    let reachable = false;
    try {
      await page.locator(".jar-saved").first().click({ timeout: 10_000 });
      await page.waitForTimeout(3_000);
      outer: for (const y of [390, 350, 430, 310, 470]) {
        for (let i = 0; i < 30; i += 1) {
          await page.mouse.click(160 + i * 28, y);
          await page.waitForTimeout(160);
          if ((await page.locator(".jar-panel").count()) > 0) {
            reachable = true;
            break outer;
          }
        }
      }
    } catch {
      reachable = false;
    }

    return {
      count,
      pourMs,
      fps: frames.fps,
      worstFrameMs: frames.worst,
      heapMb: heap,
      reachable,
      saidHolding,
      doorText,
    };
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sql = postgres(connectionUrl(), { max: 2 });
  console.log(
    "[at-scale] The field, at sizes nothing has ever put on screen. Rows are seeded\n" +
      "           straight into Postgres — derivation is a model call and this question\n" +
      "           is not about derivation — and spread across a year of captures.\n",
  );
  const browser = await chromium.launch({
    headless: !args.headed,
    executablePath: "/opt/pw-browsers/chromium",
  });
  const readings: Reading[] = [];
  try {
    for (const count of args.counts) {
      const r = await measure(browser, args.baseUrl, sql, count);
      readings.push(r);
      console.log(
        `  ${String(r.count).padStart(5)} memories   pour ${String(r.pourMs).padStart(6)}ms   ` +
          `${String(r.fps).padStart(3)} fps   worst frame ${String(r.worstFrameMs).padStart(5)}ms   ` +
          `heap ${r.heapMb === null ? "  n/a" : `${String(r.heapMb).padStart(4)}mb`}   ` +
          `${r.reachable ? "a memory opens" : "NOTHING OPENS"}`,
      );
      if (r.saidHolding !== r.count) {
        console.log(
          `        └─ SHORT AND SILENT: seeded ${r.count}, the door says "${r.doorText}"`,
        );
      } else if (/\bof\b/.test(r.doorText)) {
        /* The ceiling was reached and the door said so — the state this walk
           exists to distinguish from the one above, and the reason it prints
           on a pass. A number that matches is not the same as a sentence that
           is honest, and only one of the two is visible to a person. */
        console.log(`        └─ short, and says so: "${r.doorText}"`);
      }
    }
  } finally {
    await browser.close();
    await sql.end({ timeout: 5 });
  }

  const worst = readings[readings.length - 1]!;
  console.log(
    `\n[at-scale] From ${readings[0]!.count} to ${worst.count} memories: pour ` +
      `${readings[0]!.pourMs}ms → ${worst.pourMs}ms, ${readings[0]!.fps} → ${worst.fps} fps.`,
  );
  const broken = readings.filter((r) => !r.reachable);
  if (broken.length > 0) {
    console.log(
      `           At ${broken.map((r) => r.count).join(", ")} no memory could be opened at all.`,
    );
  }
  /* NOT A PASS/FAIL. There is no agreed budget yet, and inventing one here
     would be this file deciding a product question. It reports; the numbers
     and the founder decide what is acceptable. */
  process.exit(0);
}

main().catch((err) => {
  console.error("[at-scale] crashed:", err);
  process.exit(2);
});
