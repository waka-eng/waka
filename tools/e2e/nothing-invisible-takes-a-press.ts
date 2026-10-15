#!/usr/bin/env tsx
/**
 * ═══ NOTHING INVISIBLE TAKES A PRESS ════════════════════════════════════
 *
 * The same defect has now shipped twice, and both times a person found it by
 * pressing something and watching the wrong thing happen:
 *
 *   THE JAR'S MOUTH. A box that painted nothing sat over the world and took
 *   presses meant for the orbs behind it.
 *
 *   THE DIAL'S TRACK. `.jar-dial-track` was 44px wide and ran nearly half the
 *   height of the screen with no ink in it, mounted at all times. Measured at
 *   x 110..140, y 50..420 it swallowed presses meant for the walls list
 *   behind it, and it took two attempts to reach ADD NEW through it.
 *
 * Neither was caught by a gate. `dial-rest.test.ts` now names `.jar-dial-track`
 * and refuses its return — which guards one instance of the class and says so
 * itself. This file guards the class.
 *
 * ── THE QUESTION ────────────────────────────────────────────────────────────
 *
 * For every box that is STACKED OVER the world rather than laid out in it —
 * fixed, absolute or sticky — and is big enough to be pressed on purpose:
 * does it win a hit test anywhere inside itself, and does it draw anything
 * at all? A box that takes presses and paints nothing is a hole: the person
 * aims at what they can see, and something they cannot see answers.
 *
 * THE BOX IS JUDGED WHOLE, not at the points it happens to own. A paragraph
 * paints nothing at the point three quarters across its last short line, and
 * the first version of this file read single points and duly reported the
 * login form, a field wrapper and the wall's own claim. The question is
 * whether the element draws ANYTHING, so the whole of its own box is
 * photographed with it and without it.
 *
 * AND WHOSE PRESS IT TAKES IS THE OTHER HALF. An unpainted box is only a trap
 * if the press it swallowed was meant for somebody else. So with the box
 * hidden, the point is asked again — and what answers decides it:
 *
 *   AN ANCESTOR ANSWERS, AND IT PAINTS THERE. The press lands inside the
 *   surface it was already inside; the person aimed at a card and hit that
 *   card's own padding. Nothing is taken from anyone, and this is most of
 *   what an in-flow transparent wrapper ever does.
 *
 *   AN ANCESTOR ANSWERS AND IT IS INVISIBLE THERE TOO. Then it is the same
 *   trap one level up, and the walk keeps climbing. An unpainted box inside
 *   an unpainted overlay excused itself in the first version of this rule —
 *   the child pointed at its parent and the parent was never asked — which
 *   is exactly the shape the dial's rail had.
 *
 *   SOMETHING FROM ANOTHER SUBTREE ANSWERS. The press was headed for the
 *   ground, or for the walls list, and an invisible thing on top answered
 *   instead. That is the defect, in both its shipped forms.
 *
 * THE SECOND HALF IS WHY THE RULE IS NOT "OUT OF FLOW". A first cut required
 * `position: fixed | absolute | sticky` and would have missed the defect it
 * was written for: `.jar-dial-track` was `position: relative`, laid out in
 * flow INSIDE an overlay. What made it a trap was never its own positioning;
 * it was what stood behind it.
 *
 * ── HOW IT ASKS, AND WHY NOT THE STYLESHEET ────────────────────────────────
 *
 * `answers-the-hand` states the principle this borrows: the only thing that
 * knows whether something is painted is the engine that paints it. A rule
 * reading `background-color` and `border-width` would miss a pseudo-element,
 * a shadow, an inherited background, a child drawn under a transform — and
 * would report each of them as a defect.
 *
 * So the element is HIDDEN and the screen is looked at again. `visibility:
 * hidden` takes the ink and leaves the layout, so nothing moves; if the
 * pixels at the point it owns are identical with it and without it, it was
 * painting nothing there. That is not an approximation of the question, it
 * is the question.
 *
 * ONE AT A TIME, NOT ALL AT ONCE. Hiding every candidate together is far
 * faster and quietly wrong: a big wrapper's ink is often what fills the point
 * a smaller box owns, so hiding both at once makes the small one look like it
 * paints. Each is hidden alone, against a screen that is otherwise whole.
 *
 * ── THE WORLD MOVES, SO ONLY STILL POINTS ARE JUDGED ───────────────────────
 *
 * The ground is a canvas and the canvas is alive: orbs ease home, the
 * companion breathes. Two photographs of the same pixel taken a moment apart
 * differ, and a comparison against a moving background says "it paints" about
 * everything — a gate that finds nothing, always, which is the shape of a
 * gate that has quietly stopped working.
 *
 * Every point is therefore photographed TWICE before anything is hidden, and
 * a point that has already changed on its own is not asked about. The count
 * of points dropped that way is printed on every run, found or not, so a run
 * that judged almost nothing cannot read as a clean one.
 *
 * ── WHAT IS EXEMPT, AND WHY EXEMPTIONS ARE WRITTEN DOWN ────────────────────
 *
 * An invisible thing that takes a press is not always a defect: pressing the
 * dark around a sheet to dismiss it is a real gesture, and the thing taking
 * that press is deliberately not drawn. Those live in EXEMPT below with the
 * reason, the same shape `answers-the-hand` uses for the controls that are
 * quiet by decision. An exemption with no argument beside it cannot be told
 * apart from an oversight.
 *
 *     pnpm e2e:nothing-invisible [--base-url <url>] [--negative]
 *
 * `--negative` puts the dial's track back — an inkless 44px strip over the
 * world, exactly as it shipped — and the walk MUST find it.
 */
