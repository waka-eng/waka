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

/**
 * TWO EMPTIES, NOT ONE.
 *
 *   empty  signed up, nothing created. The screen every person sees first.
 *   kept   ONE memory saved and nothing else. The person did the single thing
 *          the product asked, and now decides whether to come back.
 *
 * The second is not a smaller version of the first. `docs/generation.md` puts
 * promotion at three pieces of evidence, so after one save nothing has formed
 * and nothing CAN have — the question is whether the product says so, or
 * whether it looks identical to a product that is broken.
 *
 * One memory, deliberately, and not the five `journeys.ts` keeps to make its
 * orb sweep land. Keeping five to make the walk easier would measure a state
 * no real person passes through.
 */
type Stage = "empty" | "kept";

interface Args {
  baseUrl: string;
  headed: boolean;
  stage: Stage;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", headed: false, stage: "empty" };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--stage") {
      const v = take();
      if (v !== "empty" && v !== "kept") {
        console.error(`[first-sixty] --stage must be empty or kept (got ${v})`);
        process.exit(2);
      }
      args.stage = v;
    }
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:first-sixty [--base-url <url>] [--stage empty|kept] [--headed]");
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
  /** Reach it from a freshly loaded world. Throws if it is not there. */
  open: (page: Page, base: string) => Promise<void>;
  /** Which stages this surface is walked in. Both, unless it says otherwise. */
  stages?: Stage[];
}

/** Say one thing into the mouth. The whole of what the `kept` stage does. */
async function keepOne(page: Page, base: string, text: string): Promise<void> {
  if (new URL(page.url()).pathname !== "/") {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
  }
  await page.locator(".jar-mouth-rest").first().click({ timeout: 8_000 });
  await page.waitForTimeout(800);
  await page.fill('textarea[aria-label="capture inspiration"]', text);
  await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click({
    timeout: 8_000,
  });
}

/**
 * OPEN THE ONE MEMORY THERE IS, BY FINDING ITS ORB.
 *
 * `journeys.ts` keeps FIVE before it sweeps, and says why: one orb on a whole
 * field is a needle. This stage has exactly one on purpose, so the sweep may
 * legitimately fail to land — and if it does, that is the WALK missing, not
 * the product hiding anything. Reported as `NOT AIMED` rather than
 * `NOT THERE`, because the two mean opposite things and conflating them would
 * turn a limitation of this file into a finding about the product.
 */
