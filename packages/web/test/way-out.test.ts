/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. This reads source text off
 * disk and asserts a property of it. No component mounts, no module is
 * imported for its behaviour, and no server, DOM or account data is used —
 * there is nothing here that could be mocked, which is the point: a ruling
 * enforced by a gate does not depend on anyone remembering to mount the
 * surface it governs. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══ LAW 2: EVERY SURFACE HAS A WAY OUT YOU CAN SEE ═══
 *
 * The founder's most-repeated complaint, in their own words, three times on
 * three different surfaces:
 *
 *   "for your inspirations, after I click on it, I feel like I'm lost how to
 *    go back to the previous screen"
 *   "I go to my agent and then now I have no way to get back to my top of
 *    mind"
 *   "I find it so annoying that from talk with Waka, there's no one click to
 *    go back to top of mind"
 *
 * Each was fixed where it was reported, and the next one arrived anyway. That
 * is what this file is for. See `docs/six-laws.md`.
 *
 * ── WHY A GATE AND NOT A CHECKLIST ────────────────────────────────────────
 *
 * Law 3 says a change to the system has to land on every surface rather than
 * the one being looked at, and the mechanism has always been a gate: the type
 * scale drifted into two parallel systems precisely because two stylesheets
 * were not in `GOVERNED`, and the rulings about them were therefore unaudited
 * BY CONSTRUCTION. A design law with no gate is a law that holds until the
 * next surface is written.
 *
 * ── WHAT COUNTS AS A WAY OUT, AND WHAT DOES NOT ───────────────────────────
 *
 * `DialogSurface` already gives every sheet Escape, a focus trap and focus
 * restoration, and several of these also close on a press away. NONE OF THAT
 * COUNTS HERE. All of it is invisible, and invisible exits are exactly what
 * the three complaints above were describing — the archive had an address, a
 * working browser Back and a switcher naming it, and still read as a trap.
 * What counts is a control a person can SEE and press.
 *
 * So this looks for a rendered control that says it leaves: one of the way-out
 * words below, or a class named for the act. A surface with neither must say
 * why in `NO_VISIBLE_WAY_OUT`, with a reason — the same shape as
 * `verb-pairs.test.ts`, which asks every verb for a way back or a reason it
 * has none.
 */
/* `worldReflectionDone` IS OFF THIS REGISTER (2026-10-10), in the same change
   that removed the only surface wearing it. It held "Done for now", the
   visible close in the review sheet's header — and the note below still cites
   it, deliberately, because the lesson is about this gate rather than about
   that surface: a curated word list called that perfectly good exit a trap on
   its first run, which is why the structural check beneath it is the one to
   trust. The five review components are folded into the claim queue's
   correction field; a way-out word kept alive by nothing is the same leftover
   `verb-pairs.test.ts` refuses one file over, so it goes in this commit rather
   than the next one. */
const WAY_OUT_WORDS = [
  "worldClose",
  "worldCardClose",
  "worldNotNow",
  "worldEnough",
  "worldDone",
  "worldBack",
  "worldCancel",
  "worldCancelEdit",
  "worldPrinciplesBack",
  "loginBackToPage",
] as const;

/* A class named for leaving. The overlays' corner mark, and the footer rows
   that carry a single dismissing press on the surfaces built before it.

   `-back` JOINED THE LIST 2026-10-11 for the notepad's chevron, which is no
   longer there: the founder removed it the same week ("I can just go to all
   the inspirations using the bottom panel"), and the `onPast` prop it was
   wired to outlived it as a documented prop nobody called until that was
   removed too. `.jar-note-back` matches nothing in the tree today.

   THE ALTERNATION STAYS, and the reason is the one that put it here rather
   than inertia. The structural check above cannot see an exit that
   NAVIGATES — it looks for a press that calls the surface's own `onClose` —
   and it should not be taught to, because "any press that navigates counts
   as an exit" would pass a surface whose only control went deeper. A
   control NAMED for going back is the narrower claim, and it is the claim
   the law is actually about, so the next page that has one is covered
   without this argument being had again. */
const WAY_OUT_CLASSES = /className="[^"]*(?:-close\b|-out\b|-back\b|waka-over-close|jar-x)\b/;

