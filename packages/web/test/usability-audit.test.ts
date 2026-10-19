/**
 * THE CASCADE HALF OF THE OCTOBER USABILITY AUDIT (f2afcbe2).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the stylesheets off
 * disk as text, because every finding here was a rule that LOST or WON the
 * cascade in a real browser while jsdom — which computes no specificity and
 * hit-tests nothing — would have pressed the control and reported success.
 * Each case names the audit screenshot it answers, so a regression can be
 * read against the picture that found it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { clockWords } from "../src/lib/words";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const sheet = (name: string) => readFileSync(resolve(STYLES, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule whose selector list contains `selector`, as [selector, body]. */
function rules(css: string, test: (selector: string) => boolean): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    if (test(selector) || selector.split(",").some((part) => test(part.trim()))) found.push([selector, match[2]!]);
  }
  return found;
}

describe("the chosen shelf tab keeps its label under the pointer (#39)", () => {
  it("no hover rule on .waka-tab can repaint the lit tab", () => {
    const hovers = rules(sheet("claims.css"), (s) => /\.waka-tab(?![-\w])[^ ]*:hover/.test(s));
    expect(hovers.length).toBeGreaterThan(0);
    for (const [selector, body] of hovers) {
      if (!/color\s*:/.test(body)) continue;
      expect(selector, "a .waka-tab:hover colour must exclude .waka-tab--on").toMatch(/:not\(\.waka-tab--on\)/);
    }
  });
});

describe("the bar and the corners light up when the keyboard reaches them (#5)", () => {
  /* Their `outline` lost to the unlayered floor in layers.css, and the
     brightness filter alone moved pale text a few levels: no visible focus.
     The answer has to be LIGHT (a background), never an outline — the floor
     exists because the founder banned the ring. */
  for (const control of [".waka-dock-item", ".waka-dock-tool", ".waka-corner"]) {
    it(`${control}:focus-visible draws light, not a ring`, () => {
      const focus = rules(sheet("claims.css"), (s) => s === `${control}:focus-visible`);
      expect(focus.some(([, body]) => /background\s*:/.test(body))).toBe(true);
      for (const [, body] of focus) expect(body).not.toMatch(/outline\s*:/);
    });
  }
});

describe("no share sheet has the bar painted over its footer (#9)", () => {
  it("the dock steps aside while any share sheet is open", () => {
    const hide = rules(sheet("claims.css"), (s) => /^body:has\(.*\.jar-thing-share.*\) \.waka-dock(:not\(.*\))?$/.test(s));
    expect(hide).toHaveLength(1);
    expect(hide[0]![0]).toContain(".jar-principle-share");
    expect(hide[0]![1]).toMatch(/visibility\s*:\s*hidden|display\s*:\s*none/);
    // Never while a recording or dictation runs: its Stop stays reachable (review).
    expect(hide[0]![0]).toMatch(/\.waka-dock:not\(:has\(\.waka-dock-tool--live\)\)$/);
  });
});

