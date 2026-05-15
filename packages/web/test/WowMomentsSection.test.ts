import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

function renderSection(props: Parameters<typeof WowMomentsSection>[0]): string {
  return renderToStaticMarkup(WowMomentsSection(props));
}

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

    expect(html).not.toContain("wow-moments-count");
    expect(html).not.toContain("WOW moments shown");
    expect(html).not.toContain(">1</span>");
    expect(html).not.toContain("confidence");
    expect(html).toContain("Prototype idea keeps returning");
    expect(html).not.toContain("Connects a mobile note with a design sketch.");
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

  it("caps populated WOW moment cards at nine and counts only visible related evidence", () => {
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

    expect(html).not.toContain("wow-moments-count");
    expect(html).not.toContain("WOW moments shown");
    expect(html).not.toContain("9 of 11");
    expect(html).toContain("wow-moments-grid wow-moments-grid--populated");
    expect(html.match(/class=\"wow-moment-card\"/g)).toHaveLength(9);
    expect(html).toContain("WOW card 9");
    expect(html).toContain("Related inspiration evidence 9");
    expect(html).not.toContain("Evidence reason 9");
    expect(html).not.toContain("primary");
    expect(html).not.toContain("WOW card 10");
    expect(html).not.toContain("Related inspiration evidence 10");
  });
});
