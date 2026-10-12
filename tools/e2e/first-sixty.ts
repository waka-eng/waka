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
import { type BrowserContext, type Page, type Route } from "playwright";
import { launchChromium } from "./browser";
import { openTheNotepad, saveAnInspiration } from "./keep";
/**
 * TWO EMPTIES, NOT ONE.
 *
 *   door   NOT signed up at all. The surface that comes before the account,
 *          and the only one a person can meet without having decided anything.
 *   empty  signed up, nothing created. The first screen inside.
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
type Stage = "door" | "empty" | "kept";

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
      if (v !== "door" && v !== "empty" && v !== "kept") {
        console.error(`[first-sixty] --stage must be door, empty or kept (got ${v})`);
        process.exit(2);
      }
      args.stage = v;
    }
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:first-sixty [--base-url <url>] [--stage door|empty|kept] [--headed]");
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
      /* ON SCREEN, NOT MERELY IN THE DOCUMENT.
         This read `document.body.innerText`, which is every word the document
         holds wherever it sits. That was true enough while the page was one
         screen tall. It stopped being true the day the founder ruled that the
         sky's words must already exist before you travel to them — "feels like
         your philosophies text appears rather than it was in the sky already"
         — because the sky lives one full viewport above headquarters. Its
         sentences went into the BACKDROP, the backdrop is subtracted from
         every surface, and so opening `philosophies & values` reported a
         surface that says nothing while its two sentences sat on screen.
         An instrument that calls a fixed defect a new one is worse than no
         instrument. So: only text-bearing elements whose box actually meets
         the viewport, and `innerText` per element so `text-transform` still
         decides what is a label. */
      const text: string[] = [];
      /* AT THE PARAGRAPH LEVEL, WHICH IS WHERE A SENTENCE LIVES.
         The first pass at this took text from every element that directly
         owned any, and the poster is written one `<span class="jar-word">`
         per word so the ambition can arrive the way a thought does. The walk
         duly reported the wall's whole claim as "Solitude · might · be · a"
         and called the surface furniture. `innerText` groups by block for
         exactly this reason, so the unit here is the DEEPEST BLOCK that
         holds text: the `<h1>`, not the words inside it, and not an ancestor
         tall enough to reach into the sky above the screen. */
      const blocks = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
        (el) => {
          const d = getComputedStyle(el).display;
          return !d.startsWith("inline") && d !== "none" && d !== "contents";
        },
      );
      const holds = new Set(blocks.filter((el) => (el.innerText || "").trim().length > 0));
      for (const el of holds) {
        let deeper = false;
        for (const kid of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
          if (holds.has(kid)) deeper = true;
        }
        if (deeper) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
        if (r.right <= 0 || r.left >= window.innerWidth) continue;
        for (const line of (el.innerText || "").split("\n")) {
          const t = line.trim();
          if (t.length > 0) text.push(t);
        }
      }
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
        /* the same rule: a field parked off screen is not something a person
           is reading */
        if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
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
  await saveAnInspiration(page, text);
}

/**
 * OPEN THE ONE MEMORY THERE IS, FROM THE LIST THAT HOLDS IT.
 *
 * ── THIS USED TO HUNT FOR ITS ORB, AND THE HUNT WAS THE PROBLEM ───────────
 *
 * It pressed `.jar-saved` to descend into the field and then clicked a grid
 * of three hundred coordinates across the canvas looking for one painted orb.
 * Both halves are gone: `.jar-saved` has no renderer (the only mentions left
 * in `Home.tsx` hand the string to `querySelector`), so the descent could
 * only time out, and the walk then reported `NOT AIMED` — "this file could
 * not aim", which was true and was the wrong reason. Nothing it was aiming at
 * was there.
 *
 * `Home.tsx` says where the memory is now, under its own heading "THE
 * `N INSPIRATIONS` DOOR IS GONE FROM HERE TOO": "the archive is
 * `SavesOverlay`, reached from the dock on every wall". It draws one
 * `.waka-list-row` per memory, each carrying its own preview and date, and
 * pressing one opens the note.
 *
 * AND THE `NOT AIMED` CAVEAT GOES WITH THE SWEEP, which is the real gain.
 * That verdict existed because one orb on a whole field is a needle and this
 * stage has exactly one on purpose, so a legitimate miss had to be told apart
 * from a product that hides things. A list of one row is not a needle. If the
 * row is not there now, that is a reading about the product and the walk
 * should say so — which it does, as `NOT THERE`.
 */
