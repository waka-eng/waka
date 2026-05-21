/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WowMomentsSection } from "../src/components/WowMomentsSection";
import type { ApiWowMoment } from "../src/lib/api";

const sampleMoment: ApiWowMoment = {
  id: "moment-1",
  userId: "user-1",
  title: "Prototype idea keeps returning",
  kind: "bridge",
  why: "Connects a mobile note with a design sketch.",
  beliefStatement: null,
  reflectionQuestion: "What would make this bridge testable this week?",
  wowScore: 87,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  relatedInspirations: [
    {
      inspirationId: "inspiration-1",
      role: "primary",
      reason: "First signal in the bridge.",
      text: "A field note about playful prototypes.",
      kind: "note",
      createdAt: "2026-04-30T00:00:00.000Z",
      wowScore: 73,
    },
  ],
};

const packageCssPath = resolve(process.cwd(), "src/styles/global.css");
const workspaceCssPath = resolve(process.cwd(), "packages/web/src/styles/global.css");
const globalCss = readFileSync(existsSync(packageCssPath) ? packageCssPath : workspaceCssPath, "utf8");
const packageComponentPath = resolve(process.cwd(), "src/components/WowMomentsSection.tsx");
const workspaceComponentPath = resolve(
  process.cwd(),
  "packages/web/src/components/WowMomentsSection.tsx",
);
const componentSource = readFileSync(
  existsSync(packageComponentPath) ? packageComponentPath : workspaceComponentPath,
  "utf8",
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderSection(props: Parameters<typeof WowMomentsSection>[0]): string {
  return renderToStaticMarkup(React.createElement(WowMomentsSection, props));
}

let mountedRoot: ReturnType<typeof createRoot> | null = null;
let mountedContainer: HTMLDivElement | null = null;

function renderInteractiveSection(props: Parameters<typeof WowMomentsSection>[0]): HTMLDivElement {
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);

  act(() => {
    mountedRoot?.render(React.createElement(WowMomentsSection, props));
  });

  return mountedContainer;
}

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WowMomentsSection", () => {
  it("keeps the populated WOW grid three columns with no gap in the mobile override", () => {
    const mobileCss = globalCss.match(/@media \(max-width: 640px\) \{[\s\S]*\}\s*$/)?.[0] ?? "";

    expect(mobileCss).toMatch(
      /\.wow-moments-grid--populated\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?gap:\s*0;/,
    );
    expect(mobileCss).toMatch(
      /\.wow-moments-grid--populated \.wow-moment-card \+ \.wow-moment-card\s*\{[\s\S]*?margin-left:\s*-1px;/,
    );
    expect(mobileCss).toMatch(
      /\.wow-moments-grid--populated \.wow-moment-card:nth-child\(3n \+ 1\)\s*\{[\s\S]*?margin-left:\s*0;/,
    );
    expect(mobileCss).toMatch(
      /\.wow-moments-grid--populated \.wow-moment-card:nth-child\(n \+ 4\)\s*\{[\s\S]*?margin-top:\s*-1px;/,
    );
    expect(mobileCss).not.toMatch(
      /\.wow-moments-grid--populated \.wow-moment-card \+ \.wow-moment-card\s*\{[^}]*margin-top:\s*-1px;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moments-grid--populated\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?grid-auto-rows:\s*minmax\(190px, auto\);[\s\S]*?gap:\s*0;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-related\s*\{[\s\S]*?grid-auto-rows:\s*auto;[\s\S]*?align-content:\s*start;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-related blockquote\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?line-height:\s*1\.34;[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    const blockquoteRule = globalCss.match(/\.wow-moment-related blockquote\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(blockquoteRule).not.toMatch(/-webkit-line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
    const populatedCardRule =
      globalCss.match(/\.wow-moments-grid--populated \.wow-moment-card\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(populatedCardRule).not.toMatch(/overflow:\s*hidden|height:\s*100%/);
  });

  it("keeps the expanded detail typography compact without touching card copy", () => {
    expect(globalCss).toMatch(
      /\.wow-moment-detail-panel h3\s*\{[\s\S]*?font-size:\s*clamp\(24px, 4vw, 40px\);[\s\S]*?line-height:\s*1\.02;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-detail-section p\s*\{[\s\S]*?font-size:\s*clamp\(15px, 1\.7vw, 18px\);[\s\S]*?line-height:\s*1\.45;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-belief-pullquote blockquote\s*\{[\s\S]*?font-size:\s*clamp\(19px, 2\.6vw, 28px\);[\s\S]*?line-height:\s*1\.18;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-detail-sources blockquote\s*\{[\s\S]*?font-size:\s*clamp\(14px, 1\.5vw, 16px\);[\s\S]*?line-height:\s*1\.5;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-memory-ending h5\s*\{[\s\S]*?font-size:\s*clamp\(17px, 2vw, 22px\);[\s\S]*?line-height:\s*1\.1;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-memory-ending blockquote\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?line-height:\s*1\.4;/,
    );
    expect(globalCss).toMatch(/\.wow-moment-card h3\s*\{[\s\S]*?font-size:\s*clamp\(14px, 1\.1vw, 17px\);/);
  });

  it("renders a loading state", () => {
    const html = renderSection({ moments: [], loading: true, error: null });

    expect(html).toContain("Loading WOW moments");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("wow-moment-card--loading");
  });

  it("renders an empty state", () => {
    const html = renderSection({ moments: [], loading: false, error: null });

    expect(html).toContain("No WOW moments yet.");
    expect(html).toContain("patterns will appear here");
  });

  it("renders an error state", () => {
    const html = renderSection({
      moments: [],
      loading: false,
      error: "Malformed WOW moments response",
    });

    expect(html).toContain("Couldn’t load WOW moments.");
    expect(html).toContain("Malformed WOW moments response");
  });

  it("renders every related inspiration as complete plain source text", () => {
    const momentWithManyRelatedInspirations: ApiWowMoment = {
      ...sampleMoment,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-1",
          role: "primary",
          reason: "First signal in the bridge.",
          text: "A field note about playful prototypes.",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-2",
          role: "supporting",
          reason: "Second signal in the bridge.",
          text: "A sketch that turned the field note into a grid.",
          createdAt: "2026-05-01T00:00:00.000Z",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-3",
          role: "contrast",
          reason: "Third signal in the bridge.",
          text: "A voice memo asking for smaller WOW cards.",
          createdAt: "2026-05-02T00:00:00.000Z",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-4",
          role: "igniter",
          reason: "Fourth signal in the bridge.",
          text: "A prototype review that asked to keep every spark visible.",
          createdAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    };

    const html = renderSection({
      moments: [momentWithManyRelatedInspirations],
      loading: false,
      error: null,
    });

    expect(html).toContain("What WAKA noticed");
    expect(html).toContain("1 best-recent mirror moments shown.");
    expect(html).not.toContain("Inspect all WOW moments (1)");
    expect(html).not.toContain("Dev-only inspect WOW fields");
    expect(html).not.toContain(">1</span>");
    expect(html).not.toContain("confidence");
    expect(html).toContain("Prototype idea keeps returning");
    expect(html).not.toContain("DEV WOW score 73");
    expect(html).toContain("Why WAKA noticed this");
    expect(html).toContain("Connects a mobile note with a design sketch.");
    expect(html).toContain("A field note about playful prototypes.");
    expect(html).toContain("A sketch that turned the field note into a grid.");
    expect(html).toContain("A voice memo asking for smaller WOW cards.");
    expect(html).toContain("A prototype review that asked to keep every spark visible.");
    expect(html).not.toContain("prototyp…");
    expect(html).not.toContain("note…");
    expect(html).not.toContain("WOW…");
    expect(html).not.toContain("ke…");
    expect(html).not.toContain("+1 source");
    expect(html).not.toContain("+2 sources");
    expect(html).not.toContain("wow-moment-related-more");
    expect(html).not.toContain("wow-moment-related-index");
    expect(html).not.toContain("Bridge");
    expect(html).not.toContain("primary");
    expect(html).not.toContain("supporting");
    expect(html).not.toContain("contrast");
    expect(html).not.toContain("igniter");
    expect(html).not.toContain("First signal in the bridge.");
    expect(html).not.toContain("Second signal in the bridge.");
    expect(html).not.toContain("Third signal in the bridge.");
    expect(html).not.toContain("Fourth signal in the bridge.");
    expect(html).not.toContain("2026-04-30");
    expect(html).not.toContain("2026-05-03");
    expect(html).not.toContain("Apr 30");
    expect(html).not.toContain("May 3");
    expect(html).not.toContain("What would make this bridge testable this week?");
  });

  it("renders long related inspiration text in full without a snippet ellipsis", () => {
    const longSourceText =
      "This very long source inspiration should stay complete so the WOW card can grow and show the tiny WOW card context without hiding the final sentence about readable evidence.";
    const html = renderSection({
      moments: [
        {
          ...sampleMoment,
          relatedInspirations: [
            {
              ...sampleMoment.relatedInspirations[0]!,
              text: longSourceText,
            },
          ],
        },
      ],
      loading: false,
      error: null,
    });

    expect(html).toContain(longSourceText);
    expect(html).toContain("tiny WOW card context");
    expect(html).toContain("final sentence about readable evidence");
    expect(html).not.toContain("…");
    expect(componentSource).not.toMatch(/SOURCE_SNIPPET|getSourceSnippet|substring\(/);
  });

  it("adds a visually quiet open-detail cue to each populated WOW card", () => {
    const html = renderSection({ moments: [sampleMoment], loading: false, error: null });

    expect(html).toContain("wow-moment-open-cue");
    expect(html).toContain("See why this matters");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("aria-label=\"Open mirror moment report: Prototype idea keeps returning\"");
    expect(globalCss).toMatch(
      /\.wow-moment-open-cue\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-card--interactive:is\(:hover, :focus-visible, :focus-within\) \.wow-moment-open-cue\s*\{[\s\S]*?opacity:\s*1;/,
    );
  });

  it("renders full WOW reasoning on the main card without CSS line clamping", () => {
    const longWhy =
      "Why WAKA noticed this because the pattern connects a mobile note, a design sketch, and a prototype review into one complete insight that should remain visible through the final sentence.";
    const html = renderSection({
      moments: [{ ...sampleMoment, why: longWhy }],
      loading: false,
      error: null,
    });

    expect(html).toContain("aria-label=\"Why WAKA noticed this\"");
    expect(html).toContain("Why WAKA noticed this");
    expect(html).toContain(longWhy);
    expect(html).toContain("through the final sentence");

    const whyRule = globalCss.match(/\.wow-moment-why p\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(whyRule).toContain("overflow-wrap: anywhere;");
    expect(whyRule).toContain("display: block;");
    expect(whyRule).toContain("max-height: none;");
    expect(whyRule).toContain("overflow: visible;");
    expect(whyRule).not.toMatch(/-webkit-line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  });

  it("breaks a long pattern report into a lead and readable noticed points", () => {
    const longWhy = [
      "WAKA noticed that several saved inspirations return to small prototypes rather than polished plans.",
      "A note about a quiet mobile workflow, a sketch of a three-column card grid, and a prototype review all point toward making ideas easier to test before they become heavy.",
      "That does not prove a fixed trait; it may simply be a useful mirror for what has felt energizing lately.",
    ].join(" ");
    const container = renderInteractiveSection({
      moments: [{ ...sampleMoment, why: longWhy }],
      loading: false,
      error: null,
    });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    const lead = detail?.querySelector<HTMLElement>(".wow-moment-pattern-lead");
    const points = Array.from(detail?.querySelectorAll<HTMLElement>(".wow-moment-pattern-list li") ?? []);

    expect(detail?.textContent).toContain("How the pattern shows up");
    expect(detail?.querySelector(".wow-moment-pattern-body")?.getAttribute("aria-label")).toBe(
      "How the pattern shows up",
    );
    expect(lead?.querySelector(".wow-moment-pattern-label")?.textContent).toBe("Field note");
    expect(lead?.textContent).toContain(
      "WAKA noticed that several saved inspirations return to small prototypes rather than polished plans.",
    );
    expect(points.length).toBeGreaterThan(1);
    expect(points[0]?.textContent).not.toBe(
      lead?.querySelector(".wow-moment-pattern-label + span")?.textContent,
    );
    expect(points.map((point) => point.textContent)).toEqual([
      "A note about a quiet mobile workflow, a sketch of a three-column card grid, and a prototype review all point toward making ideas easier to test before they become heavy.",
      "That does not prove a fixed trait; it may simply be a useful mirror for what has felt energizing lately.",
    ]);
    expect(detail?.textContent).toContain("A field note about playful prototypes.");
    expect(detail?.textContent).toContain("First signal in the bridge.");
    expect(globalCss).toContain(".wow-moment-pattern-lead");
    expect(globalCss).toContain(".wow-moment-pattern-label");
    expect(globalCss).not.toContain('content: "Field note";');
    expect(globalCss).toContain(".wow-moment-pattern-list li::marker");
  });

  it("breaks long no-punctuation pattern text into bounded points without dropping content", () => {
    const longWhy = "waka".repeat(80);
    const container = renderInteractiveSection({
      moments: [{ ...sampleMoment, why: longWhy }],
      loading: false,
      error: null,
    });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    const lead = detail?.querySelector<HTMLElement>(".wow-moment-pattern-lead");
    const points = Array.from(detail?.querySelectorAll<HTMLElement>(".wow-moment-pattern-list li") ?? []);
    const pointText = points.map((point) => point.textContent ?? "");

    expect(lead).toBeNull();
    expect(points.length).toBeGreaterThan(1);
    expect(pointText.every((point) => point.length <= 240)).toBe(true);
    expect(pointText.join("")).toBe(longWhy);
  });

  it("renders a guided WOW disclosure sequence with expandable evidence reasons", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const guidedMoment: ApiWowMoment = {
      ...sampleMoment,
      why: [
        "WAKA noticed that several saved inspirations return to small prototypes rather than polished plans.",
        "A note about a quiet mobile workflow and a prototype review both point toward making ideas easier to test before they become heavy.",
      ].join(" "),
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "source-open",
          role: "The practice",
          reason: "This source shows the ritual the pattern keeps returning to.",
          text: "A note about doing a tiny daily version.",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "source-closed",
          role: "classifier rank id 2026-05-01",
          reason: "runtimeCandidateScore rank id 2026-05-01 came from the classifier",
          text: "A legacy note with unsafe metadata around it.",
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [guidedMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    expect(detail?.textContent).toContain("Reflection mode");
    expect(detail?.textContent).toContain("Start here");
    expect(detail?.textContent).toContain("The moment");
    expect(detail?.textContent).toContain("This may be worth noticing: Prototype idea keeps returning");
    expect(detail?.textContent).toContain("Where it came from");
    expect(detail?.textContent).toContain("Source trail");
    expect(detail?.textContent).toContain("The practice");
    expect(detail?.textContent).toContain("Source inspiration");
    expect(detail?.textContent).not.toContain("classifier rank id 2026-05-01");
    expect(detail?.textContent).not.toContain("runtimeCandidateScore");
    expect(detail?.textContent).toContain("What this may say about you");
    expect(detail?.textContent?.match(/What this may say about you/g)).toHaveLength(1);
    expect(detail?.textContent).toContain("The belief underneath");
    expect(detail?.textContent).toContain("Ownership, not advice");
    expect(detail?.textContent).toContain("For reflection only; not saved.");

    const reasonButtons = Array.from(
      detail?.querySelectorAll<HTMLButtonElement>(".wow-moment-source-reason-toggle") ?? [],
    );
    expect(reasonButtons.map((button) => button.getAttribute("aria-expanded"))).toEqual([
      "true",
      "false",
    ]);
    expect(detail?.querySelector("#wow-source-reason-moment-1-source-open")?.textContent).toContain(
      "This source shows the ritual the pattern keeps returning to.",
    );
    expect(detail?.querySelector("#wow-source-reason-moment-1-source-closed")).toBeNull();

    act(() => {
      reasonButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(reasonButtons[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(detail?.querySelector("#wow-source-reason-moment-1-source-closed")?.textContent).toContain(
      "Source note",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens a focused detail panel from a populated mirror card and reads as a pattern report", () => {
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });

    expect(container.textContent).toContain("Prototype idea keeps returning");
    expect(container.textContent).toContain("Why WAKA noticed this");
    expect(container.textContent).toContain("Connects a mobile note with a design sketch.");
    expect(container.textContent).toContain("A field note about playful prototypes.");
    expect(container.textContent).not.toContain("What would make this bridge testable this week?");

    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("tabindex")).toBe("0");
    expect(card?.getAttribute("aria-label")).toContain("Open mirror moment report");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    const expandedGrid = container.querySelector<HTMLElement>(".wow-moments-grid--expanded");
    expect(detail).not.toBeNull();
    expect(expandedGrid).not.toBeNull();
    expect(expandedGrid?.contains(detail)).toBe(true);
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector(".wow-moment-detail-backdrop")).toBeNull();
    expect(container.querySelectorAll(".wow-moment-card--interactive")).toHaveLength(0);
    expect(detail?.textContent).toContain("Back to grid");
    expect(detail?.textContent).toContain("Prototype idea keeps returning");
    expect(detail?.textContent).toContain("Reflection mode");
    expect(detail?.textContent).toContain("How the pattern shows up");
    expect(detail?.textContent).toContain("Connects a mobile note with a design sketch.");
    expect(detail?.textContent).toContain("What this may say about you");
    expect(detail?.textContent).toContain("Treat this as a mirror, not a recommendation.");
    expect(detail?.textContent).toContain("Reflection question");
    expect(detail?.textContent).toContain("What would make this bridge testable this week?");
    expect(detail?.textContent).toContain("A belief this may point to");
    expect(detail?.textContent).toContain(
      "One possible reading: because “Connects a mobile note with a design sketch”, this may point to a belief that “Prototype idea keeps returning” is worth exploring rather than treating as a one-off spark.",
    );
    expect(detail?.textContent).not.toContain(
      "You seem drawn to ideas that keep showing up in different forms.",
    );
    expect(detail?.textContent).toContain("Does this feel like you?");
    expect(detail?.textContent).toContain("That’s me");
    expect(detail?.textContent).toContain("Partly");
    expect(detail?.textContent).toContain("Not quite");
    expect(detail?.textContent).not.toContain("DEV WOW score 73");
    expect(detail?.textContent).toContain("Artifacts behind this reading");
    expect(detail?.textContent).toContain("1 source");
    expect(detail?.textContent).toContain("A field note about playful prototypes.");
    expect(detail?.textContent).toContain("Hide source note");
    expect(detail?.textContent).toContain("Source note");
    expect(detail?.textContent).toContain("First signal in the bridge.");
  });

  it("uses product-facing source role labels in the detail report with safe legacy fallbacks", () => {
    const momentWithSourceRoles: ApiWowMoment = {
      ...sampleMoment,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-practice",
          role: "The practice",
          reason: "This source shows the ritual the pattern keeps returning to.",
          text: "A note about doing a tiny daily version.",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-legacy",
          role: "May 2024",
          reason: "",
          text: "A legacy note with no product-facing explanation.",
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [momentWithSourceRoles], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detailText = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid")?.textContent ?? "";
    expect(detailText).toContain("The practice");
    expect(detailText).toContain("This source shows the ritual the pattern keeps returning to.");
    expect(detailText).toContain("Source inspiration");
    expect(detailText).toContain("Why this source matters");
    expect(detailText).not.toContain("May 2024");
  });

  it("shows a quiet source count in the detail report without exposing source metadata", () => {
    const momentWithThreeSources: ApiWowMoment = {
      ...sampleMoment,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-1",
          role: "primary",
          text: "A field note about playful prototypes.",
          createdAt: "2026-04-30T00:00:00.000Z",
          wowScore: 73,
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-2",
          role: "supporting",
          text: "A sketch that turned the field note into a grid.",
          createdAt: "2026-05-01T00:00:00.000Z",
          wowScore: 64,
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-3",
          role: "contrast",
          text: "A voice memo asking for smaller WOW cards.",
          createdAt: "2026-05-02T00:00:00.000Z",
          wowScore: 59,
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [momentWithThreeSources], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    const sourceCount = detail?.querySelector<HTMLElement>(".wow-moment-source-count");

    expect(sourceCount?.textContent).toBe("3 sources");
    expect(detail?.textContent).toContain("Artifacts behind this reading");
    expect(detail?.textContent).toContain("A sketch that turned the field note into a grid.");
    expect(detail?.textContent).not.toContain("primary");
    expect(detail?.textContent).not.toContain("supporting");
    expect(detail?.textContent).not.toContain("contrast");
    expect(detail?.textContent).not.toContain("DEV WOW score 73");
    expect(detail?.textContent).not.toContain("2026-04-30");
    expect(globalCss).toContain(".wow-moment-source-count");
    expect(globalCss).toContain(".wow-moment-detail-sources::before");
    expect(globalCss).toContain(".wow-moment-detail-sources li::before");
    expect(globalCss).toContain(".wow-moment-detail-sources li::after");
  });

  it("keeps belief excerpts concise while preserving full source evidence elsewhere", () => {
    const longWhy =
      "This long pattern explanation should be normalized for the belief sentence because it keeps describing multiple saved notes, several sketches, a prototype critique, and a final tail that must stay out of the belief excerpt.";
    const longSourceText =
      "This long source evidence should remain fully visible in the detail sources, including a final sentence that proves source cards are not truncated by the belief helper.";
    const longSourceReason =
      "Saved because this long source note carries context that should remain visible outside the short belief sentence.";
    const longMoment: ApiWowMoment = {
      ...sampleMoment,
      why: longWhy,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          reason: longSourceReason,
          text: longSourceText,
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [longMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    const beliefText =
      detail?.querySelector<HTMLElement>(".wow-moment-belief-pullquote blockquote")?.textContent ?? "";
    expect(beliefText).toContain("One possible reading");
    expect(beliefText.length).toBeLessThan(260);
    expect(beliefText).toContain("…");
    expect(beliefText).not.toContain("final tail that must stay out of the belief excerpt");
    expect(beliefText).not.toContain("final sentence that proves source cards are not truncated");
    expect(detail?.textContent).toContain(longWhy);
    expect(detail?.textContent).toContain(longSourceText);
    expect(detail?.textContent).toContain(longSourceReason);
  });

  it("grounds the belief statement in title and source reason for sparse moments", () => {
    const sparseMoment: ApiWowMoment = {
      ...sampleMoment,
      title: "Quiet interfaces feel more humane.",
      why: "",
      reflectionQuestion: null,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          reason: "Saved because the calm layout made progress feel less punishing.",
          text: "A simple dashboard with more breathing room.",
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [sparseMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detailText = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid")?.textContent ?? "";
    expect(detailText).toContain("A belief this may point to");
    expect(detailText).toContain(
      "One possible reading: “Quiet interfaces feel more humane” may matter through this source note: “saved because the calm layout made progress feel less punishing”. It points to a belief worth testing gently.",
    );
    expect(detailText).toContain("Does this feel like you?");
    expect(detailText).not.toContain("You seem drawn to ideas that keep showing up in different forms.");
  });

  it("uses a safe source reason fallback in sparse belief copy when source reason is unsafe", () => {
    const sparseUnsafeMoment: ApiWowMoment = {
      ...sampleMoment,
      title: "Quiet interfaces feel more humane.",
      why: "",
      beliefStatement: null,
      reflectionQuestion: null,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          role: "classifier rank id 2026-05-01",
          reason: "runtimeCandidateScore rank id 2026-05-01 came from the classifier provider payload",
          text: "A simple dashboard with more breathing room.",
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [sparseUnsafeMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const beliefText =
      container.querySelector<HTMLElement>(".wow-moment-belief-pullquote blockquote")?.textContent ?? "";
    expect(beliefText).toContain("One possible reading");
    expect(beliefText).toContain(
      "One possible reading: “Quiet interfaces feel more humane” may matter through this source note: “why this source matters”. It points to a belief worth testing gently.",
    );
    expect(container.querySelector<HTMLElement>(".wow-moment-belief-pullquote figcaption")?.textContent).toBe(
      "Does this feel like you?",
    );
    expect(beliefText).not.toContain("runtimeCandidateScore");
    expect(beliefText).not.toContain("classifier provider payload");
    expect(beliefText).not.toContain("2026-05-01");
  });

  it("uses a supplied source-grounded belief statement instead of deriving one from title and why", () => {
    const momentWithBelief: ApiWowMoment = {
      ...sampleMoment,
      title: "Title that should not be repurposed",
      why: "Why text that should not become the belief sentence.",
      beliefStatement: "You may believe progress should feel humane, not pressurized.",
    };
    const container = renderInteractiveSection({ moments: [momentWithBelief], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const beliefText =
      container.querySelector<HTMLElement>(".wow-moment-belief-pullquote blockquote")?.textContent ?? "";
    expect(beliefText).toContain("You may believe progress should feel humane, not pressurized.");
    expect(beliefText).not.toContain("One possible reading");
    expect(beliefText).not.toContain("Title that should not be repurposed");
    expect(beliefText).not.toContain("Why text that should not become the belief sentence");
    expect(globalCss).toMatch(
      /\.wow-moment-belief-pullquote\s*\{[\s\S]*?max-width:\s*46rem;[\s\S]*?margin:\s*var\(--space-3\) auto 0;[\s\S]*?text-align:\s*center;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-belief-pullquote blockquote\s*\{[\s\S]*?max-width:\s*38rem;[\s\S]*?margin:\s*0 auto;[\s\S]*?font-style:\s*italic;/,
    );
    expect(globalCss).toContain(".wow-moment-belief-pullquote figcaption");
  });

  it("keeps belief resonance buttons local, selected, and explicitly unsaved", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    expect(detail?.textContent).toContain("For reflection only; not saved.");
    const buttons = Array.from(
      detail?.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button") ?? [],
    );
    const thatsMeButton = buttons.find((button) => button.textContent?.trim() === "That’s me");
    const partlyButton = buttons.find((button) => button.textContent?.trim() === "Partly");
    const notQuiteButton = buttons.find((button) => button.textContent?.trim() === "Not quite");

    expect(thatsMeButton).not.toBeUndefined();
    expect(partlyButton).not.toBeUndefined();
    expect(notQuiteButton).not.toBeUndefined();
    expect(thatsMeButton?.getAttribute("aria-pressed")).toBe("false");
    expect(partlyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(notQuiteButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      thatsMeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(thatsMeButton?.getAttribute("aria-pressed")).toBe("true");
    expect(partlyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(notQuiteButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      notQuiteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(thatsMeButton?.getAttribute("aria-pressed")).toBe("false");
    expect(partlyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(notQuiteButton?.getAttribute("aria-pressed")).toBe("true");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalCss).toMatch(
      /\.wow-moment-belief-actions button\[aria-pressed="true"\]\s*\{[\s\S]*?background:\s*var\(--ink\);[\s\S]*?color:\s*var\(--cell\);/,
    );
    expect(globalCss).not.toContain("var(--paper)");

    const closeButton = container.querySelector<HTMLButtonElement>(".wow-moment-detail-close");
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const reopenedCard = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");
    act(() => {
      reopenedCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const reopenedButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    );
    expect(reopenedButtons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
    ]);
  });

  it("shows a local future-memory ending panel after resonance without persisting", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Save this as a future memory?");
    const partlyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    ).find((button) => button.textContent?.trim() === "Partly");

    act(() => {
      partlyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const endingPanel = container.querySelector<HTMLElement>(".wow-moment-memory-ending");
    expect(endingPanel).not.toBeNull();
    expect(endingPanel?.textContent).toContain("Save this as a future memory?");
    expect(endingPanel?.textContent).toContain("Local preview only: nothing is saved yet.");
    expect(endingPanel?.textContent).toContain("Mark locally");
    expect(endingPanel?.textContent).toContain("Edit first");
    expect(endingPanel?.textContent).toContain("Not for me");

    const rememberButton = Array.from(
      endingPanel?.querySelectorAll<HTMLButtonElement>(".wow-moment-memory-actions button") ?? [],
    ).find((button) => button.textContent?.trim() === "Mark locally");

    act(() => {
      rememberButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain("Marked locally");
    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain(
      "This is only marked locally in this reflection. Future memory is coming soon.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalCss).toContain(".wow-moment-memory-ending");
    expect(globalCss).toContain(".wow-moment-memory-actions");
  });

  it("documents the local WOW-detail QA path from grid to resonance, future memory, and Add Signal", () => {
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    expect(card).not.toBeNull();
    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detail = container.querySelector<HTMLElement>(".wow-moment-detail-panel--in-grid");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain(sampleMoment.title);
    expect(detail?.textContent).not.toContain("Show me examples");

    const thatsMeButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    ).find((button) => button.textContent?.trim() === "That’s me");
    expect(thatsMeButton).not.toBeUndefined();
    act(() => {
      thatsMeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain(
      "Save this as a future memory?",
    );
    const signalPanel = container.querySelector<HTMLElement>(".wow-moment-add-signal");
    expect(signalPanel?.textContent).toContain("Add more signal for this pattern");
    expect(signalPanel?.textContent).not.toContain("Show me examples");
  });

  it("shows an add-signal ending panel with count-aware prompts after resonance", () => {
    const momentWithThreeSources: ApiWowMoment = {
      ...sampleMoment,
      relatedInspirations: [
        sampleMoment.relatedInspirations[0]!,
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-2",
          text: "A second source about a strangely important product.",
        },
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: "inspiration-3",
          text: "A third source about a work tension.",
        },
      ],
    };
    const container = renderInteractiveSection({ moments: [momentWithThreeSources], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const partlyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    ).find((button) => button.textContent?.trim() === "Partly");

    act(() => {
      partlyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const signalPanel = container.querySelector<HTMLElement>(".wow-moment-add-signal");
    expect(signalPanel).not.toBeNull();
    expect(signalPanel?.textContent).toContain("Add more signal for this pattern");
    expect(signalPanel?.textContent).toContain(
      "This moment is based on 3 inspirations. More signal can make future moments sharper and more personal.",
    );
    expect(signalPanel?.textContent).toContain("Try adding:");
    expect(signalPanel?.textContent).toContain("something you keep coming back to");
    expect(signalPanel?.textContent).toContain("a project or product that feels strangely important");
    expect(signalPanel?.textContent).toContain("a tension you notice in your work or taste");
    expect(signalPanel?.textContent).toContain("Add another inspiration");
    expect(signalPanel?.textContent).not.toContain("Show me examples");
    expect(signalPanel?.textContent).not.toContain("Hide examples");
    expect(container.querySelector(".wow-moment-signal-examples")).toBeNull();
    expect(globalCss).toContain(".wow-moment-add-signal");
    expect(globalCss).toContain(".wow-moment-signal-actions");
  });

  it("uses a local add-inspiration callback and named event affordance", () => {
    const fetchSpy = vi.fn();
    const addSpy = vi.fn();
    const eventSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.addEventListener("waka:add-inspiration", eventSpy);
    const container = renderInteractiveSection({
      moments: [sampleMoment],
      loading: false,
      error: null,
      onAddInspiration: addSpy,
    });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const notQuiteButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    ).find((button) => button.textContent?.trim() === "Not quite");

    act(() => {
      notQuiteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-signal-actions button"),
    ).find((button) => button.textContent?.trim() === "Add another inspiration");

    act(() => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect((eventSpy.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      source: "wow-moment-ending",
      momentId: "moment-1",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    window.removeEventListener("waka:add-inspiration", eventSpy);
  });

  it("lets the user locally edit or dismiss the future-memory ending state", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const thatsMeButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    ).find((button) => button.textContent?.trim() === "That’s me");

    act(() => {
      thatsMeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const editButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-memory-actions button"),
    ).find((button) => button.textContent?.trim() === "Edit first");

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(".wow-moment-memory-edit textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain("One possible reading");
    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain(
      "Shape the sentence locally first. It still will not be saved yet.",
    );

    act(() => {
      if (textarea) {
        textarea.value = "I believe small prototypes are worth protecting.";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const editedRememberButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-memory-actions button"),
    ).find((button) => button.textContent?.trim() === "Mark locally");

    act(() => {
      editedRememberButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain("Marked locally");
    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain(
      "I believe small prototypes are worth protecting.",
    );

    act(() => {
      thatsMeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const notForMeButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-memory-actions button"),
    ).find((button) => button.textContent?.trim() === "Not for me");

    act(() => {
      notForMeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector<HTMLElement>(".wow-moment-memory-ending")?.textContent).toContain(
      "We’ll leave this one alone.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens details with keyboard activation and closes with the Back to grid button and Escape", () => {
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container.querySelector(".wow-moment-detail-panel--in-grid")?.textContent).toContain(
      "Connects a mobile note with a design sketch.",
    );

    const closeButton = container.querySelector<HTMLButtonElement>(".wow-moment-detail-close");
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".wow-moment-detail-panel--in-grid")).toBeNull();

    const reopenedCard = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");
    act(() => {
      reopenedCard?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(container.querySelector(".wow-moment-detail-panel--in-grid")?.textContent).toContain(
      "What would make this bridge testable this week?",
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".wow-moment-detail-panel--in-grid")).toBeNull();
  });

  it("caps populated WOW moment cards at nine without showing a product inspect action", () => {
    const manyMoments = Array.from({ length: 11 }, (_, index) => ({
      ...sampleMoment,
      id: `moment-${index + 1}`,
      title: `WOW card ${index + 1}`,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: `inspiration-${index + 1}`,
          reason: `Evidence reason ${index + 1}`,
          text: `Related inspiration evidence ${index + 1}`,
        },
      ],
    }));
    const html = renderSection({
      moments: manyMoments,
      loading: false,
      error: null,
    });

    expect(html).toContain("9 best-recent mirror moments shown.");
    expect(html).not.toContain("Inspect all WOW moments (11)");
    expect(html).not.toContain("Dev-only inspect WOW fields");
    expect(html).toContain("wow-moments-grid wow-moments-grid--populated");
    expect(html.match(/class=\"wow-moment-card wow-moment-card--interactive\"/g)).toHaveLength(9);
    expect(html).toContain("WOW card 9");
    expect(html).toContain("Related inspiration evidence 9");
    expect(html).not.toContain("Evidence reason 9");
    expect(html).not.toContain("primary");
    expect(html).not.toContain("WOW card 10");
    expect(html).not.toContain("Related inspiration evidence 10");
  });

  it("hides the dev-only WOW inspection surface unless the internal gate is enabled", () => {
    const html = renderSection({
      moments: [
        {
          ...sampleMoment,
          id: "moment-for-hidden-dev-inspect",
          title: "Hidden dev inspect moment",
          beliefStatement: "You may believe prototypes should stay humane.",
          why: "Generated meaning copy that should stay in the main report only.",
        },
      ],
      loading: false,
      error: null,
      showDevInspection: false,
    });

    expect(html).toContain("Hidden dev inspect moment");
    expect(html).toContain("Generated meaning copy that should stay in the main report only.");
    expect(html).not.toContain("Dev-only inspect WOW fields");
    expect(html).not.toContain("Temporary internal inspection");
    expect(html).not.toContain("Generated field previews");
    expect(html).not.toContain("Belief statement");
    expect(html).not.toContain("Reflection prompt");
  });

  it("opens a dev-only inspection panel with bounded allowlisted generated fields", () => {
    const moments = Array.from({ length: 10 }, (_, index) => ({
      ...sampleMoment,
      id: `moment-${index + 1}`,
      title: `WOW card ${index + 1}`,
      wowScore: 90 - index,
      why: `Why WOW card ${index + 1} matters.`,
      beliefStatement: index === 9 ? "You may believe small tests make ideas safer to approach." : null,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: `inspiration-${index + 1}`,
          role: index === 9 ? "classifier score uuid rank 2026-05-01" : "primary",
          reason:
            index === 9
              ? "runtimeCandidateScore rank id 2026-05-01 came from the classifier"
              : "First signal in the bridge.",
          text: `Related inspiration evidence ${index + 1}`,
        },
      ],
    }));
    const container = renderInteractiveSection({
      moments,
      loading: false,
      error: null,
      showDevInspection: true,
    });

    expect(container.textContent).toContain("9 best-recent mirror moments shown.");
    expect(container.textContent).toContain("Dev-only inspect WOW fields (10)");
    expect(container.textContent).toContain("WOW card 9");
    expect(container.textContent).not.toContain("Generated field previews");
    expect(container.textContent).not.toContain("WOW card 10");
    expect(container.textContent).not.toContain("Related inspiration evidence 10");

    const inspectButton = container.querySelector<HTMLButtonElement>(".wow-moments-inspect-button");
    expect(inspectButton).not.toBeNull();
    expect(inspectButton?.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      inspectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector<HTMLElement>("#dev-wow-inspection-panel[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Temporary internal inspection");
    expect(dialog?.textContent).toContain("Generated field previews");
    expect(dialog?.textContent).toContain("Safe, bounded previews of generated fields for live internal testing.");
    expect(dialog?.textContent).toContain("Title / headline");
    expect(dialog?.textContent).toContain("WOW card 10");
    expect(dialog?.textContent).toContain("Why / meaning copy");
    expect(dialog?.textContent).toContain("Belief statement");
    expect(dialog?.textContent).toContain("You may believe small tests make ideas safer to approach.");
    expect(dialog?.textContent).toContain("Reflection prompt");
    expect(dialog?.textContent).toContain("What would make this bridge testable this week?");
    expect(dialog?.textContent).toContain("Compact counts");
    expect(dialog?.textContent).toContain("1 source");
    expect(dialog?.textContent).not.toContain("DEV WOW score 81");
    expect(dialog?.textContent).not.toContain("DEV WOW score");
    expect(dialog?.textContent).toContain("Why WOW card 10 matters.");
    expect(dialog?.textContent).toContain("Source role / reason");
    expect(dialog?.textContent).toContain("Source inspiration");
    expect(dialog?.textContent).toContain("Why this source matters");
    expect(dialog?.textContent).not.toContain("classifier score uuid rank 2026-05-01");
    expect(dialog?.textContent).not.toContain("runtimeCandidateScore rank id 2026-05-01 came from the classifier");
    expect(dialog?.textContent).not.toContain("2026-05-01 came from the classifier");
    expect(dialog?.textContent).toContain("Related inspiration evidence 10");
    expect(dialog?.textContent).not.toContain("runtimeCandidateScore");
    expect(dialog?.textContent).not.toContain("embedding");
    expect(dialog?.textContent).not.toContain("raw prompt");
    expect(dialog?.textContent).not.toContain("provider payload");
    expect(dialog?.textContent).not.toContain("DB_CONNECTION_URL");
    expect(dialog?.textContent).not.toContain("inspiration-10");
    expect(dialog?.textContent).not.toContain("moment-10");
    expect(inspectButton?.getAttribute("aria-expanded")).toBe("true");
  });
});
