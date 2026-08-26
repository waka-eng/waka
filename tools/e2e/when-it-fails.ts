/**
 * WHEN IT FAILS — what the product SAYS when a press does not go through.
 *
 * ── WHY THIS IS NOT ALREADY COVERED BY `e2e:journeys --negative` ───────────
 *
 * `journeys.ts` runs every journey against its own sabotage and requires the
 * journey to FAIL. That is a real and load-bearing check, but it proves one
 * thing only: that the gate is not decoration. It asserts that the SUCCESS
 * text never appeared. It says nothing whatever about whether the person was
 * TOLD anything — a screen that swallows the failure in total silence passes
 * `--negative` perfectly, because silence is not success.
 *
 * So the two runs ask opposite questions of the same sabotage:
 *
 *     e2e:journeys --negative   did the success state correctly NOT appear?
 *     e2e:when-it-fails         did anything appear in its place?
 *
 * The second question is the product's own stated posture — no quiet corners.
 * A press that goes nowhere and says nothing is the quietest corner there is,
 * and it is invisible to every gate this repo had before this one.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * For each act: reach the surface with the network intact, snapshot every
 * visible line, break the ONE route that act rests on, press, wait for the
 * world to settle, snapshot again. Three readings come out of the diff:
 *
 *   SPEAKS   a new visible line appeared AND it names the failure.
 *   MURMURS  a new visible line appeared but nothing in it says anything
 *            went wrong — the person sees a change and must infer the rest.
 *   SILENT   no new visible line at all. The press produced nothing.
 *
 * And independently of what was said, one thing that matters more:
 *
 *   LIES     the thing acted on left the screen even though the server
 *            refused. The world now disagrees with the archive, and the
 *            person has no way to know which one is wrong.
 *
 * ── WHY THE CONTROLS ARE NOT OPTIONAL ──────────────────────────────────────
 *
 * Three acts in the table below are known to speak — the mouth's `keepIt`,
 * the panel's `forgetIt` and `submitGroup` each have a written failure line.
 * They are walked FIRST and their verdicts are checked: if a control reads
 * SILENT, the instrument is broken and the run aborts rather than reporting a
 * screenful of false findings. An audit tool that cannot detect the case it
 * is looking for produces its most convincing output when it is most wrong.
 *
 * Usage:
 *     pnpm dev:local                      # in another shell
 *     pnpm e2e:when-it-fails
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010), `--only <id>`,
 * `--headed`.
 */
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

/**
 * HOW THE ROUTE IS BROKEN. Three shapes, because `whyFailed` has three
 * branches and only one of them had ever run on screen.
 *
 *   500   the server answers, badly. The KIND reading: the promise rejects
 *         with an `ApiError` carrying a status, which is the case the client
 *         has the most excuse for handling well.
 *   drop  the connection dies. `ApiError` with status 0 — "the server could
 *         not be reached". An act that speaks under a 500 can still be silent
 *         here, because a thrown TypeError is not an ApiError.
 *   401   the session expired between opening the surface and pressing. The
 *         one failure kind that is also a security question: a person whose
 *         session died must not be left looking at what reads as success.
 */
type Kind = "500" | "drop" | "401";