/**
 * THE STRUCTURAL SIGNAL, WHICH IS THE ONE THAT SHOULD BE TRUSTED.
 *
 * A curated list of words is a gate that fails the day someone writes a
 * perfectly good exit with a word nobody thought of — which is exactly what
 * happened on its first run: the review surface's header has carried a
 * visible "Done for now" wired to its own close since it was written, and
 * this file called it a trap. A gate that cries wolf gets an exemption added
 * to shut it up, and then it is guarding nothing.
 *
 * So the real test is structural: is there a button a person can see whose
 * press calls the same thing the surface's own `onClose` calls? That is what
 * "a visible way out" MEANS, independent of how the label is phrased or
 * which locale key happens to hold it.
 *
 * `aria-hidden` buttons are excluded deliberately. Several surfaces render
 * their scrim as a `<button aria-hidden tabIndex={-1}>` so it is a real press
 * target — and a scrim is the invisible exit this law was written about, so
 * counting it would let every surface pass by having a backdrop.
 */
function closedByAVisibleButton(span: string): boolean {
  const closer = /onClose=\{([^}]{1,60})\}/.exec(span);
  const handlers = [...span.matchAll(/<button\b([^>]*)>/g)]
    .filter((tag) => !/aria-hidden/.test(tag[1]))
    .map((tag) => tag[1]);
  return handlers.some((attrs) => {
    const press = /onClick=\{([^}]{1,80})/.exec(attrs);
    if (!press) return false;
    const body = press[1];
    return /\bonClose\b/.test(body) || Boolean(closer && body.includes(closer[1].trim()));
  });
}

/**
 * SURFACES WITH NO VISIBLE WAY OUT, AND WHY — a list that is meant to shrink.
 *
 * An entry is a decision on the record, not an exemption from the law. Two
 * kinds are legitimate:
 *
 *   - a MENU, whose every row leaves it, so a row that only undoes the press
 *     that opened it is the "Close menu" row the founder deleted: "this also
 *     is so useless."
 *   - a surface whose own content is a flow that finishes, where the finish
 *     IS the way out and a second control beside it would be two ways to
 *     agree.
 *
 * "It has Escape" is not a reason. "Nobody has complained" is not a reason.
 */
/**
 * THE THIRD LEGITIMATE KIND — A DESTINATION, LEFT BY THE BAR.
 *
 * Founder, 2026-10-11: "how do we even need the close button for inspiration
 * and chat? It's supposed to just be moving around. I mean for principles
 * too. There's no reason for there to be an X button when we're just moving
 * across the pages."
 *
 * Right, and this gate would have called that a trap. Its premise — a
 * surface must contain a control that leaves it — is the premise of a MODAL,
 * and these four stopped being modals when they became the dock's
 * destinations. The dock is visible the entire time one is open, it never
 * moves, and its first row is called Now. That is a visible way out costing
 * one press, which is the whole of the law; it simply is not INSIDE the
 * span this file reads.
 *
 * ── THAT PARAGRAPH WAS FALSE FOR EVERYONE WORKING FROM A KEYBOARD, AND IT
 *    IS TRUE NOW (2026-10-11) ───────────────────────────────────────────────
 *
 * It is left standing word for word above, because it is the right argument
 * and because what went wrong is worth having in one place: the sentence
 * "these four stopped being modals when they became the dock's destinations"
 * was a statement about the DESIGN that nobody had made true of the MARKUP.
 * All four still rendered through `DialogSurface` with `role="dialog"`,
 * `aria-modal` and a Tab trap — so Tab wrapped back to the first control
 * inside the page, `aria-modal` deleted the bar from the accessibility tree,
 * and the dock this exemption rests on could not be reached at all. Measured
 * in a browser before the fix, on each of the three destinations the bar has
 * a row for: sixty presses of Tab and sixty of Shift+Tab, and the bar was
 * never once reached.
 *
 * So for a keyboard user these four surfaces had NO way out — and THIS FILE,
 * the gate whose only job is to catch that, was the thing excusing it. That
 * is the worst failure available to a gate, worse than being absent: an
 * exemption reads as a decision somebody made, so the next person checks it
 * off rather than checking it.
 *
 * `DialogSurface` takes `modal={false}` now and the four pass it. Tab walks
 * out of a destination into the bar, forwards and backwards, and the bar is
 * `region`-shaped content rather than a dialog over a blocked screen.
 *
 * SO THE GATE IS TAUGHT, NOT EXEMPTED, and the difference is the three things
 * it checks below. An entry here is a claim with a mechanism behind it:
 *
 *   1. the dock really offers this destination — the id is in its own list
 *      in `Home.tsx`, so renaming or dropping a row fails here rather than
 *      silently leaving a surface with no exit at all;
 *   2. the dock really renders while this destination is open — its render
 *      condition does not exclude `view.open`, which is the bug this product
 *      shipped for a conversation and the founder reported as being trapped;
 *   3. THE NEW ONE, AND THE ONE WHOSE ABSENCE COST THREE MONTHS: the surface
 *      does not fence the dock off. A destination declares `modal={false}`,
 *      which is the one textual fact that decides whether focus can leave it.
 *
 * WHAT CHECK 3 CAN AND CANNOT DO, said plainly so nobody trusts it further
 * than it goes. It reads source text, so it proves the prop is passed and
 * nothing more; it cannot see a focus order. The press itself is held in a
 * browser, by `tools/e2e/by-keyboard.ts`, which opens each destination from
 * the bar with keys alone and then counts the presses back to it in both
 * directions. That walk is where this exemption is actually earned. Check 3
 * is the cheap half that runs on every commit and would have failed on the
 * day the bug was introduced.
 *
 * `home-navigation.test.tsx` presses the thing; this proves the claim made
 * here is still the shape of the product. A surface added to this map that
 * is not actually a dock destination fails both checks.
 */
