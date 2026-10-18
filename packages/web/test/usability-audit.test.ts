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
    const hide = rules(sheet("claims.css"), (s) => /^body:has\(.*\.jar-thing-share.*\) \.waka-dock$/.test(s));
    expect(hide).toHaveLength(1);
    expect(hide[0]![0]).toContain(".jar-principle-share");
    expect(hide[0]![1]).toMatch(/visibility\s*:\s*hidden|display\s*:\s*none/);
  });
});

describe("the recording clock is never read out every second (review of #11)", () => {
  /* jsdom cannot run a MediaRecorder in the world, so the markup is read:
     every place the per-second clock is printed is `aria-hidden`, and no live
     region wraps it. */
  for (const file of ["pages/Home.tsx", "components/NoteTools.tsx"]) {
    it(file, () => {
      const source = readFileSync(resolve(STYLES, "..", file), "utf8");
      const clocks = [...source.matchAll(/<span([^>]*)>\{Math\.floor\((?:props\.)?recording\.seconds \/ 60\)\}/g)];
      expect(clocks.length).toBeGreaterThan(0);
      for (const [, attributes] of clocks) {
        expect(attributes).toContain('aria-hidden="true"');
        expect(attributes).not.toContain("role=");
      }
      expect(source).not.toMatch(/waka-dock-state--live" role="status"/);
    });
  }
});

describe("every small control takes a 44px press (#18)", () => {
  it("each named control carries a hit box at least 44 on each side", () => {
    const css = sheet("claims.css");
    for (const control of [".waka-dock-undo", ".jar-tile-x", ".waka-drawer-items button", ".chat-with-choice", ".chat-send", ".jar-harvest-skip", ".waka-held-open"]) {
      const box = rules(css, (s) => s === `${control}::after`).map(([, b]) => b).join("\n");
      expect(box, control).toMatch(/width:\s*max\(100%,\s*44px\)/);
      expect(box, control).toMatch(/height:\s*max\(100%,\s*44px\)/);
    }
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
  });
});