import { type Browser, type Page } from "playwright";

import postgres from "postgres";

import { settleAfterArrival } from "./arrival";
import { launchChromium } from "./browser";
import { openTheNotepad } from "./keep";

const DEFAULT_BASE = "http://127.0.0.1:3010";
const PASSWORD = "nothing-invisible-1";

/** Smaller than this is not a box somebody aims at; it is a hairline. */
const MIN_SIDE = 24;

/**
 * DELIBERATELY UNDRAWN, WITH THE REASON. Matched against the element's class
 * attribute; a substring, because the class list carries state modifiers.
 */
const EXEMPT: Array<{ needle: string; why: string }> = [
  /* EMPTY, AND THAT IS THE HONEST STATE OF IT.
     It shipped holding one entry — `jar-scrim`, "the dark behind a sheet:
     pressing it dismisses the sheet, which is a real gesture on a thing that
     is deliberately not drawn". A good argument for a class the product does
     not have: `jar-scrim` appears nowhere in `packages/web/src`, and every
     run duly reported "0 exempt by decision", which is the tell nobody read.
     An exemption for something that is not there is worse than one with no
     reason beside it — it reads as a considered decision and cannot be
     audited. The argument is kept here because it is the right one the day a
     scrim comes back: the gate will find it, and this is the shape of the
     entry to write. Nothing may be added without the reason, and the check
     below refuses an entry that matches nothing. */
];

interface Candidate {
  mark: string;
  tag: string;
  cls: string;
  label: string;
  box: { x: number; y: number; w: number; h: number };
  points: Array<[number, number]>;
}

interface Finding {
  surface: string;
  what: string;
  box: string;
  points: number;
  /** What the press was headed for, and did not reach. */
  behind: string[];
}

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * EVERY BOX THAT WINS A HIT TEST SOMEWHERE INSIDE ITSELF.
 *
 * `elementFromPoint` must return THE ELEMENT, not a descendant: a descendant
 * that wins is its own candidate and is judged on its own terms. That single
 * choice is what keeps a page's wrappers out of the report — a container
 * whose middle is covered by its own painted child never owns a point there.
 */