async function openTheMemory(page: Page): Promise<boolean> {
  try {
    await page.locator(".jar-saved").first().click({ timeout: 10_000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(4_000);
  for (const y of [390, 350, 430, 310, 470, 270, 510, 230, 550, 590]) {
    for (let i = 0; i < 34; i += 1) {
      await page.mouse.click(140 + i * 26, y);
      await page.waitForTimeout(220);
      if ((await page.locator(".jar-panel").count()) === 0) continue;
      await page.waitForTimeout(1_000);
      if ((await page.locator(".jar-panel").count()) > 0) return true;
    }
  }
  return false;
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
  {
    name: "the one memory, opened",
    stages: ["kept"],
    open: async (page) => {
      if (!(await openTheMemory(page))) throw new Error("NOT AIMED");
    },
  },
];

interface Reading {
  name: string;
  /**
   * `NOT THERE` means the surface does not exist for this account.
   * `NOT AIMED` means THIS FILE could not reach it — a different claim
   * entirely, and one that is about the walk rather than about the product.
   */
  verdict: "SAYS" | "BARE" | "BLANK" | "NOT THERE" | "NOT AIMED";
  prose: string[];
  controlCount: number;
  detail: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    args.stage === "empty"
      ? "[first-sixty] An account with nothing in it. Nothing is created at any point.\n" +
          "              Of each surface: does it say anything to someone who has never been here?\n"
      : "[first-sixty] ONE memory kept, and nothing else. Promotion needs three pieces of\n" +
          "              evidence, so nothing has formed and nothing can have yet. Does the\n" +
          "              product say so, or does it look like a product that is broken?\n",
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

    if (args.stage === "kept") {
      /* THE ONE READING A RELOAD CANNOT TAKE.
         The world's acknowledgement of a save is spoken by the character and
         clears itself after four seconds. It is also the single most important
         sentence in the product's first minute — it is the only evidence a
         person has that the thing they typed went anywhere. Every other
         surface below is walked from a fresh load; this one has to be caught
         where it happens, diffed against the empty world it replaced. */
      const beforeSave = new Set(await visibleLines(page, 3, 500));
      await keepOne(page, args.baseUrl, "I cancelled dinner again tonight and felt relieved rather than sorry.");
      /* LONG ENOUGH TO OUTLAST THE DERIVATION, which is the whole point of
         this stage. The client waits `DERIVATION_SETTLE_MS` (6s) after a keep
         before asking the board what it says now, and the answer lands around
         eight seconds in. A four-second window read the world before its one
         real answer arrived and called it BARE — measuring the walk's
         patience rather than the product's.

         A REALISTIC SENTENCE, TOO. This said "the first thing I ever said to
         this" — a remark about the app, which no person types — and the model
         built a confident claim about the person's RELATIONSHIPS out of it.
         That looked like a serious finding for about a minute. Run against
         three sentences a person might actually write, every derivation was
         grounded in what was said. An input nobody would give produces an
         output nobody should be shown, and reporting the second without
         noticing the first would have been the worst mistake available. */
      const afterSave = await visibleLines(page, 12, 1_200);
      const said = afterSave.filter((l) => !beforeSave.has(l));
      const prose = said.filter(isProse);
      readings.push({
        name: "the moment after the first save",
        verdict: said.length === 0 ? "BLANK" : prose.length > 0 ? "SAYS" : "BARE",
        prose,
        controlCount: (await controls(page)).length,
        detail: prose.length === 0 ? said.slice(0, 6).join(" · ") : "",
      });
      await page.waitForTimeout(3_000);
    }

    /* WHAT THE WORLD SAYS BEFORE ANY SURFACE IS OPENED, held aside so every
       later surface can be reported on what IT added rather than on the
       backdrop it is drawn over. Without this the topbar's words would make
       every panel look like it said something.

       Taken AFTER the stage's setup, so in `kept` the backdrop is the world
       with one memory in it — otherwise the archive door's own count would be
       reported as something the archive door said. */
    await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
    const backdrop = new Set(await visibleLines(page));

    for (const surface of SURFACES) {
      if (surface.stages && !surface.stages.includes(args.stage)) continue;
      /* FROM A FRESH LOAD EVERY TIME. The same lesson dead-css paid for: a
         surface left standing by the previous one is state this walk cannot
         reason about, and Escape was measurably not enough. */
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);

      let detail = "";
      try {
        await surface.open(page, args.baseUrl);
      } catch (err) {
        const why = err instanceof Error ? err.message.split("\n")[0]! : String(err);
        readings.push({
          name: surface.name,
          /* THE WALK MISSING IS NOT THE PRODUCT HIDING. `NOT AIMED` is thrown
             by a reach that knows it failed to aim — the orb sweep — and must
             never be read as a statement about what exists. */
          verdict: why === "NOT AIMED" ? "NOT AIMED" : "NOT THERE",
          prose: [],
          controlCount: 0,
          detail: why,
        });
        continue;
      }

      const lines = await visibleLines(page);
      const own =
        surface.name === "the world, just arrived" ? lines : lines.filter((l) => !backdrop.has(l));
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
  const unaimed = readings.filter((r) => r.verdict === "NOT AIMED");
  console.log(
    `\n[first-sixty] stage=${args.stage}: ${readings.length} surfaces walked — ` +
      `${says.length} say something, ${bare.length} show only furniture, ` +
      `${blank.length} are blank, ${absent.length} do not exist for this account.`,
  );
  if (unaimed.length > 0) {
    console.log(
      `              ${unaimed.length} the walk could not aim at — a limit of this file, ` +
        `not a reading: ${unaimed.map((r) => r.name).join(", ")}`,
    );
  }
  /* NOT AIMED is deliberately NOT a failure: it says this walk could not
     reach something, which is a reason to improve the walk rather than a
     verdict about the product. */
  process.exit(bare.length + blank.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[first-sixty] crashed:", err);
  process.exit(2);
});
