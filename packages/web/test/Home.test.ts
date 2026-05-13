// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationsBoard } from "../src/components/InspirationsBoard";
import { fetchInspirations, fetchWowMoments } from "../src/lib/api";
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
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

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
    expect(container.textContent).toContain("WOW moment dashboard");
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
    expect(container.querySelector(".grid.home-grid")).not.toBeNull();
  });

  it("filters Inspiration First results by text and cluster with clear counts and empty states", async () => {
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

    const clusterSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Filter by cluster"]',
    );
    await act(async () => {
      setSelectValue(clusterSelect!, "bridge");
    });
    expect(
      container.querySelector<HTMLElement>(".inspiration-discovery-panel")
        ?.textContent,
    ).toContain("No inspirations match those filters");
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
