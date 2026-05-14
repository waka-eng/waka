// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationsBoard } from "../src/components/InspirationsBoard";
import {
  fetchInspirations,
  fetchReflections,
  fetchWowMoments,
} from "../src/lib/api";
import type { ApiInspiration, ApiWowMoment } from "../src/lib/api";
import {
  HomePage,
  HomeViewToggle,
  nextHomeCaptureHandoffState,
} from "../src/pages/Home";

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "river@example.com",
      name: "River",
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => null),
  }),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchInspirations: vi.fn(async () => []),
    fetchReflections: vi.fn(async () => []),
    fetchWowMoments: vi.fn(async () => []),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

const sampleInspirations: ApiInspiration[] = [
  {
    id: "insp-1",
    userId: "user-1",
    text: "Architecture essay about bridge rhythms in city walks",
    kind: "note",
    category: null,
    importanceScore: 7,
    wowScore: 4,
    cluster: "bridge",
    classifiedAt: "2026-05-10T12:00:00.000Z",
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
  },
  {
    id: "insp-2",
    userId: "user-1",
    text: "Synthetic memory note for rereading old journals",
    kind: "quote",
    category: null,
    importanceScore: 5,
    wowScore: 8,
    cluster: "tension",
    classifiedAt: "2026-05-09T12:00:00.000Z",
    createdAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-09T12:00:00.000Z",
  },
  {
    id: "insp-3",
    userId: "user-1",
    text: "Unclassified cooking image idea",
    kind: "image",
    category: null,
    importanceScore: 2,
    wowScore: 1,
    cluster: null,
    classifiedAt: null,
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:00.000Z",
  },
];

const sampleWowMoments: ApiWowMoment[] = [
  {
    id: "wow-1",
    userId: "user-1",
    title: "Cities keep teaching through bridges",
    kind: "bridge",
    why: "Several saves connect architecture essays with walking routes and jazz history.",
    reflectionQuestion: "What bridge keeps reappearing?",
    wowScore: 9,
    createdAt: "2026-05-11T12:00:00.000Z",
    updatedAt: "2026-05-11T12:00:00.000Z",
    relatedInspirations: [
      {
        inspirationId: "insp-1",
        role: "anchor",
        reason: "This save anchors the pattern.",
        text: "Architecture essay about bridge rhythms in city walks",
        kind: "note",
        createdAt: "2026-05-10T12:00:00.000Z",
      },
    ],
  },
  {
    id: "wow-2",
    userId: "user-1",
    title: "Memory tools are productive tensions",
    kind: "tension",
    why: "Your notes keep treating synthetic memory as both tool and crutch.",
    reflectionQuestion: null,
    wowScore: 8,
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    relatedInspirations: [],
  },
];

function setApiFixtures({
  inspirations = sampleInspirations,
  wowMoments = sampleWowMoments,
}: {
  inspirations?: ApiInspiration[];
  wowMoments?: ApiWowMoment[];
} = {}): void {
  vi.mocked(fetchInspirations).mockResolvedValue(inspirations);
  vi.mocked(fetchReflections).mockResolvedValue([]);
  vi.mocked(fetchWowMoments).mockResolvedValue(wowMoments);
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
  vi.clearAllMocks();
});

async function renderHomePage(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(HomePage));
  });
  await flushReactWork();

  return container;
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const packageCssPath = resolve(process.cwd(), "src/styles/global.css");
const workspaceCssPath = resolve(process.cwd(), "packages/web/src/styles/global.css");
const globalCss = readFileSync(
  existsSync(packageCssPath) ? packageCssPath : workspaceCssPath,
  "utf8",
);