const LEFT_BY_THE_DOCK: Record<string, string> = {
  /* THE NOTEPAD JOINED 2026-10-11, and it is the entry that needed the
     most argument because it is the only one that HAD a visible exit and
     gave it up.

     Founder: "I still don't get why you have this carrot button when I do
     new inspiration, because I can just go to all the inspirations using
     the bottom panel. So don't do that."

     That is this map's premise stated by the person it is for. The chevron
     had already been argued down twice — it lost its box ("why is this
     still here?") and then its words ("remove the all inspirations thing")
     — and what was left was a glyph pointing at a room the dock names in a
     word and reaches in one press. Three rounds of making a control
     quieter, when the finding was that it was a second door.

     THE VALUE IS "saves" BECAUSE THAT IS WHERE IT LEAVES TO: pressing
     Inspirations from a note goes to the archive the note is about to join,
     which is where the chevron went. The checks below then hold the claim
     to the product — the row has to exist, and the bar has to be up while
     this page is open, which the compose check further down now asserts
     directly rather than by implication.

     ═══ THE VALUES ARE BAR ROW IDS SINCE 2026-10-15 ═════════════════════
     Founder: "at the bottom bar just keep inspiration and chat". Each value
     is now the id of the row that LIGHTS on that page, because the lit row
     pressed again is the page's way home: the notepad and the archive light
     'inspiration', the chats list lights 'talk'. Two entries have no row and
     are proved another way below: Principles ("principle is sth user can only
     get by dragging") walks home on ← or a pull left, and leaves by either
     bar row; claims is reached from the home screen. */
  "components/InspirationComposer.tsx": "inspiration",
  "components/SavesOverlay.tsx": "inspiration",
  "components/ConversationsOverlay.tsx": "talk",
  "components/PrinciplesOverlay.tsx": "walked",
  "components/ClaimsOverlay.tsx": "claims",
};

/**
 * THE ONE ENTRY ABOVE THAT LEANS ON THE BAR AND IS STILL A SHEET.
 *
 * Check 3 asks every destination for `modal={false}`, and the notepad does
 * not pass it, on purpose and for a reason that is about the material rather
 * than about navigation: IT HOLDS WORDS NOBODY HAS SAVED YET. The audit's
 * §2.1(d) wants it harder to leave by accident, not easier — quoting the
 * reference library's `Dialog` page, *"so the user can't accidentally lose
 * data by clicking the backdrop"* — and a half-written note is the one thing
 * on any of these five surfaces that a stray press can destroy.
 *
 * SO WHY IS IT NOT THE SAME BUG? Because the thing a person needs to reach
 * from inside the notepad is in the bar and IS REACHED. Measured in a
 * browser: from the note's field, one press of Tab lands on the dock. The
 * walk in `tools/e2e/by-keyboard.ts` has depended on this since it was
 * written — "the keep is the button in the corner, which is what a person
 * tabs to" — and it tabs out of the notepad into `waka-dock-tool--keep` to
 * save without a mouse. The route exists because the notepad is rendered
 * ABOVE the bar in `Home.tsx`'s source, so the trap's wrap-around sits past
 * the dock rather than before it.
 *
 * THAT IS LUCK, AND IT IS RECORDED HERE AS LUCK. It depends on source order
 * in a 18,000-line file and on which of the surface's children the trap's own
 * walk happens to call last; move the composer below the dock and the keep
 * button becomes unreachable with the keyboard, which is the save gesture
 * gone rather than a way out gone. The browser walk is what would catch that,
 * and it is the reason this entry is an exemption with a measurement behind
 * it rather than a hole.
 */
