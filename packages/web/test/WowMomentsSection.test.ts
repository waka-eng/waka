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

function renderSection(props: Parameters<typeof WowMomentsSection>[0]): string {
  return renderToStaticMarkup(WowMomentsSection(props));
}

describe("WowMomentsSection", () => {
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

  it("renders every related inspiration as text snippets only", () => {
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

    expect(html).toContain("aria-label=\"1 WOW moments shown\"");
    expect(html).not.toContain("confidence");
    expect(html).toContain("Prototype idea keeps returning");
    expect(html).not.toContain("Connects a mobile note with a design sketch.");
    expect(html).toContain("A field note about playful prototypes.");
    expect(html).toContain("A sketch that turned the field note into a grid.");
    expect(html).toContain("A voice memo asking for smaller WOW cards.");
    expect(html).toContain("A prototype review that asked to keep every spark visible.");
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

    expect(html).toContain("aria-label=\"9 WOW moments shown\"");
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
