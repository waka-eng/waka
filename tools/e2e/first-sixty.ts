/**
 * THE FIRST SIXTY SECONDS — an account with nothing in it.
 *
 * ── THE SURFACE NOTHING HAS EVER MEASURED ──────────────────────────────────
 *
 * Every instrument in this repo walks a world that already has things in it.
 * `journeys.ts` signs up and immediately keeps five memories. `dead-css.ts`
 * makes a room before it can walk one, and says so in its own comment: *"a
 * fresh account has none, and every selector belonging to a room read as dead
 * for exactly that reason."* `when-it-fails.ts` keeps five memories to have
 * one to delete.
 *
 * Every one of them treats the empty account as a step to get past.
 *
 * It is the one screen every single person sees, without exception, before
 * they see any other. And the product's own posture — no quiet corners —
 * is at its hardest here, because an empty world has nothing to show and the
 * easiest thing to render is nothing.
 *
 * The two gates whose names sound like they cover this do not:
 *
 *   e2e:first-paint   does the world render at all with every CDN blocked?
 *                     Infrastructure. Says nothing about what it renders.
 *   e2e:cold-start    does the pipeline synthesise a top of mind from four
 *                     unrelated thoughts? API-level, no browser, and it
 *                     starts by saving four things — so not empty.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * Sign up. Create NOTHING. Walk every surface an empty account can reach and
 * ask, of each: does this say anything to a person who has never been here?
 *
 *   SAYS    at least one line of prose — a sentence, not a label.
 *   BARE    controls and labels, no sentence. A person sees furniture and is
 *           left to infer the product from it.
 *   BLANK   nothing visible at all. The quietest corner there is.
 *
 * PROSE IS TOLD FROM FURNITURE BY ITS CASE, and that is not a heuristic
 * borrowed from elsewhere — it is a fact about this product. The label
 * register applies `text-transform: uppercase` to every label class, and
 * `innerText` respects `text-transform`. So an uppercase line IS a label, by
 * construction, and a line with lowercase in it is something written to be
 * read. (Learned the hard way: `when-it-fails` first reported a false finding
 * by comparing a room's name case-sensitively against its uppercased self.)
 *
 * A word count on top of that, because `now` and `close` are lowercase and
 * are still furniture.
 *
 * Usage:
 *     pnpm dev:local          # in another shell
 *     pnpm e2e:first-sixty
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010), `--headed`.
 */
import { chromium, type BrowserContext, type Page, type Route } from "playwright";

interface Args {
  baseUrl: string;
  headed: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:first-sixty [--base-url <url>] [--headed]");
      process.exit(0);
    } else {
      console.error(`[first-sixty] unknown option ${flag}`);
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

async function signUp(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `first-${uniq()}@example.test`);
  await page.fill("input[name=password]", "first-sixty-local-password-1");
  await page.fill("input[name=name]", "Newcomer");
  await page.click("button[type=submit]");
  await page.waitForTimeout(7_000);
}

/**
 * WHAT IS ON SCREEN, SAMPLED — the world's character speaks on a timer and
 * clears after four seconds, so a single read can miss the one sentence an
 * empty world says, or catch a rotation and call it prose. Same union of
 * samples `when-it-fails` uses, and for the same reason.
 */
async function visibleLines(page: Page, samples = 4, gapMs = 700): Promise<string[]> {
  const seen = new Set<string>();
  for (let i = 0; i < samples; i += 1) {
    const lines = (await page.evaluate(() => {
      const text = (document.body.innerText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      /* A PLACEHOLDER IS SOMETHING A PERSON READS, and `innerText` does not
         contain one. Without this the mouth — the one thing the product is
         FOR — reads as an empty box with three labels round it, and this walk
         would have reported the product's primary surface as saying nothing
         while a sentence sat inside it.

         Caught before it was written down, by asking why the most important
         surface in the product scored worst. The rule that keeps paying: when
         a measurement makes the product look worse than a person's experience
         of it, suspect the instrument first. */
      for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const ph = (el as HTMLInputElement).placeholder;
        if (ph && ph.trim()) text.push(ph.trim());
      }
      return text;
    })) as string[];
    for (const line of lines) seen.add(line);
    if (i < samples - 1) await page.waitForTimeout(gapMs);
  }
  return [...seen];
}

/**
 * IS THIS A SENTENCE, OR A LABEL?
 *
 * Uppercase means label BY CONSTRUCTION here — the register uppercases every
 * label class and `innerText` respects `text-transform`. The word count
 * catches the rest: `now`, `close` and `rename` are lowercase furniture.
 *
 * Four words rather than three, because `nothing adopted yet` is three and is
 * genuinely a label under a heading rather than something written to a
 * person. Set deliberately strict: this walk exists to find surfaces that say
 * too little, and a generous reading of "prose" would hide exactly that.
 */
function isProse(line: string): boolean {
  if (!/[a-z]/.test(line)) return false;
  /* PUNCTUATION IS NOT A WORD, and the first run needed telling.
     `Forming — nothing adopted yet` counted the em dash and reached four;
     `how it reads you · the antechamber` is a ROW OF LINKS joined by a middle
     dot, and read as one sentence. Both scored SAYS, and both are furniture.

     That is the expensive direction for this walk specifically: it exists to
     find surfaces that say too little, so a classifier that is generous about
     what counts as prose hides the exact thing being looked for. Separators
     come out before anything is counted. */
  const words = line
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w))
    .filter((w) => w !== "·");
  if (words.length < 4) return false;
  /* A LINE OF LINKS IS STILL A LINE OF LINKS however many words are in it.
     The middle dot is this product's separator for a row of verbs — the room
     panel's `leave · stay`, the settings sheet's list of places to go. */
  return !line.includes("·");
}