async function openTheMemory(page: Page): Promise<boolean> {
  try {
    await toDock(page, "Inspirations");
    await page.waitForTimeout(3_000);
    const row = page.locator(".waka-list-row").first();
    if ((await row.count()) === 0) return false;
    await row.click({ timeout: 8_000 });
    await page.waitForTimeout(2_000);
    return (await page.locator(".waka-note-page").count()) > 0;
  } catch {
    return false;
  }
}

/**
 * Every surface an account with nothing in it can reach.
 *
 * Deliberately NOT the full `dead-css` list: the memory's own note and the
 * board's poster cannot be reached without making something, and a walk that
 * made something to reach them would no longer be measuring an empty account.
 * Their absence from this list is itself part of the reading — see what the
 * run prints about `the archive door`, which opens on an empty list.
 */
/* ═══ THE FIVE OPENERS THAT NAMED CLASSES NOTHING RENDERS, RESOLVED ══════
   The previous pass found them and said so rather than acting, which was the
   right call to make visible and the wrong one to leave standing: each cost
   eight seconds and filed its surface as `NOT THERE`, and `NOT THERE` reads
   as a statement about the product — "this surface does not exist for this
   account". For three of them that was a lie about the product and for two it
   was the wrong sentence about a surface that had moved. Measured again on
   2026-10-12, the same way: the value of every `className=` in every
   `.ts`/`.tsx` under `packages/web/src` outside `src/styles`.

   TWO ARE REPOINTED, BECAUSE THE CAPABILITY MOVED AND DID NOT GO.

     .jar-values  →  the dock's `Principles` row. The up-signpost at
                     headquarters is gone; what it opened is a destination in
                     the bar on every wall.
     .jar-saved   →  the dock's `Inspirations` row. Same: `Home.tsx` says it
                     under its own heading "THE `N INSPIRATIONS` DOOR IS GONE
                     FROM HERE TOO" — "the archive is `SavesOverlay`, reached
                     from the dock on every wall".

   AND THE DOCK IS NOT A WEAKER DOOR FOR THIS WALK, WHICH IS THE OBJECTION
   THE PREVIOUS PASS RAISED AND IS ANSWERED HERE. It worried that the dock is
   on screen from the first second while these were reaches into the chrome,
   so repointing changes what "a surface an empty account can reach" means.
   It does — in this walk's favour. The question this file asks is "does this
   surface say anything to a person who has never been here", and the bar
   being visible from the first second makes these two the surfaces a new
   person is MOST likely to open, not least. A reach into chrome nobody could
   find was the weaker reading.

   THREE ARE DELETED, WITH WHAT WENT WITH THEM.

     .jar-here            `your own wall's panel`. The wall chip in
                          `.jar-topbar` renders `null`, under `Home.tsx`'s
                          heading "THE WALL PICKER MOVED TO THE TOP-LEFT
                          CORNER" — and the panel it opened cannot be opened
                          at all: `SpaceSettings` mounts only on
                          `settingsFor === spaceKey(atWall)`, and every call
                          to `setSettingsFor` in `packages/web/src` passes
                          `null`. There is no door, so there is no surface.
                          Reported as a product finding rather than fixed
                          here — see the same note in `tools/e2e/measure.ts`
                          above `every-modal-is-one-modal`.
     .jar-here-more       `the walls list`, which this opened twice. The list
                          renders into the corner row now, and on THIS
                          account it renders nothing at all: the corner's
                          left slot is the agent switch, and an empty account
                          has no agent. A list of one wall is not a surface.
     .jar-here-row--make  `make another place`. `dead-css.ts` carries the
                          founder's ruling in full — "get rid of the rooms and
                          agent related stuff for now" — and records that
                          making a place from the world is not something the
                          product offers any more.

   WHAT COVERAGE WENT, SAID OUT LOUD: nothing in this walk now reads a wall's
   own settings panel, the list of walls, or the make-a-place sheet, on an
   empty account or any other. The first of those needs an opener in the
   product before any walk can reach it; the other two need rooms back. Their
   `BARE_BY_DECISION` entries went with them, because an excuse for a surface
   nobody walks is an excuse that cannot be checked.

   (No line numbers into `Home.tsx`: it is thousands of lines, it is being
   restructured as this is written, and everything in it moves. The headings
   do not.) */