describe("HomePage view model", () => {
  it("defaults to Wow Moment First as a primary grid of WOW moment cards", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(
      container.querySelector<HTMLElement>(".home-view-switcher")?.dataset
        .activeView,
    ).toBe("wow");
    expect(container.textContent).toContain("WAKA — wow moments");
    expect(container.textContent).toContain("Wow Moment First");
    expect(container.textContent).toContain("WOW moments");
    expect(container.textContent).not.toContain("WOW moment dashboard");
    expect(container.textContent).not.toContain("Start with the durable patterns");
    expect(container.querySelector(".wow-moments-grid")).not.toBeNull();
    expect(container.querySelectorAll(".wow-moment-card")).toHaveLength(2);
    expect(container.textContent).toContain("Cities keep teaching through bridges");
    expect(container.querySelector(".grid.home-grid")).toBeNull();
    expect(container.querySelector("#capNote")).toBeNull();
  });

  it("switches from WOW Moment First to Inspiration First with the view switcher", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const inspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");

    await act(async () => {
      inspirationButton?.click();
    });
    await flushReactWork();

    const nextInspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");

    expect(
      container.querySelector<HTMLElement>(".home-view-switcher")?.dataset
        .activeView,
    ).toBe("inspiration");
    expect(nextInspirationButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("WAKA — your inspirations");
    expect(container.querySelector(".inspiration-discovery-panel")).not.toBeNull();
    expect(container.querySelector(".inspiration-first-capture #capture")).not.toBeNull();
    expect(container.querySelector(".grid.home-grid")).toBeNull();

    const captureCell = container.querySelector<HTMLElement>("#capture");
    const switcher = container.querySelector<HTMLElement>(".home-view-switcher");
    const discoveryPanel = container.querySelector<HTMLElement>(
      ".inspiration-discovery-panel",
    );
    expect(
      Boolean(captureCell?.compareDocumentPosition(switcher!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(captureCell?.compareDocumentPosition(discoveryPanel!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("renders Inspiration First as a simple list without cluster or kind controls/cards", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const inspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");
    await act(async () => {
      inspirationButton?.click();
    });
    await flushReactWork();

    const panel = container.querySelector<HTMLElement>(
      ".inspiration-discovery-panel",
    );
    expect(panel?.textContent).toContain("3 of 3 inspirations");
    expect(container.querySelector(".inspiration-results-grid")).not.toBeNull();
    expect(container.querySelectorAll(".inspiration-result-card")).toHaveLength(3);
    expect(container.querySelector('select[aria-label="Filter by cluster"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Filter by kind"]')).toBeNull();
    expect(container.querySelectorAll(".grid.home-grid .wm-card")).toHaveLength(0);
    expect(globalCss).toMatch(
      /\.inspiration-result-text\s*\{[\s\S]*?font-size:\s*clamp\(14px, 1\.25vw, 18px\);[\s\S]*?line-height:\s*1\.28;/,
    );

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search inspirations"]',
    );
    expect(search).not.toBeNull();

    await act(async () => {
      setInputValue(search!, "synthetic");
    });
    const searchedPanel = container.querySelector<HTMLElement>(
      ".inspiration-discovery-panel",
    );
    expect(searchedPanel?.textContent).toContain("1 of 3 inspirations");
    expect(searchedPanel?.textContent).toContain("Synthetic memory note");
    expect(searchedPanel?.textContent).not.toContain("Architecture essay");
  });

  it("does not render backend kind or cluster metadata in Inspiration First history or detail", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const inspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");
    await act(async () => {
      inspirationButton?.click();
    });
    await flushReactWork();

    await act(async () => {
      container.querySelector<HTMLElement>("#metaCount")?.click();
    });
    await flushReactWork();

    const historyPanel = container.querySelector<HTMLElement>(".history-overlay");
    expect(historyPanel?.classList.contains("visible")).toBe(true);
    expect(historyPanel?.querySelectorAll(".history-item")).toHaveLength(3);
    expect(historyPanel?.querySelector(".history-item-cluster")).toBeNull();

    const historyMetaText = Array.from(
      historyPanel?.querySelectorAll<HTMLElement>(".history-item-meta") ?? [],
    ).map((node) => node.textContent ?? "");
    expect(historyMetaText.some((text) => /\b(NOTE|QUOTE|IMAGE)\b/.test(text))).toBe(false);
    expect(historyPanel?.textContent).not.toContain(
      "architecture essays and jazz history",
    );
    expect(historyPanel?.textContent).not.toContain(
      "synthetic memory: tool or crutch",
    );

    const bridgeCard = Array.from(
      historyPanel?.querySelectorAll<HTMLElement>(".history-item") ?? [],
    ).find((card) =>
      card.textContent?.includes("Architecture essay about bridge rhythms"),
    );
    expect(bridgeCard).not.toBeUndefined();

    await act(async () => {
      bridgeCard?.click();
    });
    await flushReactWork();
    await flushReactWork();

    const detail = container.querySelector<HTMLElement>(".detail-view");
    expect(detail?.textContent).toContain(
      "Architecture essay about bridge rhythms in city walks",
    );
    expect(detail?.querySelector(".detail-meta")?.textContent).not.toContain(
      "architecture essays and jazz history",
    );
    expect(detail?.querySelector(".detail-meta")?.textContent).not.toContain(
      "note",
    );
    expect(vi.mocked(fetchReflections)).toHaveBeenCalledWith("insp-1");
  });

  it("clicking the Wow header Capture button switches to Inspiration First and focuses capture", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const initialSwitcher = container.querySelector<HTMLElement>(
      ".home-view-switcher",
    );
    expect(initialSwitcher?.dataset.activeView).toBe("wow");
    expect(container.textContent).toContain("WAKA — wow moments");
    expect(container.querySelector("#capNote")).toBeNull();

    const captureButton = container.querySelector<HTMLButtonElement>(
      "#captureTrigger",
    );
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton?.click();
    });
    await flushReactWork();

    const nextSwitcher = container.querySelector<HTMLElement>(
      ".home-view-switcher",
    );
    const inspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");
    const captureCell = container.querySelector<HTMLDivElement>("#capture");
    const captureTextarea = container.querySelector<HTMLTextAreaElement>(
      '#capNote[placeholder="A link, a note, an image — whatever\'s inspiring you right now…"]',
    );

    expect(nextSwitcher?.dataset.activeView).toBe("inspiration");
    expect(inspirationButton?.getAttribute("aria-pressed")).toBe("true");
    expect(captureTextarea).not.toBeNull();
    expect(captureCell?.classList.contains("focused")).toBe(true);
    expect(document.activeElement).toBe(captureTextarea);
  });

  it("can render the switcher in Inspiration First state", () => {
    const html = renderToStaticMarkup(
      createElement(HomeViewToggle, {
        activeView: "inspiration",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("data-active-view=\"inspiration\"");
    expect(html).toContain("Wow Moment First");
    expect(html).toContain("Inspiration First");
    expect(html).toContain("aria-pressed=\"true\">Inspiration First</button>");
  });

  it("hands off Wow header Capture to Inspiration First with a focus request", () => {
    expect(nextHomeCaptureHandoffState(0)).toEqual({
      activeView: "inspiration",
      autoFocusCaptureRequest: 1,
    });
    expect(nextHomeCaptureHandoffState(7)).toEqual({
      activeView: "inspiration",
      autoFocusCaptureRequest: 8,
    });
  });

  it("keeps the inspiration tagline for the Inspiration First board", () => {
    const html = renderToStaticMarkup(createElement(InspirationsBoard));

    expect(html).toContain("WAKA <em>— your inspirations</em>");
  });
});
