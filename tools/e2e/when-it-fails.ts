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
 * TWO acts in the table below are known to speak — the mouth's `keepIt` and
 * the panel's `forgetIt` each have a written failure line. They are walked
 * FIRST and their verdicts are checked: if a control reads SILENT, the
 * instrument is broken and the run aborts rather than reporting a screenful
 * of false findings. An audit tool that cannot detect the case it is looking
 * for produces its most convincing output when it is most wrong.
 *
 * IT WAS THREE UNTIL 2026-10-15. The third was `submitGroup` — making a room
 * — and rooms came out in `405ee4aa`. A control that cannot be reached does
 * not fail quietly: it aborts the run, so one dead act was suppressing every
 * other act's finding. See the tombstone in the table.
 *
 * Usage:
 *     pnpm dev:local                      # in another shell
 *     pnpm e2e:when-it-fails
 *
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010), `--only <id>`,
 * `--headed`.
 */
import { type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { launchChromium } from "./browser";
import { saveAnInspiration } from "./keep";
import { openAMemory } from "./open-a-memory";
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
  /** How many times the press reached the route this act rests on. */
  hits: number;
}

function read(before: Set<string>, after: Set<string>, lies: boolean, hits: number): Reading {
  const appeared = [...after].filter((l) => !before.has(l));
  const vanished = [...before].filter((l) => !after.has(l));
  const verdict =
    appeared.length === 0
      ? "SILENT"
      : appeared.some((l) => NAMES_A_FAILURE.test(l))
        ? "SPEAKS"
        : "MURMURS";
  return { appeared, vanished, verdict, lies, hits };
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
): Promise<{ hits: number }> {
  /* HOW MANY TIMES THE ACT ACTUALLY REACHED THE ROUTE IT RESTS ON.
     Without this the walk cannot tell "the act failed and the world spoke"
     from "the act never happened and something else was on screen" — and it
     would report the second as the first, which is the most convincing wrong
     answer an audit tool can give. Counted here because this is the only
     place that knows the request was refused. */
  const seen = { hits: 0 };
  await ctx.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (match(url.pathname, route.request().method())) {
        seen.hits += 1;
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
  return seen;
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
  await saveAnInspiration(page, text);
  await page.waitForTimeout(5_000);
}

/* ═══ `makeRoom` AND `standInTheRoom` ARE GONE WITH THE ROOMS THEY MADE ═══
   Both chains were `.jar-here-more` → `.jar-here-row--make` →
   `.jar-newplace-row` → `.jar-roomform`, and `.jar-way--r` → `.jar-here`.
   Every one of those classes lost its renderer in `405ee4aa` ("rooms come
   out") — several had lost it before, when `.jar-here-list` was deleted on
   2026-10-09 and took the wall chip with it. What they built cannot be
   built: room CREATION was already gone before the removal started.

   The five acts that stood on them are deleted below, each with what went. */

/* `openAMemory` LIVES IN `./open-a-memory` NOW (2026-10-15). This file had
   its own copy, still on the dead `.jar-saved` sweep, while `journeys.ts`
   had a working one — the duplication is what let one rot unnoticed. */

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

const ACTS: Act[] = [
  // ---- controls: acts already known to speak ----------------------------
  {
    id: "keep",
    name: "saying something into the mouth, and the save refuses",
    control: true,
    /* ═══ THIS ACT HAD NO `press`, AND IT IS THE FIRST CONTROL ════════════
       Two faults in one object, found by a typecheck (`Property 'press' is
       missing in type ... but required in type 'Act'`) and confirmed by
       reading `walk`:

       1. `walk` calls `await act.press(page)` unconditionally, so this act
          threw `act.press is not a function` the moment it was walked. The
          FIRST control in the table could not complete, and a control that
          cannot complete stops the run — so the whole file reported nothing
          rather than reporting one broken act.
       2. Worse, and the reason the missing `press` was not obvious: the save
          was in `reach`, which runs BEFORE `breakRoute`. So even with a
          `press` bolted on, this act would have kept a memory successfully,
          then broken the route, then pressed nothing — and measured the
          product's silence about a failure that never happened.

       The act is now what its own name says: reach the world with the
       network intact, break `POST /api/inspirations`, and only then say
       something into the mouth. */
    breaks: (p, m) => p === "/api/inspirations" && m === "POST",
    reach: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
    },
    press: async (page) => {
      await saveAnInspiration(page, "a thought the server will refuse");
    },
  },
  {
    id: "forget",
    name: "letting a memory go, and the delete refuses",
    control: true,
    breaks: (p, m) => /^\/api\/inspirations\//.test(p) && m === "DELETE",
    reach: async (page, base) => {
      /* FIVE, so the search `openAMemory` runs has something to find and
         the archive is not a single row. */
      for (let i = 0; i < 5; i += 1) {
        await keepOne(page, base, `a memory this walk may delete ${i} ${uniq()}`);
      }
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      if (!(await openAMemory(page))) throw new Error("no memory would open in the field");
    },
    press: async (page) => {
      /* `/i`, AND IT IS A REAL FIX NOT A TIDY. The product's word is
         `Delete` (`worldDelete`), and `hasText: /^delete$/` is
         case-SENSITIVE, so this matched nothing and the press timed out
         after 8 seconds — the `forget` CONTROL reporting NOT WALKED.
         (That was said to "abort the run and take every other act's finding
         with it". It did not: the abort below fires only when every control
         produces a SILENT READING, and a thrown act produces no reading at
         all, so it fell out of the counts entirely and out of the exit code
         with them. Corrected 2026-10-15 — a thrown act now fails the run.) */
      await page.locator(".jar-panel button", { hasText: /^delete$/i }).first().click({
        timeout: 8_000,
      });
      await page.waitForTimeout(2_000);
      /* Deleting asks only when a signal stands on the memory. When it does,
         the ask must be walked through or no DELETE is ever sent — journeys.ts
         reported a working delete as broken for exactly this reason.

         ═══ REPOINTED: THE ASK MOVED ONTO THE CARD (`.jar-panel-askrow`) ═══
         `.jar-forget-ask` was a small sheet floating OVER the card. The
         founder killed it on 2026-08-27 — "dont do hover card on a hover
         card" — and the question became the card's own state: while it is
         open the foot's verbs step aside and the sentence takes their row.
         The class has no renderer anywhere in `packages/web/src`.

         THIS ONE DID NOT TIME OUT, WHICH IS WHY IT SURVIVED SO LONG. It is
         `if (await anyway.count())`, and a dead selector counts zero, so the
         branch was simply never taken — silently, in under a millisecond. On
         a memory with a signal on it the confirm went unanswered, no DELETE
         was sent, and the act was then judged on a press that never reached
         the network. The same text is still the button; only its parent
         changed. */
      const anyway = page.locator(".jar-panel-askrow button", { hasText: /delete it anyway/i });
      if (await anyway.count()) await anyway.first().click();
    },
  },
  /* ═══ `reflect` IS DELETED, AND NOT BECAUSE A BUTTON MOVED ═════════════
     "answering a memory, and the reflection refuses". It opened a card,
     pressed `reflect`, typed into `.jar-reflect-box` and pressed `Keep`
     against a broken `POST /api/inspirations/:id/reflections`.

     THE VERB IS NOT ON THE CARD, AND THE CAPABILITY IS NOT IN THE PRODUCT.
     Measured rather than assumed (2026-10-15): with a card open in a
     browser, `.jar-panel-foot` holds three cells — `-foot-l` is the attach-a-
     photo label, `-foot-c` is a single stepper caret, `-foot-r` is `Delete`.
     There is no `reflect`. And the surface it would have opened is now a
     READ: `Home.tsx` names the callback `openReflections` and its own one-
     line doc is "Open the answers already on this save. A read, with nothing
     to write." Nothing in `packages/web/src` posts to that route — the only
     match for `reflections` under `lib/api` is a request TYPE on the create
     path, not a call.

     SO THE ACT COULD NOT SPEAK, MURMUR OR LIE: it broke a route the web
     client never calls, and before it got that far it spent 8 seconds
     waiting for a verb that no component draws. It reported NOT WALKED with
     a Playwright timeout, which reads as harness trouble; what it meant was
     "this act is about a capability the product does not have".

     NOT REPOINTED, deliberately. `.jar-reflect-box` does still render — at
     `Home.tsx:7787` — but it is the POSTER's editor, for writing an ambition
     entry on your own wall in your own hand. Pointing an act named "answering
     a memory" at it would be this file measuring a different verb under the
     old verb's name, which is the exact defect this sweep exists to remove.

     WHAT COVERAGE WENT: nothing walks a failing reflection write. That is a
     gap only for as long as the route is unreachable from the web; the API
     still serves it. WHAT WOULD RESTORE IT: a `reflect` act written the day
     writing an answer comes back to the card, pointed at whatever opens it.

     AND ONE READING GOES WITH IT THAT WAS NOT ABOUT REFLECTING. This act was
     the file's only test of whether a failure line written into the MOUTH's
     slot is visible when the act happened inside the CARD — its own comment
     called that out as the thing it existed to answer. No surviving act
     crosses surfaces like that, so that question is now unasked. */

  /* ═══════════════════════════════════════════════════════════════════════
     FIVE ACTS ARE DELETED HERE, AND ROOMS TOOK ALL FIVE (2026-10-15)
     ═══════════════════════════════════════════════════════════════════════

     `405ee4aa` removed rooms from the web. These acts pressed buttons that
     no component draws any more, so each one spent four 8-second timeouts
     inside `reach` and then threw — and a throw in `reach` is reported as a
     harness error, which reads as infrastructure trouble rather than as
     "this act cannot be walked". Repointing them was considered and refused
     for each: there is no adjacent surface that does what they did, and
     pointing a failure-speech gate at a different verb would be inventing
     coverage, which is the defect this whole file exists to catch.

     ── `publish` — "letting a memory reach your rooms" ──────────────────
     Pressed `public` in the card's head. The private/public pair went with
     rooms IN THE SAME COMMIT, and the commit gives the reason rather than
     leaving it to be guessed: the confirm read "people in your rooms can
     read it", so with rooms gone it "offered a choice between two identical
     states and promised an audience that cannot exist".
     WHAT COVERAGE WENT: nothing now walks a failing `PATCH
     /api/inspirations/:id`. That route is still live and the web client
     still calls it — the inline edit of a memory's words is a PATCH — so
     this is a real gap, not a route that left with the button. WHAT WOULD
     RESTORE IT: the same act pointed at the card's own edit (open the words,
     change them, press save with the PATCH broken), which is a different
     `reach` and a different `press` rather than a selector swap.

     ── `make-room` — and it was a CONTROL, which made this worse ────────
     Broke `POST /api/groups`. Room CREATION was gone before the removal pass
     even started, so this had been unwalkable for longer than the others.
     Being a control is the sharp part — though not for the reason this
     said. It claimed an unreachable control "aborts the whole run on the
     reasoning that the instrument is broken". IT DID THE OPPOSITE: the abort
     fires only when every control yields a SILENT reading, and a control
     that cannot be reached yields NO reading, so it was dropped from every
     count and from the exit code. One dead act was not taking the others'
     findings with it; it was vanishing. Corrected 2026-10-15 — a thrown act
     is now counted and fails the run.
     WHAT COVERAGE WENT: the file is down to TWO controls, `keep` and
     `forget`. The header's "Three acts in the table below are known to
     speak" is corrected to two where it is written.

     ── `rename-room`, `leave-room`, `close-room` ───────────────────────
     All three reached through `makeRoom` + `standInTheRoom` and pressed
     inside `.jar-settings`, which was `SpaceSettings` — a panel the audit
     proved could never mount even before the removal (`setSettingsFor` has
     three call sites and all three pass `null`), and whose file is now
     deleted. These three are the clearest case in the file: the capability
     went, so the act goes.
     WHAT COVERAGE WENT: nothing walks a failing PATCH, POST-leave or DELETE
     on `/api/groups/:id`. UPDATED 2026-10-15: that API half has now landed,
     those routes are gone, and there is nothing left to cover — so this is a
     closed loss rather than an open one.

     ── AND `intact` LOSES ITS ONLY USERS ───────────────────────────────
     `roomName` and the three `intact: () => roomName` hooks went with them.
     The `LIES` reading — "the thing acted on left the screen even though the
     server refused" — is now computed for no act, because the two surviving
     acts never named a thing that must still be on screen. The mechanism is
     kept, documented and unused ON PURPOSE: it is the only reading in this
     file about correctness rather than about speech, and the next act to
     name an `intact` gets it for free. */

  {
    id: "make-agent",
    name: "giving an agent a memory of its own, and the server refuses",
    /* ═══ REPOINTED, NOT DELETED: THE CAPABILITY MOVED OUT OF THE ROOM ═══
       This reached through the walls list — `.jar-here-more` →
       `.jar-here-row--make` → the `an agent` row of `.jar-newplace-row` —
       and every one of those went with rooms. The ACT did not: `POST
       /api/profiles` is still live and still called from the web, from
       `SettingsPanel.tsx:139` (`createProfile`), under the cog's own card.

       So this is the opposite call from the five above. The five lost their
       capability; this one only lost its door, and a gate that deleted it
       would be giving up a real failure-speech reading over a moved button.

       THE DOOR, MEASURED RATHER THAN GUESSED (2026-10-15): the cog is
       `button.waka-corner--settings`, the group is a `.waka-settings-row`
       labelled `Memories` (`profileMemoriesTitle`), and it UNMOUNTS rather
       than hides, so the input does not exist until the group is open. The
       input's accessible name is `Add an agent memory`
       (`profileMemoryNewLabel`) and the submit is the button beside it. */
    breaks: (p, m) => p === "/api/profiles" && m === "POST",
    reach: async (page, base) => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
      await page.locator("button.waka-corner--settings").click({ timeout: 10_000 });
      await page.waitForTimeout(1_200);
      const group = page.locator(".waka-settings-row", { hasText: /memories/i }).first();
      if ((await group.count()) === 0) throw new Error("no `Memories` group in the settings card");
      await group.click({ timeout: 8_000 });
      await page.waitForTimeout(800);
      await page
        .locator('.waka-settings-add input[aria-label="Add an agent memory"]')
        .first()
        .fill("an agent the server refuses", { timeout: 8_000 });
    },
    press: async (page) => {
      /* the button beside the input, taken by position inside the add row:
         it is the only button there, and its word is a translated string */
      await page.locator(".waka-settings-add button").first().click({ timeout: 8_000 });
      await page.waitForTimeout(2_000);
    },
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

    const refused = await breakRoute(ctx, act.breaks, kind);
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
    return read(before, after, lies, refused.hits);
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

  const browser = await launchChromium({
    headless: !args.headed,
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
        : reading!.hits === 0
          ? "NOT PRESSED"
          : reading!.lies
            ? `${reading!.verdict} + LIES`
            : reading!.verdict;
      console.log(`  ${act.id.padEnd(13)} ${mark.padEnd(16)} ${act.name}`);
      if (error) console.log(`                 └─ ${error}`);
      else if (reading!.hits === 0) {
        console.log(
          "                 └─ the press never reached the route this act rests on, so " +
            "whatever the screen said afterwards was about something else",
        );
      } else {
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

  /* AN ACT THAT THREW IS A FAILURE, NOT AN ABSENCE. `all` filters on
     `reading !== null`, so until 2026-10-15 a thrown control fell out of
     every count below and out of the exit code with it — and `mute` above
     only counts controls that produced a SILENT reading, so a throw does not
     reach that abort either. With this file down to three acts, all three
     throwing printed "0 acts pressed against a refusal" and exited 0: the
     exact shape of the defect this whole file exists to catch, in the
     instrument rather than the product. */
  const broke = results.filter((r) => r.reading === null);

  const all = results.filter((r) => r.reading !== null);
  /* AN ACT THAT NEVER REACHED ITS ROUTE IS NOT A FINDING ABOUT THE PRODUCT.
     It is this walk failing to press the thing it names, and folding it in
     with the verdicts would let a broken aim read as a clean audit. */
  const unpressed = all.filter((r) => r.reading!.hits === 0);
  const walked = all.filter((r) => r.reading!.hits > 0);
  const silent = walked.filter((r) => r.reading!.verdict === "SILENT");
  const murmur = walked.filter((r) => r.reading!.verdict === "MURMURS");
  const lying = walked.filter((r) => r.reading!.lies);
  console.log(
    `\n[when-it-fails] ${walked.length} acts pressed against a refusal — ` +
      `${walked.length - silent.length - murmur.length} said what went wrong, ` +
      `${murmur.length} changed without saying, ${silent.length} said nothing.`,
  );
  if (unpressed.length > 0) {
    console.log(
      `                ${unpressed.length} never reached the route they rest on, so they ` +
        `were not asked at all: ${unpressed.map((r) => r.act.id).join(", ")}`,
    );
  }
  if (broke.length > 0) {
    console.log(
      `                ${broke.length} threw before producing a reading, so the ` +
        `instrument never asked them: ${broke.map((r) => r.act.id).join(", ")}`,
    );
  }
  if (lying.length > 0) {
    console.log(
      `                ${lying.length} took the thing off screen anyway: ${lying
        .map((r) => r.act.id)
        .join(", ")}`,
    );
  }
  process.exit(
    silent.length + murmur.length + lying.length + unpressed.length + broke.length > 0 ? 1 : 0,
  );
}

main().catch((err) => {
  console.error("[when-it-fails] crashed:", err);
  process.exit(2);
});