async function candidates(page: Page): Promise<Candidate[]> {
  return (await page.evaluate((minSide: number) => {
    /* LAST SWEEP'S MARKS COME OFF FIRST. Four surfaces are swept on one
       document, and the counter restarts at 1 each time — so an element that
       was a candidate before and is not one now would keep `inv3` while a
       different element was handed `inv3` too, and `querySelector` would hand
       `hide()` whichever came first in document order. Never observed on the
       sequence this walk actually runs (the candidate set only grows: 19, 20,
       27, 27), which is exactly why it is worth closing — the next surface
       added is what makes the set shrink. */
    for (const stale of Array.from(document.querySelectorAll("[data-inv-probe],[data-inv-chain]"))) {
      stale.removeAttribute("data-inv-probe");
      stale.removeAttribute("data-inv-chain");
    }
    const out: Array<{
      mark: string;
      tag: string;
      cls: string;
      label: string;
      box: { x: number; y: number; w: number; h: number };
      points: Array<[number, number]>;
    }> = [];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "head" || tag === "meta") continue;
      const r = el.getBoundingClientRect();
      if (r.width < minSide || r.height < minSide) continue;
      if (r.bottom <= 0 || r.right <= 0) continue;
      if (r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
      const cs = window.getComputedStyle(el);
      if (cs.pointerEvents === "none") continue;
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (Number(cs.opacity) === 0) continue;
      const owned: Array<[number, number]> = [];
      for (const fx of [0.5, 0.25, 0.75]) {
        for (const fy of [0.5, 0.25, 0.75]) {
          const x = Math.round(r.left + r.width * fx);
          const y = Math.round(r.top + r.height * fy);
          if (x < 4 || y < 4) continue;
          if (x > window.innerWidth - 5 || y > window.innerHeight - 5) continue;
          if (document.elementFromPoint(x, y) === el) owned.push([x, y]);
          if (owned.length === 3) break;
        }
        if (owned.length === 3) break;
      }
      if (owned.length === 0) continue;
      n += 1;
      const mark = "inv" + n;
      el.setAttribute("data-inv-probe", mark);
      /* the words a person would use for it: its own text if it has any,
         else its class, else its tag */
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      out.push({
        mark,
        tag,
        cls: el.getAttribute("class") ?? "",
        label: text,
        box: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        points: owned,
      });
    }
    return out;
  }, MIN_SIDE)) as Candidate[];
}

/** One photograph of the element's own box, clipped to the glass. */
async function boxShot(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  /* clipped to the glass, read from the page rather than restated: a second
     copy of the viewport here silently mis-crops the day it changes */
  const glass = page.viewportSize() ?? { width: 1280, height: 900 };
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(box.x + box.w, glass.width) - x;
  const height = Math.min(box.y + box.h, glass.height) - y;
  if (width < 1 || height < 1) return "";
  const shot = await page.screenshot({ clip: { x, y, width, height }, animations: "disabled" });
  return shot.toString("base64");
}

/** One photograph of a small square around a single point. */
async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const shot = await page.screenshot({
    clip: { x: Math.max(0, x - 3), y: Math.max(0, y - 3), width: 7, height: 7 },
    animations: "disabled",
  });
  return shot.toString("base64");
}

async function hide(page: Page, mark: string, on: boolean): Promise<void> {
  await page.evaluate(
    (arg: { mark: string; on: boolean }) => {
      const el = document.querySelector('[data-inv-probe="' + arg.mark + '"]');
      if (el instanceof HTMLElement) el.style.visibility = arg.on ? "hidden" : "";
    },
    { mark, on },
  );
}

/** The candidate and the invisible levels above it, hidden or restored together. */
async function hideChain(page: Page, keys: string[], on: boolean): Promise<void> {
  await page.evaluate(
    (arg: { keys: string[]; on: boolean }) => {
      for (const k of arg.keys) {
        const el =
          document.querySelector('[data-inv-probe="' + k + '"]') ??
          document.querySelector('[data-inv-chain="' + k + '"]');
        if (el instanceof HTMLElement) el.style.visibility = arg.on ? "hidden" : "";
      }
    },
    { keys, on },
  );
}

interface Scope {
  candidates: number;
  judged: number;
  movedOn: number;
  exempt: number;
  /** which exemptions were actually met here, by needle */
  met: string[];
  /** Unpainted, but what is behind it is its own surface — see the header. */
  ownGround: number;
}