interface Args {
  baseUrl: string;
  only: string | null;
  headed: boolean;
  kind: Kind;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", only: null, headed: false, kind: "500" };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--only") args.only = take();
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--kind") {
      const k = take();
      if (k !== "500" && k !== "drop" && k !== "401") {
        console.error(`[when-it-fails] --kind must be 500, drop or 401 (got ${k})`);
        process.exit(2);
      }
      args.kind = k;
    }
    else if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: pnpm e2e:when-it-fails [--base-url <url>] [--only <id>] [--kind 500|drop|401] [--headed]",
      );
      process.exit(0);
    } else {
      console.error(`[when-it-fails] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Reading the screen

/**
 * WHAT A PERSON COULD READ, SAMPLED RATHER THAN SNAPPED.
 *
 * The world's character speaks on a timer and clears itself after four
 * seconds, and the weather line rotates. A single `innerText` read before the
 * press and a single one after would report those rotations as "new text the
 * failure produced" — the exact false positive that would make this whole
 * instrument worthless.
 *
 * So both sides are a UNION OF SAMPLES over the same span of time. Anything
 * that merely rotates is present in both unions and cancels out of the diff.
 */
async function saidOverTime(page: Page, samples = 5, gapMs = 600): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < samples; i += 1) {
    const lines = (await page.evaluate(() =>
      (document.body.innerText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )) as string[];
    for (const line of lines) seen.add(line);
    if (i < samples - 1) await page.waitForTimeout(gapMs);
  }
  return seen;
}

/**
 * DOES THIS LINE SAY SOMETHING WENT WRONG?
 *
 * Deliberately generous: the product writes its failures in plain sentences
 * rather than in a house style, so this matches the shapes those sentences
 * take rather than a fixed vocabulary. Being generous here is the safe
 * direction — it can only ever move a finding from SPEAKS toward MURMURS if
 * it is too narrow, and this audit's whole point is to not overstate how much
 * the product says. A false SPEAKS is the expensive mistake; a false MURMUR
 * costs a second look at a line that is printed in the report anyway.
 */
const NAMES_A_FAILURE =
  /\b(could not|couldn.t|cannot|can.t|did not|didn.t|was not|wasn.t|is not|isn.t|not saved|no longer|still here|still live|still there|failed|unable|went wrong|try again|check the link|signed out|server said no|not reached|could not be reached|not recorded|not issued|not start)\b/i;

interface Reading {
  /** Lines on screen after the failure that were not on screen before it. */
  appeared: string[];
  /** Lines that were on screen before the failure and are gone after it. */
  vanished: string[];
  verdict: "SPEAKS" | "MURMURS" | "SILENT";
  /** Set when `intact` was given and the thing acted on left the screen. */
  lies: boolean;
}

function read(before: Set<string>, after: Set<string>, lies: boolean): Reading {
  const appeared = [...after].filter((l) => !before.has(l));
  const vanished = [...before].filter((l) => !after.has(l));
  const verdict =
    appeared.length === 0
      ? "SILENT"
      : appeared.some((l) => NAMES_A_FAILURE.test(l))
        ? "SPEAKS"
        : "MURMURS";
  return { appeared, vanished, verdict, lies };
}

// ---------------------------------------------------------------------------
// Shared helpers — the same shapes journeys.ts and dead-css.ts measured

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Stub every third-party asset so a CDN cannot color a reading. */
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

/**
 * BREAK ONE ROUTE, LEAVE THE REST ALONE — in one of three ways.
 *
 * A 500 was the only shape the first pass used, deliberately: it is the case
 * the client has the most excuse for handling well, so an act that stays
 * silent against it will certainly stay silent against anything worse. Having
 * fixed those, the two worse shapes are worth running, because they reach
 * branches of `whyFailed` that nothing had ever put on a screen.
 */
async function breakRoute(
  ctx: BrowserContext,
  match: (pathname: string, method: string) => boolean,
  kind: Kind,
): Promise<void> {
  await ctx.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (match(url.pathname, route.request().method())) {
        if (kind === "drop") return route.abort("connectionreset");
        if (kind === "401") {
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "session expired" }),
          });
        }
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "sabotaged by when-it-fails" }),
        });
      }
      return route.fallback();
    },
  );
}

const SIGNUP_PASSWORD = "when-it-fails-local-password-1";

async function signUp(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `fails-${uniq()}@example.test`);
  await page.fill("input[name=password]", SIGNUP_PASSWORD);
  await page.fill("input[name=name]", "Failure Walker");
  await page.click("button[type=submit]");
  await page.waitForTimeout(6_000);
}

/** Keep one memory, so the world has something in it to act on. */
async function keepOne(page: Page, base: string, text: string): Promise<void> {
  if (new URL(page.url()).pathname !== "/") {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
  }
  await page.locator(".jar-mouth-rest").first().click();
  await page.waitForTimeout(700);
  await page.fill('textarea[aria-label="capture inspiration"]', text);
  await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
  await page.waitForTimeout(5_000);
}

/**
 * MAKE A ROOM AND STAND IN IT.
 *
 * The chain and its two traps are measured, not guessed — both were found the
 * expensive way by the dead-css walk: choosing "a room" REPLACES the dialog
 * that offered it, and the submit is the unclassed words `make it`.
 */
async function makeRoom(page: Page, base: string, name: string): Promise<void> {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  await page.locator(".jar-here-more").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await page.locator(".jar-here-row--make").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await page.locator(".jar-newplace-row").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await page.locator(".jar-roomform-box").first().fill(name, { timeout: 8_000 });
  await page.locator(".jar-roomform button", { hasText: /^make it$/i }).first().click({
    timeout: 8_000,
  });
  await page.waitForTimeout(7_000);
}

/**
 * OPEN A MEMORY, WHICH MEANS FINDING ITS ORB.
 *
 * The sweep and its bounds are journeys.ts's, unchanged, and so is the reason
 * the callers keep FIVE memories before calling it: one orb on a whole field
 * is a needle, and a walk that cannot find one reports the product as broken
 * when the only broken thing was the aim.
 */
async function openAMemory(page: Page): Promise<boolean> {
  try {
    await page.locator(".jar-saved").first().click({ timeout: 20_000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(4_000);
  for (const y of [390, 350, 430, 310, 470, 270, 510, 230, 550]) {
    for (let i = 0; i < 28; i += 1) {
      await page.mouse.click(160 + i * 28, y);
      await page.waitForTimeout(500);
      if ((await page.locator(".jar-panel").count()) === 0) continue;
      await page.waitForTimeout(1_200);
      if ((await page.locator(".jar-panel").count()) > 0) return true;
    }
  }
  return false;
}

/**
 * MAKING A ROOM DOES NOT PUT YOU IN IT.
 *
 * Measured, after three acts read NOT WALKED against selectors that were on
 * screen: a new room appears as a way to the RIGHT (`.jar-way--r`) and the
 * world stays standing on the personal wall. So `.jar-here` — the one door
 * into a wall's own panel — was opening ME's panel, which has no room verbs
 * in it at all, and the walk was looking for `leave this room` on a surface
 * that correctly never offers it.
 *
 * Travel first, then open. The room's panel carries `rename`,
 * `copy the invite link`, `leave this room` and `close this room`.
 */
async function standInTheRoom(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.locator(".jar-way--r").first().click({ timeout: 8_000 });
  await page.waitForTimeout(4_000);
  await page.locator(".jar-here").first().click({ timeout: 8_000 });
  await page.waitForTimeout(1_400);
}

// ---------------------------------------------------------------------------
// The acts

interface Act {
  id: string;
  /** Reads as a sentence about the person, not about the code. */
  name: string;
  /**
   * A control is an act with a WRITTEN failure line. If one of these reads
   * SILENT the instrument is lying and the run stops.
   */
  control?: boolean;
  /** The one route this act rests on. */
  breaks: (pathname: string, method: string) => boolean;
  /** Get to the surface with the network intact. */
  reach: (page: Page, base: string) => Promise<void>;
  /** The press itself, with the route already broken. */
  press: (page: Page) => Promise<void>;
  /**
   * A line that must STILL be on screen once the failure has settled. The
   * server refused, so whatever was acted on is still in the archive; if it
   * has left the screen the world is telling the person something untrue.
   */
  intact?: () => string;
}

/** Room names are generated per run and read back by two hooks. */
let roomName = "";

const ACTS: Act[] = [
  // ---- controls: acts already known to speak ----------------------------
  {
    id: "keep",
    name: "saying something into the mouth, and the save refuses",
    control: true,
    breaks: (p, m) => p === "/api/inspirations" && m === "POST",
    reach: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
      await page.locator(".jar-mouth-rest").first().click();
      await page.waitForTimeout(700);
      await page.fill('textarea[aria-label="capture inspiration"]', "a thought the server will refuse");
    },
    press: async (page) => {
      await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
    },
  },
  {
    id: "forget",
    name: "letting a memory go, and the delete refuses",
    control: true,
    breaks: (p, m) => /^\/api\/inspirations\//.test(p) && m === "DELETE",
    reach: async (page, base) => {
      /* FIVE, for the same reason journeys.ts keeps five: the sweep has to
         land on an orb, and one orb on a whole field is a needle. */
      for (let i = 0; i < 5; i += 1) {
        await keepOne(page, base, `a memory this walk may delete ${i} ${uniq()}`);
      }
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      if (!(await openAMemory(page))) throw new Error("no memory would open in the field");
    },
    press: async (page) => {
      await page.locator(".jar-panel button", { hasText: /^delete$/ }).first().click({
        timeout: 8_000,
      });
      await page.waitForTimeout(2_000);
      /* Deleting asks only when a signal stands on the memory. When it does,
         the ask must be walked through or no DELETE is ever sent — journeys.ts
         reported a working delete as broken for exactly this reason. */
      const anyway = page.locator(".jar-forget-ask button", { hasText: /delete it anyway/i });
      if (await anyway.count()) await anyway.first().click();
    },
  },
  {
    id: "make-room",
    name: "making a room, and the server refuses",
    control: true,
    breaks: (p, m) => p === "/api/groups" && m === "POST",
    reach: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
      await page.locator(".jar-here-more").first().click({ timeout: 8_000 });
      await page.waitForTimeout(900);
      await page.locator(".jar-here-row--make").first().click({ timeout: 8_000 });
      await page.waitForTimeout(900);
      await page.locator(".jar-newplace-row").first().click({ timeout: 8_000 });
      await page.waitForTimeout(900);
      await page.locator(".jar-roomform-box").first().fill("a room the server refuses", {
        timeout: 8_000,
      });
    },
    press: async (page) => {
      await page.locator(".jar-roomform button", { hasText: /^make it$/i }).first().click({
        timeout: 8_000,
      });
    },
  },

  // ---- the room's maintenance verbs -------------------------------------
  {
    id: "rename-room",
    name: "renaming a room, and the rename refuses",
    breaks: (p, m) => /^\/api\/groups\/[^/]+$/.test(p) && m === "PATCH",
    reach: async (page, base) => {
      roomName = `rename me ${uniq().slice(-6)}`;
      await makeRoom(page, base, roomName);
      await standInTheRoom(page);
      await page.locator(".jar-settings button", { hasText: /^rename$/i }).first().click({
        timeout: 8_000,
      });
      await page.waitForTimeout(900);
      await page
        .locator(".jar-settings input, .jar-settings textarea")
        .first()
        .fill("a name it will not keep", { timeout: 8_000 });
    },
    press: async (page) => {
      await page.locator(".jar-settings button", { hasText: /^rename it$/i }).first().click({ timeout: 8_000 });
    },
    intact: () => roomName,
  },
  {
    id: "leave-room",
    name: "leaving a room, and the leave refuses",
    breaks: (p, m) => /^\/api\/groups\/[^/]+\/leave$/.test(p) && m === "POST",
    reach: async (page, base) => {
      roomName = `leave me ${uniq().slice(-6)}`;
      await makeRoom(page, base, roomName);
      await standInTheRoom(page);
      await page.locator(".jar-settings button", { hasText: /^leave this room$/i }).first().click({
        timeout: 8_000,
      });
      await page.waitForTimeout(900);
    },
    press: async (page) => {
      await page.locator(".jar-settings button", { hasText: /^leave — your statements come down$/i }).first().click({
        timeout: 8_000,
      });
    },
    intact: () => roomName,
  },
  {
    id: "close-room",
    name: "closing a room for everyone, and the close refuses",
    breaks: (p, m) => /^\/api\/groups\/[^/]+$/.test(p) && m === "DELETE",
    reach: async (page, base) => {
      roomName = `close me ${uniq().slice(-6)}`;
      await makeRoom(page, base, roomName);
      await standInTheRoom(page);
      await page.locator(".jar-settings button", { hasText: /^close this room$/i }).first().click({
        timeout: 8_000,
      });
      await page.waitForTimeout(900);
    },
    press: async (page) => {
      await page
        .locator(".jar-settings button", {
          hasText: /^close it for everyone — what the room decided goes too$/i,
        })
        .first()
        .click({ timeout: 8_000 });
    },
    intact: () => roomName,
  },
];

// ---------------------------------------------------------------------------

async function walk(browser: Browser, base: string, act: Act, kind: Kind): Promise<Reading> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await stubExternals(ctx, base);
    const page = await ctx.newPage();
    await signUp(page, base);
    await act.reach(page, base);

    /* READ THE SCREEN BEFORE BREAKING ANYTHING, so the diff is caused by the
       failure and not by having arrived at the surface. */
    const before = await saidOverTime(page);

    await breakRoute(ctx, act.breaks, kind);
    await act.press(page);

    /* LONG ENOUGH FOR THE WORLD TO HAVE SAID IT AND NOT YET CLEARED IT. The
       character's voice lasts four seconds; the samples straddle that. */
    await page.waitForTimeout(1_200);
    const after = await saidOverTime(page);

    /* CASE-INSENSITIVE, AND THAT IS NOT A CONVENIENCE.
       `innerText` respects `text-transform`, and the label register uppercases
       every wall's name — so a case-sensitive check looked for
       `rename me 631299` on a screen showing `RENAME ME 631299` and reported
       the product as having thrown the room off screen. It had not. The first
       run of this file produced exactly that false LIES, and the only reason
       it was caught is that the finding was probed rather than believed. */
    const wanted = act.intact?.()?.toLowerCase();
    const lies =
      wanted !== undefined && ![...after].some((l) => l.toLowerCase().includes(wanted));
    return read(before, after, lies);
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const acts = args.only ? ACTS.filter((a) => a.id === args.only) : ACTS;
  if (acts.length === 0) {
    console.error(`[when-it-fails] no act with id ${args.only}`);
    process.exit(2);
  }

  const HOW: Record<Kind, string> = {
    "500": "a 500 on",
    drop: "a dropped connection on",
    "401": "an expired session on",
  };
  console.log(
    `[when-it-fails] Every act below is pressed against ${HOW[args.kind]} the one route it rests on.\n` +
      "                The question is not whether it failed — it is whether anything said so.\n",
  );

  const browser = await chromium.launch({
    headless: !args.headed,
    executablePath: "/opt/pw-browsers/chromium",
  });
  const results: Array<{ act: Act; reading: Reading | null; error: string | null }> = [];
  try {
    for (const act of acts) {
      let reading: Reading | null = null;
      let error: string | null = null;
      try {
        reading = await walk(browser, args.baseUrl, act, args.kind);
      } catch (err) {
        error = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      }
      const mark = error
        ? "NOT WALKED"
        : reading!.lies
          ? `${reading!.verdict} + LIES`
          : reading!.verdict;
      console.log(`  ${act.id.padEnd(13)} ${mark.padEnd(16)} ${act.name}`);
      if (error) console.log(`                 └─ ${error}`);
      else {
        for (const line of reading!.appeared.slice(0, 4)) {
          console.log(`                 └─ said: ${JSON.stringify(line.slice(0, 100))}`);
        }
        if (reading!.lies) {
          console.log(
            `                 └─ GONE FROM SCREEN though the server refused: ${JSON.stringify(act.intact!())}`,
          );
        }
      }
      results.push({ act, reading, error });
    }
  } finally {
    await browser.close();
  }

  /* THE CONTROLS DECIDE WHETHER ANY OF THIS COUNTS. */
  const controls = results.filter((r) => r.act.control);
  const mute = controls.filter((r) => r.reading?.verdict === "SILENT");
  if (controls.length > 0 && mute.length === controls.length) {
    console.log(
      "\n[when-it-fails] EVERY CONTROL READ SILENT. These acts have written failure lines,\n" +
        "                so the instrument is not reading the screen — not the product.\n" +
        "                Reporting nothing rather than reporting nonsense.",
    );
    process.exit(3);
  }

  const walked = results.filter((r) => r.reading !== null);
  const silent = walked.filter((r) => r.reading!.verdict === "SILENT");
  const murmur = walked.filter((r) => r.reading!.verdict === "MURMURS");
  const lying = walked.filter((r) => r.reading!.lies);
  console.log(
    `\n[when-it-fails] ${walked.length} acts pressed against a refusal — ` +
      `${walked.length - silent.length - murmur.length} said what went wrong, ` +
      `${murmur.length} changed without saying, ${silent.length} said nothing.`,
  );
  if (lying.length > 0) {
    console.log(
      `                ${lying.length} took the thing off screen anyway: ${lying
        .map((r) => r.act.id)
        .join(", ")}`,
    );
  }
  process.exit(silent.length + murmur.length + lying.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[when-it-fails] crashed:", err);
  process.exit(2);
});
