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
    expect(html).toContain("Keep saving inspirations");
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

  it("renders populated WOW moment cards", () => {
    const html = renderSection({
      moments: [sampleMoment],
      loading: false,
      error: null,
    });

    expect(html).toContain("1 moments · 1 links");
    expect(html).toContain("Bridge");
    expect(html).toContain("Prototype idea keeps returning");
    expect(html).toContain("Connects a mobile note with a design sketch.");
    expect(html).toContain("A field note about playful prototypes.");
    expect(html).toContain("What would make this bridge testable this week?");
  });
});