async function sweep(page: Page, surface: string): Promise<{ found: Finding[]; scope: Scope }> {
  const all = await candidates(page);
  const scope: Scope = {
    candidates: all.length,
    judged: 0,
    movedOn: 0,
    exempt: 0,
    met: [],
    ownGround: 0,
  };
  const found: Finding[] = [];

  for (const c of all) {
    const excused = EXEMPT.find((e) => c.cls.includes(e.needle));
    if (excused) {
      scope.exempt += 1;
      if (!scope.met.includes(excused.needle)) scope.met.push(excused.needle);
      continue;
    }

    /* TWICE, BEFORE ANYTHING IS HIDDEN: a box that has already changed on its
       own cannot answer the question this walk asks. */
    const first = await boxShot(page, c.box);
    const second = await boxShot(page, c.box);
    if (first === "" || first !== second) {
      scope.movedOn += 1;
      continue;
    }
    scope.judged += 1;

    await hide(page, c.mark, true);
    const without = await boxShot(page, c.box);
    await hide(page, c.mark, false);
    if (without !== second) continue;

    /* WHOSE PRESS WAS IT? Asked at the points it wins the hit test on,
       because that is where the press would have gone — and asked by
       CLIMBING while the answer is an ancestor that is itself invisible
       there. `hideChain` is what makes the climb possible: hiding one level
       at a time and looking at the same pixel says whether that level was
       what the person could see. */
    const stolen: string[] = [];
    for (const [x, y] of c.points) {
      const lit = await pixelAt(page, x, y);
      const chain = [c.mark];
      let taken: string | null = null;
      for (let step = 0; step < 6; step += 1) {
        await hideChain(page, chain, true);
        const now = await pixelAt(page, x, y);
        const answer = (await page.evaluate(
          (at: { x: number; y: number; mark: string }) => {
            const me = document.querySelector('[data-inv-probe="' + at.mark + '"]');
            const behind = document.elementFromPoint(at.x, at.y);
            if (behind === null || me === null) return null;
            const tag = behind.tagName.toLowerCase();
            if (tag === "body" || tag === "html") return null;
            const cls = behind.getAttribute("class");
            const name = cls !== null && cls !== "" ? "." + cls.trim().split(/\s+/)[0] : tag;
            let key = behind.getAttribute("data-inv-chain");
            if (key === null) {
              key = "chain" + Math.random().toString(36).slice(2, 9);
              behind.setAttribute("data-inv-chain", key);
            }
            return { name, key, mine: behind.contains(me) || me.contains(behind) };
          },
          { x, y, mark: c.mark },
        )) as { name: string; key: string; mine: boolean } | null;
        await hideChain(page, chain, false);
        /* something in the chain was painting here after all: the person can
           see a surface at this point, so nothing was taken */
        if (now !== lit && step > 0) break;
        if (answer === null) break; /* empty space; a press here costs nobody */
        if (!answer.mine) {
          taken = answer.name;
          break;
        }
        chain.push(answer.key);
      }
      if (taken !== null) stolen.push(taken);
    }
    if (stolen.length === 0) {
      scope.ownGround += 1;
      continue;
    }

    const what =
      (c.cls !== "" ? "." + c.cls.trim().split(/\s+/).join(".") : c.tag) +
      (c.label !== "" ? ` (${JSON.stringify(c.label)})` : "");
    found.push({
      surface,
      what,
      box: `${c.box.w}x${c.box.h} at ${c.box.x},${c.box.y}`,
      points: c.points.length,
      behind: [...new Set(stolen)],
    });
  }
  return { found, scope };
}