const A_SHEET_ON_PURPOSE: Record<string, string> = {
  "components/InspirationComposer.tsx":
    "the notepad holds unsaved words, so it stays a sheet (audit §2.1(d)); its " +
    "route to the bar is proved by by-keyboard's keeping walk, which tabs from " +
    "the note's field into the dock's keep tool",
};

/** A span with its comments taken off, so a prop QUOTED in an argument about
    the prop is not mistaken for the prop. Three of the four destinations
    explain `modal={false}` in a comment sitting in the attribute position —
    read naively, the explanation would satisfy the check that the explanation
    is about, which is the most embarrassing way for a gate to pass. */
function code(span: string): string {
  return span.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const DECLARES_A_PAGE = /modal=\{false\}/;

/**
 * ═══ AND ONE SURFACE AT A TIME, WHERE A WHOLE FILE IS TOO BLUNT ═════════
 *
 * `LEFT_BY_THE_DOCK` is keyed by FILE, which is right for the overlays —
 * each of those files is one destination. `Home.tsx` renders five surfaces
 * and only one of them leans on the bar; exempting the file would stop the
 * law being checked on the other four, which is how a completeness check
 * quietly stops checking.
 *
 * So the claim is made where it is true, on the surface itself:
 * `data-way-out="dock"`. The same two things are still proved about it —
 * the dock offers that destination and the dock is up while it is open —
 * because the id is checked against the bar's own list below, exactly as a
 * file-keyed entry is.
 *
 * Founder, whose ruling this is: "I still don't get why you have this
 * carrot button ... I can just go to all the inspirations using the bottom
 * panel." Said of the notepad; Law 7 carried it to the chat.
 */
const SURFACE_LEFT_BY_DOCK = /data-way-out="([a-z]+)"/;

const NO_VISIBLE_WAY_OUT: Record<string, string> = {
  /* EMPTY, AND IT EMPTIED ITSELF. Both entries named corner MENUS — lists
     whose every row leaves them, so the only control they could add is the
     "Close menu" row the founder cut as useless. Neither is a menu now: the
     left corner became one press that opens conversations, and the
     conversations list it opens is an overlay with a visible close like every
     other. The ratchet below caught the stale entries the same day, which is
     the behaviour it exists for — an exemption that outlives its reason
     excuses nothing while reading as if it does. */
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Each `<DialogSurface` and the text up to its matching close tag. Nesting
    is real — the archive opens a card sheet inside itself — so this counts
    depth rather than taking the first close tag it meets. */
function surfacesIn(text: string): string[] {
  const spans: string[] = [];
  const open = /<DialogSurface\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text))) {
    let depth = 0;
    let at = match.index;
    const tag = /<DialogSurface\b|<\/DialogSurface>/g;
    tag.lastIndex = at;
    let edge: RegExpExecArray | null;
    while ((edge = tag.exec(text))) {
      depth += edge[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        at = edge.index + edge[0].length;
        break;
      }
    }
    /* A self-closing surface renders nothing of its own, so there is nothing
       in it to find a way out of. */
    spans.push(text.slice(match.index, at));
  }
  return spans;
}

function hasWayOut(span: string): boolean {
  return (
    closedByAVisibleButton(span) ||
    WAY_OUT_CLASSES.test(span) ||
    WAY_OUT_WORDS.some((word) => span.includes(word))
  );
}

