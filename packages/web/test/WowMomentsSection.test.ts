/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { WowMomentsSection } from "../src/components/WowMomentsSection";
import type { ApiWowMoment } from "../src/lib/api";

const sampleMoment: ApiWowMoment = {
  id: "moment-1",
  userId: "user-1",
  title: "Prototype idea keeps returning",
  kind: "bridge",
  why: "Connects a mobile note with a design sketch.",
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

    expect(html).toContain("1 best-recent WOW moments shown.");
    expect(html).toContain("Inspect all WOW moments (1)");
    expect(html).not.toContain(">1</span>");
    expect(html).not.toContain("confidence");
    expect(html).toContain("Prototype idea keeps returning");
    expect(html).toContain("DEV WOW score 73");
    expect(html).toContain("Why it’s a WOW");
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
    expect(html).toContain("Open detail");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("aria-label=\"Open WOW moment details: Prototype idea keeps returning\"");
    expect(globalCss).toMatch(
      /\.wow-moment-open-cue\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none;/,
    );
    expect(globalCss).toMatch(
      /\.wow-moment-card--interactive:is\(:hover, :focus-visible, :focus-within\) \.wow-moment-open-cue\s*\{[\s\S]*?opacity:\s*1;/,
    );
  });

  it("renders full WOW reasoning on the main card without CSS line clamping", () => {
    const longWhy =
      "Why it’s a WOW because the pattern connects a mobile note, a design sketch, and a prototype review into one complete insight that should remain visible through the final sentence.";
    const html = renderSection({
      moments: [{ ...sampleMoment, why: longWhy }],
      loading: false,
      error: null,
    });

    expect(html).toContain("aria-label=\"Why it’s a WOW\"");
    expect(html).toContain("Why it’s a WOW");
    expect(html).toContain(longWhy);
    expect(html).toContain("through the final sentence");

    const whyRule = globalCss.match(/\.wow-moment-why p\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(whyRule).toContain("overflow-wrap: anywhere;");
    expect(whyRule).not.toMatch(/-webkit-line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  });

  it("opens a focused detail panel from a populated WOW card and labels reasoning/source reasons", () => {
    const container = renderInteractiveSection({ moments: [sampleMoment], loading: false, error: null });

    expect(container.textContent).toContain("Prototype idea keeps returning");
    expect(container.textContent).toContain("Why it’s a WOW");
    expect(container.textContent).toContain("Connects a mobile note with a design sketch.");
    expect(container.textContent).toContain("A field note about playful prototypes.");
    expect(container.textContent).not.toContain("What would make this bridge testable this week?");

    const card = container.querySelector<HTMLElement>(".wow-moment-card[role='button']");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("tabindex")).toBe("0");
    expect(card?.getAttribute("aria-label")).toContain("Open WOW moment details");

    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Prototype idea keeps returning");
    expect(dialog?.textContent).toContain("Why it’s a WOW");
    expect(dialog?.textContent).toContain("Connects a mobile note with a design sketch.");
    expect(dialog?.textContent).toContain("What would make this bridge testable this week?");
    expect(dialog?.textContent).toContain("DEV WOW score 73");
    expect(dialog?.textContent).toContain("A field note about playful prototypes.");
    expect(dialog?.textContent).toContain("Source reason");
    expect(dialog?.textContent).toContain("First signal in the bridge.");
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

    expect(html).toContain("9 best-recent WOW moments shown.");
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

    expect(container.textContent).toContain("9 best-recent WOW moments shown.");
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
    expect(dialog?.textContent).toContain("DEV WOW score 81");
    expect(dialog?.textContent).toContain("Reasoning");
    expect(dialog?.textContent).toContain("Why WOW card 10 matters.");
    expect(dialog?.textContent).toContain("1 related source");
    expect(dialog?.textContent).toContain("contrast");
    expect(dialog?.textContent).toContain("Related inspiration evidence 10");
    expect(dialog?.textContent).toContain("Source reason");
    expect(dialog?.textContent).toContain("First signal in the bridge.");
    expect(inspectButton?.getAttribute("aria-expanded")).toBe("true");
  });
});