/** Press a row in the dock by the words written on it. */
async function toDock(page: Page, label: string): Promise<void> {
  /* BY THE WORDS, NOT BY AN INDEX. The bar's order is a design decision —
     the founder has already reordered it once ("home, inspirations,
     conversations, and principles") — and a walk that pressed the fourth
     button would quietly start measuring a different destination the next
     time somebody moves one. A step named for the word on the control also
     breaks when the word changes, which is the right thing for it to do.
     Same pattern as `tools/e2e/usability.ts`'s own `toDock`. */
  await page
    .locator(".waka-dock-item", { hasText: new RegExp(`^${label}$`) })
    .first()
    .click({ timeout: 8_000 });
}

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
      await openTheNotepad(page);
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
    /* The surface keeps the name of what is behind the door rather than the
       name of the door: this walk's readings are about surfaces, and the
       surface is the same one it always was. */
    name: "philosophies & values",
    open: async (page) => {
      await toDock(page, "Principles");
      await page.waitForTimeout(1_600);
    },
  },
  {
    name: "your settings",
    /* ═══ THE COG, NOT THE ACCOUNT PILL ══════════════════════════════════
       THIS PRESSED `.jar-account`, WHICH HAS NO RENDERER. The pill in
       `.jar-topbar` went when settings stopped being a page — founder: "I
       want all setting-related stuff to be only accessible through the drop
       down and not be its own thing", `main.tsx:186`. The step therefore
       spent eight seconds timing out and filed the surface as `NOT THERE`,
       which reads as a finding about the product: an account with nothing in
       it cannot reach its settings. It can. It presses the cog.

       BY THE MODIFIER, copying `tools/e2e/dead-css.ts:780`: the right corner
       has held two buttons since 2026-10-11 — an "i" beside the cog — and the
       left corner has worn `.waka-corner` since there was a corner, so
       `.first()` is a bet on document order that would now lose.

       WHAT THIS SURFACE IS FOR, UNCHANGED: whether a brand-new account's
       settings SAY anything or are a bare grid of controls. The card's three
       groups are folded when it opens and this reads the card, not each
       group — the same reading the page gave, since the page's panels were
       `hidden` one at a time too. `dead-css.ts` is the walk that opens each
       group, because it is the walk that needs every rule on screen. */
    open: async (page) => {
      await page.locator("button.waka-corner--settings").first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_600);
    },
  },
  {
    name: "the archive door",
    open: async (page) => {
      await toDock(page, "Inspirations");
      await page.waitForTimeout(2_500);
    },
  },
  {
    name: "the door (sign in)",
    stages: ["door"],
    open: async () => {
      /* nothing: `/login` opens on this tab */
    },
  },
  {
    name: "the door (sign up)",
    stages: ["door"],
    open: async (page) => {
      await page.click("#login-tab-signup");
      await page.waitForTimeout(1_200);
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

/**
 * SURFACES THAT SHOW ONLY FURNITURE ON PURPOSE, each with the ruling that made
 * them that way. Same contract as `wall-chrome.test.ts`'s `DARK_BY_DECISION`:
 * an entry may only exist because a decision put it here, never because a
 * surface went quiet and nobody noticed.
 *
 * This is what lets the walk be a GATE rather than a report. It ran red on
 * every commit otherwise — three surfaces are bare today and two of those are
 * bare by a founder's ruling — and a check that is always red is a check
 * everyone learns to skip.
 *
 * The ratchet only ever tightens: a NEW bare surface fails, and a listed one
 * that starts speaking fails too, because an excuse that has quietly become
 * wrong is a gate lying in the reassuring direction.
 */
const BARE_BY_DECISION: Record<string, string> = {
  /* `the mouth, opened`'s ENTRY IS GONE, AND THE RATCHET IS WHAT TOOK IT.
     It read: "RULED (founder, 2026-08-24): 'the resting phrase, kept —
     opening the mouth changes nothing about it'. The placeholder repeats the
     button by decision; docs/audits/first-run-2026-08-26.md records what that
     buys and costs."

     THE SURFACE SPEAKS NOW, so this file's own second ratchet fired on it:
     "a listed one that starts speaking fails too, because an excuse that has
     quietly become wrong is a gate lying in the reassuring direction." It
     fired correctly. The notepad prints the day you are writing on — "October
     12, 2026 at 1:18 PM" — above a placeholder that names four things you can
     put in it. The 2026-08-24 ruling was about one line repeating the button
     it opened from; there are two lines now and the first of them is not the
     button's. The decision this entry carried does not describe the screen any
     more, so the screen is held to the same standard as every other one here
     and passes on its own merits. */
  "your settings":
    "A settings sheet: a name, an address and a row of places to go. Furniture " +
    "is what it is for, and prose there would be prose about prose.",
  /* `the walls list` HAD AN ENTRY HERE AND ITS SURFACE WENT ON 2026-10-12 —
     see the note above `SURFACES`. The excuse read: "A list of walls plus
     `add new`. The walls name themselves; a sentence explaining a list of
     names is the same repetition the eyebrow ruling removed one surface
     over." It is kept as a quotation rather than as a live entry, because an
     excuse for a surface no walk visits is an excuse nobody can check — and
     the ratchet below only tightens on names that really get walked. */
  "the timeline":
    "A list of the days this wall changed. Its whole content is a control for " +
    "choosing a moment — every row IS a date, read aloud as it stands — and " +
    "the sheet is named for a listener, `wind this wall back through time`, " +
    "which is where the sentence went. It used to be a rail, and the answer " +
    "was the same for the same reason. AND ON THIS ACCOUNT IT IS NOT THERE " +
    "AT ALL, which is the design rather than a gap: a wall whose whole life " +
    "is today has nowhere to wind back to, so the word that summons the dates " +
    "is not rendered. An empty account is exactly that wall, which is why " +
    "this one surface is legitimately filed `NOT THERE` by a walk that can " +
    "reach everything else: the class is live, the state is not.",
  /* `the archive door`'s ENTRY IS GONE, AND THAT IS THE QUESTION CLOSING
     RATHER THAN THE NOTE ROTTING. It read: "OPEN, NOT SETTLED. Behind the
     door is the field, and the field is a CANVAS — its content is painted
     pixels, so there is no prose for this walk to find and nothing for a
     screen reader to read either… When the archive grows a text route, this
     entry goes."

     The archive grew a text route. It is `SavesOverlay`, reached from the bar
     on every wall, and it draws one row of words per memory — so the door now
     opens on something a person and a screen reader can both read, and the
     surface is held to the same standard as every other one in this file. If
     it comes back bare, that is a finding and this gate will say so. */
};

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
    args.stage === "door"
      ? "[first-sixty] NOT signed up. The surface before the account — what a person who has\n" +
          "              never heard of WAKA can read before deciding to make one.\n"
      : args.stage === "empty"
      ? "[first-sixty] An account with nothing in it. Nothing is created at any point.\n" +
          "              Of each surface: does it say anything to someone who has never been here?\n"
      : "[first-sixty] ONE memory kept, and nothing else. Promotion needs three pieces of\n" +
          "              evidence, so nothing has formed and nothing can have yet. Does the\n" +
          "              product say so, or does it look like a product that is broken?\n",
  );

  const browser = await launchChromium({
    headless: !args.headed,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const readings: Reading[] = [];
  try {
    await stubExternals(ctx, args.baseUrl);
    const page = await ctx.newPage();
    /* THE DOOR IS WALKED WITHOUT AN ACCOUNT, which is the whole point of it:
       every other surface in this file is reached by signing up first, and a
       person deciding whether to sign up has not done that yet. */
    if (args.stage !== "door") await signUp(page, args.baseUrl);

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
      /* AND IT WAITS FOR THE ANSWER RATHER THAN FOR A DURATION.
         Twelve samples at 1.2s is 14.4 seconds, chosen against a derivation
         that "lands around eight seconds in" on a developer's machine. A CI
         runner is not that machine: this gate failed on a branch and passed
         on `dev` twenty minutes later with the identical commit, and this
         surface was half of the failure. A fixed window against a variable
         answer measures the runner's load.

         So it polls, and — this is the part a plain `waitForSelector` would
         get wrong — it KEEPS WHAT IT SEES WHILE POLLING. The character's
         acknowledgement of the save clears itself after four seconds, so the
         two things this surface exists to catch arrive at opposite ends of
         the wait: the receipt almost immediately and gone, the headline late.
         Reading only at the end would report the second and lose the first.

         If nothing ever arrives the loop simply runs out and the surface
         reports BARE, which is a true finding rather than a slow one. */
      const seenWhileWaiting = new Set<string>();
      const deadline = Date.now() + 45_000;
      let answered = false;
      while (Date.now() < deadline && !answered) {
        for (const l of await visibleLines(page, 1, 0)) seenWhileWaiting.add(l);
        answered = [...seenWhileWaiting].filter((l) => !beforeSave.has(l)).some(isProse);
        if (!answered) await page.waitForTimeout(1_000);
      }
      for (const l of await visibleLines(page, 3, 800)) seenWhileWaiting.add(l);
      const afterSave = [...seenWhileWaiting];
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

    /* WHAT THE WORLD SAYS BEFORE THIS SURFACE IS OPENED, held aside so the
       surface is reported on what IT added rather than on the backdrop it is
       drawn over. Without this the topbar's words would make every panel look
       like it said something.

       AND IT IS RE-READ ON EVERY LOAD, WHICH IS THE WHOLE POINT.

       It used to be captured once, from its own page load, and subtracted
       from surfaces read on later loads. That is a race, and CI found it: the
       same commit failed this gate on a branch and passed it on `dev` twenty
       minutes later. The world's headline is WRITTEN BY THE MODEL and arrives
       asynchronously, so the sentence standing behind the sheet on load 7 is
       not the sentence that was standing behind it on load 1. Whatever
       differed was subtracted from nothing and reported as the sheet's own
       prose — which is how `your settings` came to "say"
       *"Solitude might be a more effective tool for restoration…"*, a line
       that belongs to the wall behind it.

       The same race ran the other way too, and both readings were in the one
       failure: four surfaces listed as deliberately bare "spoke" (they had
       borrowed the world's new sentence), and one that speaks went bare.

       Read on the same load, a moment before the surface opens, the world
       behind the sheet is exactly the world this reading subtracts. There is
       no window for the model to land in. */
    const home = args.stage === "door" ? `${args.baseUrl}/login` : `${args.baseUrl}/`;

    for (const surface of SURFACES) {
      if (!(surface.stages ?? ["empty", "kept"]).includes(args.stage)) continue;
      /* FROM A FRESH LOAD EVERY TIME. The same lesson dead-css paid for: a
         surface left standing by the previous one is state this walk cannot
         reason about, and Escape was measurably not enough. */
      await page.goto(home, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(args.stage === "door" ? 2_500 : 6_000);
      /* this load's own world, read before the surface covers any of it */
      const backdrop = new Set(await visibleLines(page));

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
        surface.name === "the world, just arrived" || surface.name === "the door (sign in)"
          ? lines
          : lines.filter((l) => !backdrop.has(l));
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
  /* THE RATCHET, BOTH WAYS. */
  const unexplained = [...bare, ...blank].filter((r) => !(r.name in BARE_BY_DECISION));
  const spokeAfterAll = Object.keys(BARE_BY_DECISION).filter((name) =>
    readings.some((r) => r.name === name && r.verdict === "SAYS"),
  );
  if (unexplained.length > 0) {
    console.log(
      `\n[first-sixty] ${unexplained.length} surface(s) show only furniture and nothing says why:\n` +
        unexplained.map((r) => `                ${r.name}`).join("\n") +
        "\n              Either give it a sentence, or add it to BARE_BY_DECISION with\n" +
        "              the ruling that made it bare and where that ruling is written down.",
    );
  }
  if (spokeAfterAll.length > 0) {
    console.log(
      `\n[first-sixty] ${spokeAfterAll.length} surface(s) are listed as deliberately bare and\n` +
        `              speak now: ${spokeAfterAll.join(", ")}. The decision was\n` +
        "              reversed and the note was not — delete the entry.",
    );
  }
  process.exit(unexplained.length + spokeAfterAll.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[first-sixty] crashed:", err);
  process.exit(2);
});