describe("every surface has a way out you can see", () => {
  const files = sourceFiles("src").filter((path) => readFileSync(path, "utf8").includes("<DialogSurface"));

  it("finds the surfaces at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. If the
       component is renamed, or the walk stops matching, every assertion below
       goes vacuously green and the law stops being enforced silently — which
       is the failure mode this whole file exists to prevent, one level up. */
    /* FLOORS, NOT A CENSUS. These were 12 and 18, which was the count on the
       day they were written — so the gate went red the first time a surface
       was legitimately removed, and a tripwire that fails on honest deletion
       teaches people to edit the tripwire. They exist to catch "this gate is
       reading nothing", which is a different question from "how many
       surfaces are there". The dropdown's sheet is the one that went: the
       three rungs are laid out now rather than listed. */
    expect(files.length, "no file renders a DialogSurface — has it been renamed?").toBeGreaterThanOrEqual(8);
    const spans = files.flatMap((path) => surfacesIn(readFileSync(path, "utf8")));
    expect(spans.length, "found the files but parsed no surfaces out of them").toBeGreaterThanOrEqual(10);
    /* And the spans must have real content: a balanced-match bug that
       returned the opening tag alone would find no way out anywhere and
       produce a wall of false failures rather than silence. */
    expect(Math.min(...spans.map((span) => span.length))).toBeGreaterThan(80);
  });

  it("offers a visible way out, or says why it does not", () => {
    const trapped: string[] = [];
    for (const path of files) {
      const key = path.replace(/^src\//, "");
      const spans = surfacesIn(readFileSync(path, "utf8"));
      const without = spans.filter(
        (span) => !hasWayOut(span) && !SURFACE_LEFT_BY_DOCK.test(span),
      );
      if (!without.length || NO_VISIBLE_WAY_OUT[key] || LEFT_BY_THE_DOCK[key]) continue;
      trapped.push(
        `${key}: ${without.length} of ${spans.length} surface(s) render no control that leaves.\n` +
          "    Escape and a press-away do not count — both are invisible, and " +
          "invisible exits are what the founder reported three times.\n" +
          "    Add a control a person can see, or put this file in " +
          "NO_VISIBLE_WAY_OUT with a reason.",
      );
    }
    expect(trapped, `\n${trapped.join("\n")}\n`).toEqual([]);
  });

  it("keeps the dock standing over every destination that leans on it", () => {
    const home = readFileSync(join("src", "pages", "Home.tsx"), "utf8");
    /* THE BAR'S OWN LIST, read out of the source rather than restated here —
       a second copy of it would agree with this file and not with the
       product. */
    const dock = /className=\{`waka-dock-item/.test(home)
      ? [...home.matchAll(/\{ id: '([a-z]+)', label: 'worldDock/g)].map((hit) => hit[1]!)
      : [];
    /* TWO ROWS SINCE 2026-10-15. Founder: "at the bottom bar just keep
       inspiration and chat and clicking on it leads to new inspiration and
       new chat" — Now, the plus and Principles left the bar. Exact, not a
       floor: a third row coming back is a design change, not drift. */
    expect(dock, "the dock's item list could not be read out of Home.tsx, or it is not the two rows").toEqual(["inspiration", "talk"]);

    /* AND THE LIT ROW IS ITS OWN WAY HOME. With Now gone from the bar, the
       one-press visible exit from every page a row lights is that row pressed
       again — so each row must (a) light somewhere, and (b) in that state
       walk home rather than make another new one. Read out of each row's own
       entry, so moving the home step out of a row fails here. */
    const rowSource = (id: string): string => {
      const start = home.indexOf(`{ id: '${id}', label: 'worldDock`);
      const rest = home.slice(start + 1);
      const next = rest.search(/\{ id: '[a-z]+', label: 'worldDock|\]\)\.map\(item/);
      return code(rest.slice(0, next));
    };
    const inspiration = rowSource("inspiration"), talk = rowSource("talk");
    expect(inspiration, "Inspiration no longer lights on a new note or the archive").toMatch(/here:[^\n]*view\?\.compose[^\n]*open === 'saves'/);
    expect(inspiration, "Inspiration pressed on a new note no longer folds it into a draft and goes home").toMatch(/view\?\.compose\)[^;\n]*saveAsDraft\b/);
    expect(inspiration, "Inspiration pressed on the archive no longer goes home").toMatch(/open === 'saves'\)[^;\n]*openOverHome\(null\)/);
    expect(talk, "Chat no longer lights on the chats list or a conversation").toMatch(/here:[^\n]*open === 'conversations'[^\n]*conversationId/);
    expect(talk, "Chat pressed on the chats or a conversation no longer goes home").toMatch(/conversationId\)[^;\n]*openOverHome\(null\)/);

    /* The condition the dock renders under. A destination may only lean on
       the bar if the bar is actually up while it is open — which is exactly
       what was NOT true of a conversation until it was fixed, and exactly
       what being trapped feels like. */
    const condition = /\{phase==='ready'&&([^?]*)\?[\s\S]{0,40}?<nav className="waka-dock"/.exec(home);
    expect(condition, "the dock's render condition could not be found").toBeTruthy();
    expect(
      condition![1],
      "the dock is hidden while a destination is open, so the surfaces in " +
        "LEFT_BY_THE_DOCK have no way out at all",
    ).not.toMatch(/view\?\.open/);
    /* AND IT STANDS ON THE NOTEPAD, which is the newest entry in that map
       and the only one whose own exit was removed on the strength of this
       being true. A condition that hid the bar while `view.compose` was set
       would leave a half-written note with no way out at all — the exact
       trap this file is named for, reintroduced by a change that looks like
       tidying. */
    expect(
      condition![1],
      "the dock is hidden while a note is being written, and the notepad " +
        "gave up its chevron on the promise that it would not be",
    ).not.toMatch(/view\?\.compose/);

    /* THE PER-SURFACE CLAIMS, held to the same bar. A surface that says
       `data-way-out="x"` is asserting that the dock has a row called `x`;
       if that row is renamed or dropped, the surface has no exit at all
       and this is where it is caught. */
    const claimed = [...readFileSync(join("src", "pages", "Home.tsx"), "utf8")
      .matchAll(/data-way-out="([a-z]+)"/g)].map((hit) => hit[1]!);
    expect(claimed.length, "no surface claims the dock as its way out any more — was the attribute renamed?")
      .toBeGreaterThanOrEqual(1);
    for (const id of claimed) {
      expect(dock, `a surface says the dock's "${id}" row is its way out, and the dock has no such row`)
        .toContain(id);
    }

    /* STRICTER THAN IT WAS. This read `!dock.includes(id) && !DialogSurface`,
       which let a value naming no row pass as long as the file was still a
       surface. With the values now being the lit row, a value that names no
       row is a page whose way home does not exist, so it fails on its own. */
    const orphans = Object.entries(LEFT_BY_THE_DOCK).filter(([file, id]) => {
      let text: string;
      try { text = readFileSync(join("src", file), "utf8"); } catch { return true; }
      if (!text.includes("<DialogSurface")) return true;
      /* `claims` is reached from the home screen rather than from a row of
         its own, and `walked` is Principles, whose home step is proved just
         below — both are allowed to be absent from the bar. */
      return id !== "claims" && id !== "walked" && !dock.includes(id);
    });
    expect(
      orphans.map(([file]) => file),
      "these surfaces say the dock is their way out, and the dock does not " +
        "offer them. Either restore the row or give the surface its own exit.",
    ).toEqual([]);

    /* ═══ PRINCIPLES, WHICH IS WALKED TO AND WALKED BACK FROM ═══════════
       It used to be "the dock holds Principles". Since 2026-10-15 it does
       not — "principle is sth user can only get by dragging" — so the new
       truth is held instead: the way home is the walk's mirror (← on the
       page, a pull left on the page), Esc still closes it, and the bar stays
       up over it (the render condition above) so either row leaves it in one
       visible press. `home-navigation.test.tsx` presses ← and the bar row. */
    const principles = code(readFileSync(join("src", "components", "PrinciplesOverlay.tsx"), "utf8"));
    expect(principles, "Principles lost its pull-left walk home").toMatch(/onPointerUp=\{[\s\S]{0,400}?-dx >= PULL_HOME[\s\S]{0,80}?onClose\(\)/);
    expect(code(home), "← on Principles no longer walks home").toMatch(/event\.key === 'ArrowLeft' && principlesOpen[^\n]*\)\s*\{[^}]*openOverHome\(null\)/);
  });

  it("leaves the dock reachable from inside every destination that leans on it", () => {
    /* ═══ CHECK 3 — THE ONE THAT WAS MISSING ═══════════════════════════════
       The two checks above prove the bar EXISTS while a destination is open.
       Neither of them, and nothing else in this repository, asked whether a
       person standing in the destination can GET to it — and for three months
       they could not: all four rendered `role="dialog"`, `aria-modal` and a
       Tab trap while this file excused them on the strength of the bar being
       their way out.

       A source-reading gate cannot walk a focus order, so it holds the one
       textual fact the focus order follows: a destination says
       `modal={false}`. That is what `DialogSurface` reads to decide whether
       to swallow Tab, and it is what would have gone red on the day the bug
       was written. The press itself belongs to `tools/e2e/by-keyboard.ts`,
       which opens each destination from the bar with keys alone and counts
       the presses back — and that walk is named in the failure below, because
       a gate that reports half a fact should say where the other half is. */
    const fenced: string[] = [];
    const fence = (where: string): void => {
      fenced.push(
        `${where}: this surface says the dock is its way out and renders as a MODAL.\n` +
          "    A modal traps Tab and declares aria-modal, so the dock cannot be reached " +
          "and is not in the accessibility tree — the exemption in LEFT_BY_THE_DOCK is " +
          "false and this destination has no way out at all.\n" +
          "    Pass modal={false} to DialogSurface, or give the surface a visible exit of " +
          "its own. Then prove it with `pnpm e2e:by-keyboard`.",
      );
    };

    for (const [file] of Object.entries(LEFT_BY_THE_DOCK)) {
      if (A_SHEET_ON_PURPOSE[file]) continue;
      const spans = surfacesIn(readFileSync(join("src", file), "utf8"));
      /* Every surface in the file, not the first: the archive opens a card
         sheet inside itself, and a file-keyed exemption that only looked at
         one span would stop checking the moment a second arrived. */
      for (const span of spans) {
        if (!DECLARES_A_PAGE.test(code(span))) fence(file);
      }
    }

    /* AND THE PER-SURFACE CLAIMS, where `Home.tsx` makes one. `data-way-out`
       and `modal={false}` are the same statement said twice — once to this
       gate and once to the browser — so a surface that says one without the
       other is telling two different stories about the same exit. */
    const home = readFileSync(join("src", "pages", "Home.tsx"), "utf8");
    for (const span of surfacesIn(home)) {
      const claim = SURFACE_LEFT_BY_DOCK.exec(span);
      if (!claim) continue;
      if (!DECLARES_A_PAGE.test(code(span))) fence(`pages/Home.tsx (data-way-out="${claim[1]}")`);
    }

    expect(fenced, `\n${fenced.join("\n")}\n`).toEqual([]);
  });

  it("keeps no excuse for being a sheet that no longer leans on the dock", () => {
    /* THE RATCHET ON CHECK 3'S OWN EXEMPTION, same argument as the two below
       it: an exemption that outlives its reason excuses nothing while reading
       as if it does. If the notepad ever stops claiming the dock as its way
       out, or stops being a surface at all, this entry has to go with it
       rather than sit here looking considered. */
    const stale = Object.keys(A_SHEET_ON_PURPOSE).filter((key) => {
      if (!LEFT_BY_THE_DOCK[key]) return true;
      try {
        return !readFileSync(join("src", key), "utf8").includes("<DialogSurface");
      } catch {
        return true;
      }
    });
    expect(
      stale,
      "these files are excused from declaring themselves pages, and they no " +
        "longer lean on the dock (or no longer exist). Drop the entry.",
    ).toEqual([]);
  });

  it("keeps no excuse for a surface that has one, or does not exist", () => {
    /* THE OTHER HALF OF THE RATCHET. An exemption outliving its reason is how
       a completeness check quietly stops checking: it reads as considered and
       excuses something nobody decided. Same argument as `goal-index`'s
       exemption case and `verb-pairs`' dead-entry case. */
    const stale = Object.keys(NO_VISIBLE_WAY_OUT).filter((key) => {
      const path = join("src", key);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return true;
      }
      return surfacesIn(text).every((span) => hasWayOut(span));
    });
    expect(
      stale,
      "an entry naming a file that is gone, or a surface that now has a " +
        "visible way out, excuses nothing while reading as if it does.",
    ).toEqual([]);
  });
});
