/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the stylesheets off
 * disk as text and compares selector specificity, the way
 * `stylesheets-parse.test.ts` reads them. No browser, no bundler.
 *
 * WHY IT EXISTS (code review, 2026-11-09): three quiet controls were written
 * with a rule that LOST to a container's rule of higher specificity, so the
 * control drew as something else: Stop drew as Send, and the sheet's "<"
 * picked up the search sheet's and the reading sheet's button boxes. Every
 * case here names the rule that must win and the rule it must beat. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const ALL = readdirSync(STYLES).filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(resolve(STYLES, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ")).join("\n");

/** Every selector in the sheets, one per comma part, with its declarations. */
function selectors(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of ALL.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    for (const part of match[1]!.split(",")) out.push({ selector: part.trim(), body: match[2]! });
  }
  return out;
}

/** [ids, classes/attributes/pseudo-classes, elements]; :not() counts its argument. */
export function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/:not\(([^)]*)\)/g, " $1");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\.[\w-]+|\[[^\]]+\]|:+[\w-]+|#[\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
const beats = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

describe("a quiet control's own rule wins over its container's", () => {
  it("draws Stop in the chat's bar as Stop, not as Send", () => {
    const send = specificity(".waka-note-bar .waka-note-bar-row .waka-note-bar-action");
    const stop = selectors().filter(({ selector, body }) => /chat-send--stop(?![\w-])/.test(selector) && /(^|;)\s*color:/.test(body)
      && !/:hover|:focus/.test(selector));
    expect(stop.length, "no rule colours Stop").toBeGreaterThan(0);
    expect(stop.some(({ selector }) => beats(specificity(selector), send)),
      `Stop's colour loses to the bar's action rule: ${stop.map((row) => row.selector).join(" | ")}`).toBe(true);
  });

  /* CODE REVIEW, 2026-11-09: once nothing filled, "chosen" and "pointed at"
     were the same full ink, so a selected tab looked exactly like a hovered
     one. Chosen has to say more than a colour, and still never fill. */
  it.each([
    [".waka-tab--on", ".waka-tab:not(.waka-tab--on):hover"],
    [".chat-page .chat-with-choice--on", ".chat-page .chat-with-choice:hover"],
    [".waka-composer-mic--on", ".waka-composer-mic:hover:not(:disabled)"],
  ])("draws %s differently from its hover, by more than colour, and never fills it", (on, hover) => {
    const rules = selectors();
    const onBody = rules.filter((row) => row.selector === on).map((row) => row.body).join(";");
    const hoverBody = rules.filter((row) => row.selector === hover).map((row) => row.body).join(";");
    expect(onBody, `no rule for ${on}`).not.toBe("");
    expect(onBody, `${on} has no mark beyond colour`).toMatch(/text-decoration|box-shadow|filter|border-bottom/);
    expect(hoverBody, `${hover} carries the chosen mark too`).not.toMatch(/text-decoration-line|text-decoration:\s*underline|filter:\s*drop-shadow/);
    expect(onBody, `${on} fills`).not.toMatch(/background(-color)?:\s*(?!\s|none\b|transparent\b)\S/);
  });

  /* CODE REVIEW, 2026-11-09: the sheet's "<" lost to `.jar-inspiration-search
     button` and `.waka-reading-full button`, so two of the "<"s were boxed
     and padded unlike the rest. Every container that holds one is listed;
     its blanket button rules must lose to the "<"'s own. */
  it("draws every surface's \"<\" the same, whatever surface it sits in", () => {
    const CONTAINERS = ["jar-inspiration-search", "waka-reading-full", "jar-reading-comparison", "waka-stream", "waka-over",
      "jar-principle-share", "jar-thing-share", "jar-seek", "jar-prov-room", "waka-account", "waka-settings", "login-shell"];
    const rules = selectors();
    const own = rules.filter(({ selector }) => /^[^ ]*\.waka-surface-back(?![\w-])[^ ]*$/.test(selector) && !/:hover|:focus|:disabled/.test(selector));
    expect(own.length, "no rule draws the sheet's \"<\"").toBeGreaterThan(0);
    const mine = own.map(({ selector }) => specificity(selector)).sort((a, b) => (beats(a, b) ? -1 : 1))[0]!;
    const losers = rules.filter(({ selector }) =>
      CONTAINERS.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(selector))
      && /(^|[\s>])button(?![\w-])[^\s>]*$/.test(selector)
      && !/:not\(\.waka-surface-back\)/.test(selector)
      && !beats(mine, specificity(selector)));
    expect(losers.map(({ selector }) => selector), "a sheet's button rule out-ranks the \"<\"").toEqual([]);
  });

  /* AND ONE COMPONENT DRAWS IT (nav system): the settings card's header is
     the shared `SurfaceHeader`, never a hand copy of its markup. */
  it("draws the settings card's \"<\" with SurfaceHeader, not a copy of it", () => {
    const settings = readFileSync(resolve(STYLES, "../components/SettingsPanel.tsx"), "utf8");
    expect(settings).toMatch(/<SurfaceHeader\b/);
    expect(settings, "a hand-drawn chevron came back").not.toMatch(/m14 5-7 7 7 7/);
  });
});