/** Every control a person could press, with the words on it. */
async function controls(page: Page): Promise<string[]> {
  return (await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href], input, textarea"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled;
      })
      .map((el) => (el.textContent || "").trim() || `<${el.tagName.toLowerCase()}>`),
  )) as string[];
}

interface Surface {
  name: string;
  /** Reach it from a freshly loaded, EMPTY world. Throws if it is not there. */
  open: (page: Page, base: string) => Promise<void>;
}

/**
 * Every surface an account with nothing in it can reach.
 *
 * Deliberately NOT the full `dead-css` list: the room's own wall, the memory
 * panel and the board's poster cannot be reached without making something,
 * and a walk that made something to reach them would no longer be measuring
 * an empty account. Their absence from this list is itself part of the
 * reading — see what the run prints about `.jar-saved`.
 */
const SURFACES: Surface[] = [
  {
    name: "the world, just arrived",
    open: async () => {
      /* nothing: this is where signing up leaves you */
    },
  },
  {
    name: "the mouth, opened",
    open: async (page) => {
      await page.locator(".jar-mouth-rest").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_000);
    },
  },
  {
    name: "your own wall's panel",
    open: async (page) => {
      await page.locator(".jar-here").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_200);
    },
  },
  {
    name: "the walls list",
    open: async (page) => {
      await page.locator(".jar-here-more").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_000);
    },
  },
  {
    name: "make another place",
    open: async (page) => {
      await page.locator(".jar-here-more").first().click({ timeout: 8_000 });
      await page.waitForTimeout(800);
      await page.locator(".jar-here-row--make").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_000);
    },
  },
  {
    name: "the timeline",
    open: async (page) => {
      await page.locator(".jar-when").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_400);
    },
  },
  {
    name: "philosophies & values",
    open: async (page) => {
      await page.locator(".jar-values").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_400);
    },
  },
  {
    name: "your settings",
    open: async (page) => {
      await page.locator(".jar-account").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_600);
    },
  },
  {
    name: "the archive door",
    open: async (page) => {
      await page.locator(".jar-saved").first().click({ timeout: 6_000 });
      await page.waitForTimeout(2_500);
    },
  },
];

interface Reading {
  name: string;
  verdict: "SAYS" | "BARE" | "BLANK" | "NOT THERE";
  prose: string[];
  controlCount: number;
  detail: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    "[first-sixty] An account with nothing in it. Nothing is created at any point.\n" +
      "              Of each surface: does it say anything to someone who has never been here?\n",
  );

  const browser = await chromium.launch({
    headless: !args.headed,
    executablePath: "/opt/pw-browsers/chromium",
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const readings: Reading[] = [];
  try {
    await stubExternals(ctx, args.baseUrl);
    const page = await ctx.newPage();
    await signUp(page, args.baseUrl);

    /* WHAT THE WORLD SAYS BEFORE ANYTHING IS TOUCHED, held aside so every
       later surface can be reported on what IT added rather than on the
       backdrop it is drawn over. Without this the topbar's words would make
       every panel look like it said something. */
    const backdrop = new Set(await visibleLines(page));

    for (const surface of SURFACES) {
      /* FROM A FRESH LOAD EVERY TIME. The same lesson dead-css paid for: a
         surface left standing by the previous one is state this walk cannot
         reason about, and Escape was measurably not enough. */
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);

      let detail = "";
      try {
        await surface.open(page, args.baseUrl);
      } catch (err) {
        readings.push({
          name: surface.name,
          verdict: "NOT THERE",
          prose: [],
          controlCount: 0,
          detail: err instanceof Error ? err.message.split("\n")[0]! : String(err),
        });
        continue;
      }

      const lines = await visibleLines(page);
      const own = surface.name === "the world, just arrived" ? lines : lines.filter((l) => !backdrop.has(l));
      const prose = own.filter(isProse);
      const controlCount = (await controls(page)).length;
      const verdict =
        own.length === 0 ? "BLANK" : prose.length > 0 ? "SAYS" : "BARE";
      if (verdict === "BARE") detail = own.slice(0, 6).join(" · ");
      readings.push({ name: surface.name, verdict, prose, controlCount, detail });
    }
  } finally {
    await browser.close();
  }

  for (const r of readings) {
    console.log(`  ${r.name.padEnd(26)} ${r.verdict.padEnd(10)} ${r.controlCount} controls`);
    for (const line of r.prose.slice(0, 3)) {
      console.log(`      says: ${JSON.stringify(line.slice(0, 96))}`);
    }
    if (r.detail) console.log(`      ${r.verdict === "NOT THERE" ? "why: " : "only: "}${r.detail.slice(0, 110)}`);
  }

  const says = readings.filter((r) => r.verdict === "SAYS");
  const bare = readings.filter((r) => r.verdict === "BARE");
  const blank = readings.filter((r) => r.verdict === "BLANK");
  const absent = readings.filter((r) => r.verdict === "NOT THERE");
  console.log(
    `\n[first-sixty] ${readings.length} surfaces an empty account can reach — ` +
      `${says.length} say something, ${bare.length} show only furniture, ` +
      `${blank.length} are blank, ${absent.length} are not reachable at all.`,
  );
  process.exit(bare.length + blank.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[first-sixty] crashed:", err);
  process.exit(2);
});
