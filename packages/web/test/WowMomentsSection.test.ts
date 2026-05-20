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
    expect(html).toContain("Inspect all WOW moments (1)");
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

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const lead = dialog?.querySelector<HTMLElement>(".wow-moment-pattern-lead");
    const points = Array.from(dialog?.querySelectorAll<HTMLElement>(".wow-moment-pattern-list li") ?? []);

    expect(dialog?.textContent).toContain("How the pattern shows up");
    expect(dialog?.querySelector(".wow-moment-pattern-body")?.getAttribute("aria-label")).toBe(
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
    expect(dialog?.textContent).toContain("A field note about playful prototypes.");
    expect(dialog?.textContent).toContain("First signal in the bridge.");
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

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const lead = dialog?.querySelector<HTMLElement>(".wow-moment-pattern-lead");
    const points = Array.from(dialog?.querySelectorAll<HTMLElement>(".wow-moment-pattern-list li") ?? []);
    const pointText = points.map((point) => point.textContent ?? "");

    expect(lead).toBeNull();
    expect(points.length).toBeGreaterThan(1);
    expect(pointText.every((point) => point.length <= 240)).toBe(true);
    expect(pointText.join("")).toBe(longWhy);
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

    const dialog = container.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Prototype idea keeps returning");
    expect(dialog?.textContent).toContain("Personal pattern report");
    expect(dialog?.textContent).toContain("How the pattern shows up");
    expect(dialog?.textContent).toContain("Connects a mobile note with a design sketch.");
    expect(dialog?.textContent).toContain("What this may say about you");
    expect(dialog?.textContent).toContain("Treat this as a mirror, not a recommendation.");
    expect(dialog?.textContent).toContain("Reflection question");
    expect(dialog?.textContent).toContain("What would make this bridge testable this week?");
    expect(dialog?.textContent).toContain("A belief this may point to");
    expect(dialog?.textContent).toContain(
      "One possible reading: because “Connects a mobile note with a design sketch”, this may point to a belief that “Prototype idea keeps returning” is worth exploring rather than treating as a one-off spark.",
    );
    expect(dialog?.textContent).not.toContain(
      "You seem drawn to ideas that keep showing up in different forms.",
    );
    expect(dialog?.textContent).toContain("Does this feel true?");
    expect(dialog?.textContent).toContain("Feels true");
    expect(dialog?.textContent).toContain("Not quite");
    expect(dialog?.textContent).not.toContain("DEV WOW score 73");
    expect(dialog?.textContent).toContain("Inspirations behind this");
    expect(dialog?.textContent).toContain("1 source");
    expect(dialog?.textContent).toContain("A field note about playful prototypes.");
    expect(dialog?.textContent).toContain("Why this source matters");
    expect(dialog?.textContent).toContain("First signal in the bridge.");
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

    const dialog = container.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
    const sourceCount = dialog?.querySelector<HTMLElement>(".wow-moment-source-count");

    expect(sourceCount?.textContent).toBe("3 sources");
    expect(dialog?.textContent).toContain("Inspirations behind this");
    expect(dialog?.textContent).toContain("A sketch that turned the field note into a grid.");
    expect(dialog?.textContent).not.toContain("primary");
    expect(dialog?.textContent).not.toContain("supporting");
    expect(dialog?.textContent).not.toContain("contrast");
    expect(dialog?.textContent).not.toContain("DEV WOW score 73");
    expect(dialog?.textContent).not.toContain("2026-04-30");
    expect(globalCss).toContain(".wow-moment-source-count");
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

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const beliefText =
      dialog?.querySelector<HTMLElement>(".wow-moment-detail-section--belief > p")?.textContent ?? "";
    expect(beliefText).toContain("One possible reading");
    expect(beliefText.length).toBeLessThan(260);
    expect(beliefText).toContain("…");
    expect(beliefText).not.toContain("final tail that must stay out of the belief excerpt");
    expect(beliefText).not.toContain("final sentence that proves source cards are not truncated");
    expect(dialog?.textContent).toContain(longWhy);
    expect(dialog?.textContent).toContain(longSourceText);
    expect(dialog?.textContent).toContain(longSourceReason);
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

    const dialogText = container.querySelector<HTMLElement>("[role='dialog']")?.textContent ?? "";
    expect(dialogText).toContain("A belief this may point to");
    expect(dialogText).toContain(
      "One possible reading: “Quiet interfaces feel more humane” may matter through this source note: “saved because the calm layout made progress feel less punishing”. It points to a belief worth testing gently.",
    );
    expect(dialogText).toContain("Does this feel true?");
    expect(dialogText).not.toContain("You seem drawn to ideas that keep showing up in different forms.");
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
      container.querySelector<HTMLElement>(".wow-moment-detail-section--belief > p")?.textContent ?? "";
    expect(beliefText).toContain("You may believe progress should feel humane, not pressurized. Does this feel true?");
    expect(beliefText).not.toContain("One possible reading");
    expect(beliefText).not.toContain("Title that should not be repurposed");
    expect(beliefText).not.toContain("Why text that should not become the belief sentence");
  });

  it("keeps belief resonance buttons local, selected, and explicitly unsaved", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
    expect(dialog?.textContent).toContain("For reflection only; not saved.");
    const buttons = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button") ?? [],
    );
    const feelsTrueButton = buttons.find((button) => button.textContent?.trim() === "Feels true");
    const notQuiteButton = buttons.find((button) => button.textContent?.trim() === "Not quite");

    expect(feelsTrueButton).not.toBeUndefined();
    expect(notQuiteButton).not.toBeUndefined();
    expect(feelsTrueButton?.getAttribute("aria-pressed")).toBe("false");
    expect(notQuiteButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      feelsTrueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(feelsTrueButton?.getAttribute("aria-pressed")).toBe("true");
    expect(notQuiteButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      notQuiteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(feelsTrueButton?.getAttribute("aria-pressed")).toBe("false");
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
    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const reopenedButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wow-moment-belief-actions button"),
    );
    expect(reopenedButtons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
    ]);
  });

  it("opens details with keyboard activation and closes with the Close button and Escape", () => {
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });
    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");

    act(() => {
      card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container.querySelector("[role='dialog']")?.textContent).toContain(
      "Connects a mobile note with a design sketch.",
    );

    const closeButton = container.querySelector<HTMLButtonElement>(".wow-moment-detail-close");
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();

    act(() => {
      card?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(container.querySelector("[role='dialog']")?.textContent).toContain(
      "What would make this bridge testable this week?",
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("caps populated WOW moment cards at nine while showing the best-recent count and inspect action", () => {
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
    expect(html).toContain("Inspect all WOW moments (11)");
    expect(html).toContain("wow-moments-grid wow-moments-grid--populated");
    expect(html.match(/class=\"wow-moment-card wow-moment-card--interactive\"/g)).toHaveLength(9);
    expect(html).toContain("WOW card 9");
    expect(html).toContain("Related inspiration evidence 9");
    expect(html).not.toContain("Evidence reason 9");
    expect(html).not.toContain("primary");
    expect(html).not.toContain("WOW card 10");
    expect(html).not.toContain("Related inspiration evidence 10");
  });

  it("opens the all-moments sidebar only after pressing inspect and lists available moments with source details", () => {
    const moments = Array.from({ length: 10 }, (_, index) => ({
      ...sampleMoment,
      id: `moment-${index + 1}`,
      title: `WOW card ${index + 1}`,
      wowScore: 90 - index,
      why: `Why WOW card ${index + 1} matters.`,
      relatedInspirations: [
        {
          ...sampleMoment.relatedInspirations[0]!,
          inspirationId: `inspiration-${index + 1}`,
          role: index === 9 ? "contrast" : "primary",
          text: `Related inspiration evidence ${index + 1}`,
        },
      ],
    }));
    const container = renderInteractiveSection({ moments, loading: false, error: null });

    expect(container.textContent).toContain("9 best-recent mirror moments shown.");
    expect(container.textContent).toContain("Inspect all WOW moments (10)");
    expect(container.textContent).toContain("WOW card 9");
    expect(container.textContent).not.toContain("Available WOW moments");
    expect(container.textContent).not.toContain("WOW card 10");
    expect(container.textContent).not.toContain("Related inspiration evidence 10");

    const inspectButton = container.querySelector<HTMLButtonElement>(".wow-moments-inspect-button");
    expect(inspectButton).not.toBeNull();
    expect(inspectButton?.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      inspectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector<HTMLElement>("#all-wow-moments-panel[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Available WOW moments");
    expect(dialog?.textContent).toContain("WOW card 10");
    expect(dialog?.textContent).not.toContain("DEV WOW score 81");
    expect(dialog?.textContent).not.toContain("DEV WOW score");
    expect(dialog?.textContent).toContain("Why WAKA noticed this");
    expect(dialog?.textContent).toContain("Why WOW card 10 matters.");
    expect(dialog?.textContent).toContain("1 source connected");
    expect(dialog?.textContent).not.toContain("contrast");
    expect(dialog?.textContent).toContain("Related inspiration evidence 10");
    expect(dialog?.textContent).toContain("Source inspiration");
    expect(dialog?.textContent).toContain("Why this source matters");
    expect(dialog?.textContent).toContain("First signal in the bridge.");
    expect(inspectButton?.getAttribute("aria-expanded")).toBe("true");
  });
});
