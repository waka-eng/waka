/**
 * ═══ ONE BUBBLE, ONE SIZE ═══════════════════════════════════════════════
 *
 * Founder, 2026-11-09: "I don't like that the top of mind speech bubble is
 * bigger than the other ones so make it all consistent. Just choose one size
 * and font that is best for mobile accessibility and usability and
 * aesthetics."
 *
 * It had drifted to five sizes for one voice because every surface that
 * borrowed the bubble set its own words: home's reading at
 * clamp(16px, 1.1vw, 17px) in 24rem, home's other lines at 13px in 22rem,
 * onboarding at 17px in 300px, the notepad at 15px. So the spec lives in
 * `system.css` (`--bubble-*`) and is read through ONE set of rules in
 * `claims.css`; this test fails if any bubble selector stops being in those
 * rules, or if any other rule sets the bubble's size, measure or padding on
 * its own again.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the stylesheets as
 * the source the build ships, with comments blanked so prose that quotes CSS
 * is not counted as a rule; the rendered sizes are checked by the 390x844
 * screenshots, not here.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const read = (file: string): string =>
  readFileSync(resolve(STYLES, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "));

type Rule = { file: string; selectors: string[]; body: string };

/** Innermost rules only: a selector list and its declarations. */
function rules(file: string): Rule[] {
  const out: Rule[] = [];
  for (const m of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1]!.trim();
    if (head.startsWith("@") || head.startsWith(":root")) continue;
    out.push({ file, selectors: head.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, " ")), body: m[2]! });
  }
  return out;
}

const FILES = ["claims.css", "onboarding.css", "home.css", "chrome.css", "chat.css", "global.css"];
const ALL = FILES.flatMap(rules);
const decl = (body: string, prop: string): string | undefined =>
  body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`))?.[1]?.trim();

/** Every element a creature's words sit in, by role. */
const BOX = [".jar-char-bubble-body", ".waka-note-says"];
const TEXT = [".jar-char-bubble-reading", ".jar-char-bubble-body :is(p, h1)", ".waka-note-says"];
const LABEL = [".jar-char-bubble-of", ".jar-char-bubble-body .onb-say-soft"];

/** The rule that carries exactly this selector, in claims.css. */
const ruleFor = (selector: string, prop: string): Rule | undefined =>
  ALL.find((r) => r.file === "claims.css" && r.selectors.includes(selector) && decl(r.body, prop) !== undefined);

describe("every speech bubble reads one shared spec", () => {
  it("declares the spec once, in system.css", () => {
    const system = read("system.css");
    const want: Record<string, string> = {
      "--bubble-text": "17px",
      "--bubble-lh": "1.4",
      "--bubble-ls": "-0.01em",
      "--bubble-label": "var(--t-ui)",
      "--bubble-act": "var(--t-body)",
      "--bubble-act-h": "var(--waka-corner)",
      "--bubble-max": "min(320px, 100% - var(--sp-32))",
      "--bubble-pad-y": "var(--sp-12)",
      "--bubble-pad-x": "var(--sp-18)",
    };
    for (const [name, value] of Object.entries(want)) {
      expect(system.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim(), name).toBe(value);
    }
  });

  it("gives every bubble box the shared measure and padding", () => {
    for (const s of BOX) {
      expect(decl(ruleFor(s, "max-width")?.body ?? "", "max-width"), `${s} max-width`).toBe("var(--bubble-max)");
      expect(decl(ruleFor(s, "padding")?.body ?? "", "padding"), `${s} padding`).toBe("var(--bubble-pad)");
    }
  });

  it("sets every sentence a bubble says in the shared type", () => {
    for (const s of TEXT) {
      const body = ruleFor(s, "font-size")?.body ?? "";
      expect(decl(body, "font-size"), s).toBe("var(--bubble-text)");
      expect(decl(body, "line-height"), s).toBe("var(--bubble-lh)");
      expect(decl(body, "letter-spacing"), s).toBe("var(--bubble-ls)");
      expect(decl(body, "font-weight"), s).toBe("400");
      expect(decl(body, "font-family"), s).toBe("var(--waka-face)");
      expect(decl(body, "text-wrap"), s).toBe("pretty");
    }
  });

  it("sets every label line in the shared label size", () => {
    for (const s of LABEL) {
      expect(decl(ruleFor(s, "font-size")?.body ?? "", "font-size"), s).toBe("var(--bubble-label)");
    }
  });

  it("gives the act row the shared size and a thumb's target", () => {
    const act = ALL.find((r) => r.file === "claims.css" && r.selectors.includes(".jar-char-bubble-act") && decl(r.body, "font-size"));
    expect(decl(act?.body ?? "", "font-size")).toBe("var(--bubble-act)");
    expect(decl(act?.body ?? "", "min-height")).toBe("var(--bubble-act-h)");
    const acts = ALL.find((r) => r.selectors.includes(".jar-char-bubble-acts") && decl(r.body, "margin"));
    expect(decl(acts?.body ?? "", "margin")).toBe(
      "var(--sp-4) calc(var(--bubble-pad-x) * -1) calc(var(--bubble-pad-y) * -1)",
    );
  });

  it("lets no surface override the bubble's size, measure or padding", () => {
    /* A per-surface override is how the reading came to be bigger than every
       other bubble. Any rule touching a bubble's words or box must be one of
       the shared rules above. */
    const touches = /jar-char-bubble-(body|reading|of)\b|waka-note-says|onb-say|onb-ask-bubble|onb-chip|waka-ground-bubble|waka-held-(first|says)\b/;
    const shared = new Set([...BOX, ...TEXT, ...LABEL]);
    const offenders: string[] = [];
    for (const r of ALL) {
      if (!r.selectors.some((s) => touches.test(s) && !s.includes("::"))) continue;
      if (r.selectors.every((s) => shared.has(s))) continue;
      for (const prop of ["font-size", "line-height", "letter-spacing", "max-width", "width", "padding", "padding-top", "padding-bottom", "padding-inline"]) {
        const value = decl(r.body, prop);
        if (value === undefined) continue;
        if (prop === "width" && value === "max-content") continue; // shrink to content
        offenders.push(`${r.file}: ${r.selectors.join(", ")} { ${prop}: ${value} }`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