describe("the recording clock is never read out every second (review of #11)", () => {
  it("is one m:ss shape everywhere", () => {
    expect([clockWords(0), clockWords(7), clockWords(65.9), clockWords(600), clockWords(-3)]).toEqual(["0:00", "0:07", "1:05", "10:00", "0:00"]);
  });
  /* jsdom cannot run a MediaRecorder in the world, so the markup is read:
     every place the per-second clock is printed is `aria-hidden`, and no live
     region wraps it. */
  for (const file of ["pages/Home.tsx", "components/NoteTools.tsx"]) {
    it(file, () => {
      const source = readFileSync(resolve(STYLES, "..", file), "utf8");
      // One shared m:ss formatter (`clockWords`), never a hand-rolled one (review).
      expect(source).not.toMatch(/recording\.seconds % 60/);
      const clocks = [...source.matchAll(/<span([^>]*)>\{clockWords\((?:props\.)?recording\.seconds\)\}/g)];
      expect(clocks.length).toBeGreaterThan(0);
      for (const [, attributes] of clocks) {
        expect(attributes).toContain('aria-hidden="true"');
        expect(attributes).not.toContain("role=");
      }
      expect(source).not.toMatch(/waka-dock-state--live" role="status"/);
      if (file === "pages/Home.tsx") {
        // One "Recording" region at a time (round 6): the foot only while the
        // mouth is closed, the bar's fallback only while it is open.
        expect(source).toMatch(/recording\.phase !== 'idle' && mouthOpen \? say\('worldComposerRecordingNow'\)/);
        const foot = source.indexOf('<div className="waka-composer-foot"');
        expect(source.slice(foot - 60, foot)).toContain("!mouthOpen ?");
      }
      // The composer foot's "Recording · Ns" too (review round 5).
      expect(source).not.toMatch(/role="status">\s*\{formatMessage\(locale, 'worldComposerRecordingFor'/);
      const counts = [...source.matchAll(/<span([^>]*)>\{formatMessage\(locale, 'worldComposerRecordingFor'/g)];
      for (const [, attributes] of counts) expect(attributes).toContain('aria-hidden="true"');
    });
  }
});

describe("Cancel recording is its own bar item, beside Stop (review)", () => {
  /* Inside the state line (overflow: hidden, ellipsized) it was clipped and
     its press cut to ~17px on a phone. The browser check (390x844 and
     1440x900, a fake microphone, a long state line) is in the PR notes; this
     holds the cause: Cancel is a dock item outside the state line, with a
     44px floor that never shrinks. */
  it("is a dock item, not inside the state line, and never narrower than 44px", () => {
    const home = readFileSync(resolve(STYLES, "..", "pages/Home.tsx"), "utf8");
    const cancel = home.indexOf("{say('worldComposerCancelRecording')}");
    expect(cancel).toBeGreaterThan(0);
    const opening = home.lastIndexOf("<button", cancel);
    expect(home.slice(opening, cancel)).toContain('className="waka-dock-item waka-dock-cancel"');
    const stateLine = home.lastIndexOf('<span className="waka-dock-state"', cancel);
    const stateEnd = stateLine < 0 ? -1 : home.indexOf("</span>", stateLine);
    expect(stateLine < 0 || stateEnd < opening, "Cancel sits inside the state line").toBe(true);
    const css = sheet("claims.css");
    const own = rules(css, (s) => s === ".waka-dock-cancel").map(([, b]) => b).join("\n");
    expect(own).toMatch(/flex:\s*none/); expect(own).toMatch(/min-width:\s*var\(--waka-corner\)/);
    expect(rules(css, (s) => s === ".waka-dock-item").map(([, b]) => b).join("\n")).toMatch(/min-height:\s*var\(--waka-corner\)/);
  });
});

describe("every small control takes a 44px press (#18)", () => {
  it("each named control carries a hit box at least 44 on each side", () => {
    const css = sheet("claims.css");
    // Nor the attachment drawer's ×: a 44px box spilled onto the filename and
    // the failure line, removing the attachment with no undo (review).
    expect(rules(css, (s) => s === ".waka-drawer-items button::after")).toHaveLength(0);
    for (const control of [".waka-dock-undo", ".chat-with-choice", ".chat-send", ".jar-harvest-skip", ".waka-held-open"]) {
      const box = rules(css, (s) => s === `${control}::after`).map(([, b]) => b).join("\n");
      expect(box, control).toMatch(/width:\s*max\(100%,\s*44px\)/);
      expect(box, control).toMatch(/height:\s*max\(100%,\s*44px\)/);
    }
  });
  /* The photo's × (audit f2afcbe2: 28x28 on a 390x844 phone). An overlay box
     was clipped by the tile and, centred, covered the photo. So the BUTTON is
     44 and reaches 16px past the tile's top/right edge into the shelf's gap,
     the tile no longer clips, and the gap and the shelf's end padding hold
     that reach so it never lands on a neighbouring tile or scrolls the
     notepad sideways. Measured in Chromium at 320-1440 wide: the whole 44
     box takes the press, and no point of a photo or a file tile outside the
     ×'s own 28px corner does. */
  it("the photo's × is a 44px button that reaches away from the picture", () => {
    const css = sheet("chrome.css");
    const body = (selector: string) => rules(css, (s) => s === selector).map(([, b]) => b).join("\n");
    expect(rules(css, (s) => s.startsWith(".jar-tile-x::"))).toHaveLength(0);
    expect(body(".jar-tile"), "the tile clips the ×'s press").not.toMatch(/overflow\s*:\s*hidden/);
    const x = rules(css, (s) => s === ".jar-tile-x" || s === ".jar-inspiration-composer .jar-tile-x")
      .filter(([sel]) => !sel.includes("retry")).map(([, b]) => b).join("\n");
    for (const prop of ["width", "height", "min-width", "min-height"]) {
      expect(x, prop).toMatch(new RegExp(`(^|[^-])${prop}:\\s*var\\(--sp-44\\)`));
    }
    expect(x).toMatch(/top:\s*calc\(-1 \* var\(--sp-16\)\)/);
    expect(x).toMatch(/right:\s*calc\(-1 \* var\(--sp-16\)\)/);
    expect(x, "the drawn corner must stay where the old 28px one was").toMatch(/padding:\s*var\(--sp-16\) var\(--sp-16\) 0 0/);
    expect(x, "a rounded 44 box hit-tests rounded").toMatch(/border-radius:\s*0;/);
    const shelf = body(".jar-shelf");
    expect(shelf).toMatch(/gap:\s*calc\(var\(--sp-16\) \+ 1px\)/);
    expect(shelf).toMatch(/padding:\s*0 var\(--sp-16\) 0 0/);
    const tsx = readFileSync(resolve(STYLES, "..", "components/InspirationComposer.tsx"), "utf8");
    expect(tsx).toContain('<span className="jar-tile-x-face" aria-hidden="true">×</span>');
  });
  it("the saves search input fills its 44px row", () => {
    const input = rules(sheet("claims.css"), (s) => s === ".waka-over-search").map(([, b]) => b).join("\n");
    expect(input).toMatch(/align-self:\s*stretch/);
  });
});

describe("a phone turned sideways keeps its chrome out of the notch (#15)", () => {
  /* Headless Chromium cannot emulate a notch, so env() is checked where it
     has to be read: nothing in the product read the left/right insets. */
  it("the corners, the page gutter and the dock all read the side insets", () => {
    const css = sheet("claims.css");
    const body = (selector: string) => rules(css, (s) => s === selector).map(([, b]) => b).join("\n");
    for (const selector of [".waka-corners", ".waka-page", ".waka-dock"]) {
      expect(body(selector), selector).toMatch(/safe-area-inset-left/);
      expect(body(selector), selector).toMatch(/safe-area-inset-right/);
    }
  });
  it("the corner card's height bound leaves the home indicator's band", () => {
    const account = rules(sheet("claims.css"), (s) => s === ".waka-account").map(([, b]) => b).join("\n");
    expect(account).toMatch(/max-height:[^;]*safe-area-inset-bottom/);
    expect(account).toMatch(/overflow-y:\s*auto/);
  });
});

describe("the principles creature never stands between a press and a card", () => {
  it("its aura box takes no press (#3: it swallowed clicks on the first principle)", () => {
    const being = rules(sheet("claims.css"), (s) => s === ".waka-ground-being");
    expect(being.some(([, body]) => /pointer-events\s*:\s*none/.test(body))).toBe(true);
  });
  it("on the walk in, the cards arrive after the glide starts, not before (#17)", () => {
    const css = sheet("claims.css");
    const page = rules(css, (s) => s === ".waka-page--crossing-in .waka-over")[0]![1];
    const cards = rules(css, (s) => s === ".waka-page--crossing-in .waka-held")[0]![1];
    const delay = (body: string) => Number(/(\d+)ms forwards/.exec(body)?.[1]);
    // CROSS_TURN_MS * 2 + CROSS_WALK_MS = 1380: the glide starts there.
    expect(delay(cards)).toBeGreaterThan(1380);
    expect(delay(cards)).toBeGreaterThan(delay(page));
    // Held back, they take no press and no focus until they appear (review).
    expect(cards).toMatch(/visibility:\s*hidden/);
    expect(cards).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/@keyframes waka-cross-cards-in\s*\{\s*from\s*\{\s*visibility:\s*visible/);
    // The press returns with the reveal's last frame, not the walk's end (review).
    expect(css).toMatch(/@keyframes waka-cross-cards-in[\s\S]*?99%\s*\{\s*pointer-events:\s*none;\s*\}\s*to\s*\{[^}]*pointer-events:\s*auto/);
    // And under reduced motion nothing is held back at all.
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g;
    const blocks = [...css.matchAll(reduced)].map((m) => m[1]!).filter((b) => b.includes(".waka-page--crossing-in .waka-held"));
    expect(blocks.some((b) => /visibility:\s*visible;\s*pointer-events:\s*auto/.test(b))).toBe(true);
  });
  it("an iOS-keyboard page drops its full-height floor, so the inline height holds (review)", () => {
    const keyboard = rules(sheet("claims.css"), (s) => s === ".waka-page[data-keyboard]").map(([, b]) => b).join("\n");
    expect(keyboard).toMatch(/min-height:\s*0/);
  });
});