async function walk(browser: Browser, base: string, negative: boolean): Promise<{
  found: Finding[];
  scopes: Array<{ surface: string; scope: Scope }>;
}> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    /* the world at rest paints nothing new; the eases are what a still
       photograph cannot survive */
    reducedMotion: "reduce",
  });
  if (negative) {
    /* THE DIAL'S TRACK AS IT SHIPPED, IN ITS OWN SHAPE. An overlay pinned
       over the world (`.jar-dial`), and inside it a box laid out in normal
       flow (`position: relative; flex: 1`) 44px wide and running most of the
       height of the screen, with no ink in it.

       The shape is the point. A first cut of this walk asked only for boxes
       that were themselves out of flow and would have sailed past the very
       defect it is named for: the track was `relative`. What made it a trap
       was the overlay it sat in, not its own positioning — so the sabotage
       reproduces both halves rather than a convenient fixed strip. */
    /* UNDER ITS OWN NAMES, DELIBERATELY. Built as `.jar-dial` and
       `.jar-dial-track` it collided with the live stylesheet — those classes
       belong to the dates sheet now — and what the walk then found was a
       hybrid the product shaped, not the defect. The sabotage has to be the
       thing it claims to be. */
    await ctx.addInitScript(() => {
      window.addEventListener("load", () => {
        const overlay = document.createElement("div");
        overlay.className = "e2e-sabotage-rail";
        overlay.setAttribute(
          "style",
          "position:fixed;left:110px;top:50px;width:44px;height:370px;padding:0;" +
            "margin:0;border:0;display:flex;flex-direction:column;z-index:40",
        );
        const track = document.createElement("div");
        track.className = "e2e-sabotage-track";
        track.setAttribute("style", "position:relative;flex:1;padding:0;margin:0;border:0");
        overlay.appendChild(track);
        document.body.appendChild(overlay);
      });
    });
  }
  const page = await ctx.newPage();
  const found: Finding[] = [];
  const scopes: Array<{ surface: string; scope: Scope }> = [];
  const take = async (surface: string): Promise<void> => {
    const r = await sweep(page, surface);
    found.push(...r.found);
    scopes.push({ surface, scope: r.scope });
  };

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  await take("the door");

  await page.click("#login-tab-signup");
  const email = `invisible-${uniq()}@example.test`;
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.fill("input[name=name]", "Invisible");
  await page.click("button[type=submit]");
  await page.waitForTimeout(8_000);

  /* THE WORLD NEEDS SOMETHING IN IT. An empty account has no count, no
     memories and no word to wind back from, so most of the chrome this walk
     exists to look at is not mounted at all. */
  for (const text of [
    "a press that lands on nothing is a press taken",
    "the ink is the promise that something is there",
  ]) {
    await openTheNotepad(page);
    await page.waitForTimeout(700);
    await page.fill('textarea[aria-label="Capture inspiration"]', `${text} ${uniq()}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4_500);
  }
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await settleAfterArrival(page);
  await page.waitForTimeout(2_500);
  await take("the world");

  await openTheNotepad(page);
  await page.waitForTimeout(1_200);
  await take("the mouth open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const more = page.locator(".jar-here-more");
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.waitForTimeout(1_200);
    await take("the walls list open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  /* A WALL WITH A PAST, OR THE DATES DO NOT EXIST TO BE WALKED.
     The word that opens them is correctly absent on a wall whose whole life
     is today — there is nowhere to wind back to — and this walk is NAMED for
     the defect that lived on that surface. So one memory is aged through the
     database, the same seam `by-keyboard` uses and for the same reason: there
     is deliberately no way through the product to keep something last month.
     Scoped through this account's own address, so it is a seed and not a side
     effect on a database every walk here shares. Missing or unreachable, it
     costs this one surface and says so. */
  const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (url === undefined) {
    console.log("  (no DB_CONNECTION_URL — the wall has no past, so the dates go unwalked)");
  } else {
    const sql = postgres(url, { max: 2 });
    try {
      const aged = await sql`
        update inspirations set created_at = now() - interval '31 days'
        where id = (
          select i.id from inspirations i
          join profiles p on p.id = i.profile_id
          join accounts a on a.id = p.account_id
          where a.email = ${email}
          order by i.created_at
          limit 1
        )
        returning id
      `;
      if (aged.length === 0) {
        console.log("  (nothing was aged — the wall has no past, so the dates go unwalked)");
      }
    } catch (err) {
      console.log(
        `  (the seed could not reach the database: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(2_500);
  }

  const when = page.locator("button.jar-when");
  if ((await when.count()) > 0) {
    await when.first().click();
    await page.waitForTimeout(1_200);
    await take("the dates open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  await ctx.close();
  return { found, scopes };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const negative = argv.includes("--negative");
  const i = argv.indexOf("--base-url");
  const base = (i >= 0 ? argv[i + 1] : undefined) ?? DEFAULT_BASE;

  console.log("[nothing-invisible] every box that takes a press must draw something");
  console.log(
    negative
      ? "[nothing-invisible] NEGATIVE mode — the dial's inkless strip is back and MUST be found\n"
      : `[nothing-invisible] base url: ${base}\n`,
  );

  const browser = await launchChromium();
  let found: Finding[] = [];
  let scopes: Array<{ surface: string; scope: Scope }> = [];
  try {
    const r = await walk(browser, base, negative);
    found = r.found;
    scopes = r.scopes;
  } finally {
    await browser.close();
  }

  /* WHAT WAS ACTUALLY ASKED, PRINTED WHETHER OR NOT ANYTHING WAS FOUND. A
     sweep that judged four boxes and a sweep that judged forty look identical
     from their verdict alone, and only one of them means anything. */
  /* AN EXEMPTION NOBODY MEETS IS AN EXEMPTION NOBODY CAN AUDIT — the state
     `jar-scrim` sat in for as long as it existed. This is not fatal to the
     walk (a surface may legitimately not be reached on one run), but it is
     never silent.

     ASKED PER NEEDLE, which the first cut of this check got wrong: it asked
     whether ANY exemption had been met anywhere, so with two entries a live
     one would have masked a dead one — the same defect it was written to
     catch, one level up. Each needle answers for itself. */
  for (const e of EXEMPT) {
    if (!scopes.some((s) => s.scope.met.includes(e.needle))) {
      console.log(
        `  NOTE: nothing on any surface matched the exemption "${e.needle}". ` +
          "Either a surface went unwalked, or the exemption has outlived the thing it excused.",
      );
    }
  }
  console.log("  what each surface offered, and how much of it could be judged:");
  for (const { surface, scope } of scopes) {
    console.log(
      `    ${surface}: ${scope.candidates} boxes take a press inside themselves — ` +
        `${scope.judged} judged, ${scope.exempt} exempt by decision, ` +
        `${scope.movedOn} dropped for changing on their own, ` +
        `${scope.ownGround} unpainted over their own surface`,
    );
  }
  console.log("");

  /* THE STRIP ITSELF, NOT MERELY SOMETHING. The verdict used to read
     `found.length > 0`, and printed "the strip among them" on the strength of
     it — so a run where the sabotage never mounted and some unrelated box was
     reported would have passed while claiming a thing it had not checked.
     That is the failure this whole file is written against, in the file
     itself. */
  const strip = found.filter((f) => f.what.includes("e2e-sabotage"));

  if (found.length === 0 || (negative && strip.length === 0)) {
    console.log(
      negative
        ? "[nothing-invisible] FAIL — the strip was put back and the walk did not find it" +
          (found.length === 0 ? "" : ` (it found ${found.length} other box(es), which is not the same)`)
        : "[nothing-invisible] PASS — nothing takes a press without drawing something",
    );
    return negative ? 1 : 0;
  }

  for (const f of found) {
    console.log(`  ${f.surface}`);
    console.log(`    ${f.what}`);
    console.log(
      `      ${f.box}, winning the hit test at ${f.points} point(s) inside itself, ` +
        `drawing nothing, and taking the press meant for ${f.behind.join(", ")}`,
    );
  }
  console.log("");
  console.log(
    negative
      ? `[nothing-invisible] PASS — ${found.length} found, and ${strip.length} of them ` +
        `IS the strip put back`
      : `[nothing-invisible] FAIL — ${found.length} box(es) take a press and draw nothing`,
  );
  return negative ? 0 : 1;
}

void main().then((code) => {
  process.exitCode = code;
});
