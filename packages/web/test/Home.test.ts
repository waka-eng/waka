// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationsBoard } from "../src/components/InspirationsBoard";
import {
  createInspiration,
  createReflection,
  fetchBackgroundJobs,
  fetchInspirationScoreBreakdown,
  fetchInspirations,
  fetchReflections,
  fetchWowMoments,
  fetchWowStatus,
  updateInspiration,
} from "../src/lib/api";
import type {
  ApiBackgroundJob,
  ApiInspiration,
  ApiReflection,
  ApiWowMoment,
  ApiWowStatusRow,
} from "../src/lib/api";
import {
  HomePage,
  HomeViewToggle,
  nextHomeCaptureHandoffState,
  shouldShowInternalStatus,
} from "../src/pages/Home";

const mockAuthState = vi.hoisted(() => ({
  value: {
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
  },
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => mockAuthState.value,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchInspirations: vi.fn(async () => []),
    fetchInspirationScoreBreakdown: vi.fn(async () => ({
      inspirationId: "insp-1",
      displayedWowScore: 12,
      persistedCoreWowScore: 7,
      importanceScore: 9,
      freshnessAdjustment: {
        ageDays: 2,
        freshnessScore: 95,
        displayedMinusCore: 5,
        source: "read_time",
      },
      stored: { importanceScore: 9, coreWowScore: 7 },
      factors: {
        content: {
          score: 18,
          textDepthScore: 14,
          contextScore: 27,
          meaningfulLinkCount: 1,
          nonLinkAttachmentCount: 0,
          reflectionTextChars: 44,
        },
        processing: { score: 100, hasReflection: true },
        revisit: {
          score: 21,
          uniqueRevisitDays: 1,
          totalRevisitCount: 1,
          recentRevisitCount: 1,
          uniqueRevisitDaysScore: 33,
          totalRevisitCountScore: 20,
          revisitedInLast7DaysScore: 100,
        },
        relationship: {
          available: false,
          score: null,
          topSimilaritySignal: null,
          topSurpriseSimilaritySignal: null,
          timeDistanceSignal: null,
          relatedCandidateCount: 0,
          note: "No stored embedding for this inspiration, so no relationship score is shown; viewing does not generate embeddings.",
        },
      },
      formulas: {
        importance: "ImportanceScore = 40% ContentDepth + 25% Processing + 25% Revisit + 10% TimeSignal",
        coreWow: "CoreWowScore = 55% ImportanceScore + 45% RelationshipScore",
        displayedWow: "DisplayedScore = 90% CoreWowScore + 10% FreshnessDecay",
      },
    })),
    fetchReflections: vi.fn(async () => []),
    fetchWowMoments: vi.fn(async () => []),
    fetchWowStatus: vi.fn(async () => []),
    createReflection: vi.fn(async () => {
      throw new Error("createReflection mock not configured");
    }),
    createInspiration: vi.fn(async () => {
      throw new Error("createInspiration mock not configured");
    }),
    updateInspiration: vi.fn(async () => {
      throw new Error("updateInspiration mock not configured");
    }),
    fetchBackgroundJobs: vi.fn(async () => []),
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

const sampleWowStatusRows: ApiWowStatusRow[] = [
  {
    inspiration: {
      id: "insp-1",
      textPreview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      category: null,
      cluster: "bridge",
      classifiedAt: "2026-05-10T12:05:00.000Z",
      importanceScore: 7,
      wowScore: 4,
      createdAt: "2026-05-10T12:00:00.000Z",
      updatedAt: "2026-05-10T12:05:00.000Z",
    },
    job: {
      id: "job-process-1",
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      updatedAt: "2026-05-10T12:05:00.000Z",
      lastError: null,
    },
    embedded: true,
    linkedWowMomentCount: 1,
    linkedWowMomentTitles: ["Cities keep teaching through bridges"],
  },
];

function setApiFixtures({
  inspirations = sampleInspirations,
  wowMoments = sampleWowMoments,
  wowStatusRows = sampleWowStatusRows,
}: {
  inspirations?: ApiInspiration[];
  wowMoments?: ApiWowMoment[];
  wowStatusRows?: ApiWowStatusRow[];
} = {}): void {
  vi.mocked(fetchInspirations).mockResolvedValue(inspirations);
  vi.mocked(fetchReflections).mockResolvedValue([]);
  vi.mocked(fetchWowMoments).mockResolvedValue(wowMoments);
  vi.mocked(fetchWowStatus).mockResolvedValue(wowStatusRows);
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
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    input instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function getInspirationResultTexts(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".inspiration-result-text"),
  ).map((node) => node.textContent ?? "");
}

async function switchToInspirationFirst(container: HTMLElement): Promise<void> {
  const inspirationButton = Array.from(
    container.querySelectorAll<HTMLButtonElement>(".home-view-switcher button"),
  ).find((button) => button.textContent === "Inspiration First");

  await act(async () => {
    inspirationButton?.click();
  });
  await flushReactWork();
}

async function switchToWowStatus(container: HTMLElement): Promise<void> {
  const statusButton = Array.from(
    container.querySelectorAll<HTMLButtonElement>(".home-view-switcher button"),
  ).find((button) => button.textContent === "WOW STATUS");

  await act(async () => {
    statusButton?.click();
  });
  await flushReactWork();
}

async function saveInspirationFromCapture(
  container: HTMLElement,
  text: string,
): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>("#capNote");
  expect(textarea).not.toBeNull();

  await act(async () => {
    setInputValue(textarea!, text);
  });

  const saveButton = container.querySelector<HTMLButtonElement>("#capSave");
  expect(saveButton).not.toBeNull();

  await act(async () => {
    saveButton?.click();
  });
  await flushReactWork();
}

function persistedInspiration(overrides: Partial<ApiInspiration> = {}): ApiInspiration {
  return {
    id: "insp-new-1234567890",
    userId: "user-1",
    text: "New demo inspiration about recurring library rituals",
    kind: null,
    category: null,
    importanceScore: 0,
    wowScore: 0,
    cluster: null,
    classifiedAt: null,
    createdAt: "2026-05-14T16:30:00.000Z",
    updatedAt: "2026-05-14T16:30:00.000Z",
    ...overrides,
  };
}

function persistedReflection(overrides: Partial<ApiReflection> = {}): ApiReflection {
  return {
    id: "reflection-new-1234567890",
    inspirationId: "insp-1",
    userId: "user-1",
    question: "What about this is worth remembering?",
    answer: "It turns a quick save into something I can use.",
    skipped: false,
    createdAt: "2026-05-14T16:31:00.000Z",
    ...overrides,
  };
}

const sampleBackgroundJobs: ApiBackgroundJob[] = [
  {
    id: "job-process-1",
    type: "process_inspiration",
    status: "running",
    createdAt: "2026-05-14T16:30:01.000Z",
    updatedAt: "2026-05-14T16:30:02.000Z",
  },
];

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
    expect(container.querySelector(".inspiration-results-header")).not.toBeNull();
    expect(container.querySelectorAll(".inspiration-result-card")).toHaveLength(3);
    expect(container.querySelector('select[aria-label="Filter by status"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Filter by date"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Sort inspirations"]')).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label^="Sort by inspiration text"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Sort by saved time"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Sort by WOW score"]'),
    ).not.toBeNull();
    const resultMetaText = Array.from(
      container.querySelectorAll<HTMLElement>(".inspiration-result-meta"),
    ).map((node) => node.textContent ?? "");
    expect(resultMetaText).toEqual(
      expect.arrayContaining([
        expect.stringContaining("WOW 4"),
        expect.stringContaining("WOW 8"),
        expect.stringContaining("WOW 1"),
      ]),
    );
    expect(resultMetaText.some((text) => /\b(NOTE|QUOTE|IMAGE)\b/.test(text))).toBe(false);
    expect(resultMetaText.some((text) => /\b(BRIDGE|TENSION)\b/.test(text))).toBe(false);
    expect(container.querySelector('select[aria-label="Filter by cluster"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Filter by kind"]')).toBeNull();
    expect(container.textContent).not.toContain("All statuses");
    expect(container.textContent).not.toContain("Any date");
    expect(container.textContent).not.toContain("Newest first");
    expect(container.textContent).not.toContain("Oldest first");
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

  it("explains WAKA scoring from an accessible Inspiration First disclosure", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const explainerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="inspiration-score-explainer"]',
    );
    expect(explainerButton).not.toBeNull();
    expect(explainerButton?.textContent).toContain("How scoring works");
    expect(explainerButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#inspiration-score-explainer")).toBeNull();

    await act(async () => {
      explainerButton?.click();
    });
    await flushReactWork();

    const explainer = container.querySelector<HTMLElement>(
      "#inspiration-score-explainer",
    );
    expect(explainerButton?.getAttribute("aria-expanded")).toBe("true");
    expect(explainer).not.toBeNull();
    const explainerText = (explainer?.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(explainerText).toContain("Current implementation");
    expect(explainerText).toContain("database persists WowScore as a core WOW snapshot");
    expect(explainerText).toContain("freshness-adjusted WOW score");
    expect(explainerText).toContain("Relationship signals now use stored embeddings");
    expect(explainerText).toContain("revisit signals use meaningful return events");
    expect(explainerText).toContain("Implemented scoring model");
    expect(explainerText).toContain(
      "ImportanceScore = 40% ContentDepth + 25% Processing + 25% Revisit + 10% TimeSignal",
    );
    expect(explainerText).toContain("ContentDepth = 70% TextDepth + 30% Context");
    expect(explainerText).toContain("Bare URL spam does not earn Context credit");
    expect(explainerText).toContain("hasReflection");
    expect(explainerText).toContain(
      "Revisit = 65% Unique days + 25% total revisits + 10% revisited last 7 days",
    );
    expect(explainerText).toContain(
      "RelationshipScore = 45% TopSimilarity + 35% TopSurpriseSimilarity + 20% TimeDistance",
    );
    expect(explainerText).toContain(
      "CoreWowScore = 55% ImportanceScore + 45% RelationshipScore",
    );
    expect(explainerText).toContain(
      "FreshnessDecay = 0.5^(ageDays / 30)",
    );
    expect(explainerText).toContain("30-day freshness half-life");
    expect(explainerText).toContain(
      "DisplayedScore = 90% CoreWowScore + 10% FreshnessDecay",
    );
    expect(explainerText).toContain("user-facing score returned by the API");
    expect(explainerText).toContain("top-k, bounded retrieval");
    expect(explainerText).toContain("does not send the full inspiration history");
    expect(explainerText).toContain("save, edit, reflection, meaningful revisit");
    expect(explainerText).toContain("embedding refresh");
    expect(explainerText).toContain("new related inspiration");
    expect(explainerText).toContain("WOW generation");
    expect(explainerText).toContain("bounded updates");
    expect(explainerText).toContain("AI/LLM");
    expect(explainerText).toContain("judging and writing WOW moments");
    expect(explainerText).toContain("does not ask an LLM to calculate the score");
    expect(explainerText).not.toMatch(/cluster|kind|Filter by/i);
  });

  it("sorts Inspiration First rows through accessible column headers", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    expect(getInspirationResultTexts(container)).toEqual([
      "Architecture essay about bridge rhythms in city walks",
      "Synthetic memory note for rereading old journals",
      "Unclassified cooking image idea",
    ]);

    const wowSort = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Sort by WOW score"]',
    );
    expect(wowSort).not.toBeNull();

    await act(async () => {
      wowSort?.click();
    });
    await flushReactWork();

    expect(wowSort?.getAttribute("aria-pressed")).toBe("true");
    expect(wowSort?.getAttribute("aria-label")).toContain("descending");
    expect(getInspirationResultTexts(container)).toEqual([
      "Synthetic memory note for rereading old journals",
      "Architecture essay about bridge rhythms in city walks",
      "Unclassified cooking image idea",
    ]);

    await act(async () => {
      wowSort?.click();
    });
    await flushReactWork();

    expect(wowSort?.getAttribute("aria-label")).toContain("ascending");
    expect(getInspirationResultTexts(container)).toEqual([
      "Unclassified cooking image idea",
      "Architecture essay about bridge rhythms in city walks",
      "Synthetic memory note for rereading old journals",
    ]);
  });

  it("quick save still creates only the inspiration and preserves fast capture behavior", async () => {
    setApiFixtures({ inspirations: [] });
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-quick-save",
        text: "Fast save without reflective friction",
      }),
    );

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    await saveInspirationFromCapture(container, "Fast save without reflective friction");

    expect(createInspiration).toHaveBeenCalledTimes(1);
    expect(createInspiration).toHaveBeenCalledWith({
      text: "Fast save without reflective friction",
    });
    expect(createReflection).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("");
    expect(container.querySelector(".capture--reflect")).toBeNull();
  });

  it("reflective save creates the inspiration before attaching the guided reflection", async () => {
    setApiFixtures({ inspirations: [] });
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-reflective-save",
        text: "A passage about small rituals compounding",
      }),
    );
    vi.mocked(createReflection).mockResolvedValue({
      reflection: {
        id: "reflection-1",
        inspirationId: "insp-reflective-save",
        userId: "user-1",
        question: "What about this is worth remembering?",
        answer: "It names the quiet system behind the ritual.",
        skipped: false,
        createdAt: "2026-05-14T16:31:00.000Z",
      },
      inspiration: {
        id: "insp-reflective-save",
        importanceScore: 3,
        wowScore: 7,
      },
    });

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const textarea = container.querySelector<HTMLTextAreaElement>("#capNote");
    expect(textarea).not.toBeNull();
    await act(async () => {
      setInputValue(textarea!, "A passage about small rituals compounding");
    });

    const reflectiveButton = container.querySelector<HTMLButtonElement>("#capReflectiveSave");
    expect(reflectiveButton).not.toBeNull();
    await act(async () => {
      reflectiveButton?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".capture--reflect")).not.toBeNull();
    expect(container.textContent).toContain("Process this inspiration");
    expect(container.textContent).toContain("What about this is worth remembering?");

    const reflectionAnswer = container.querySelector<HTMLTextAreaElement>("#reflectAns");
    expect(reflectionAnswer).not.toBeNull();
    await act(async () => {
      setInputValue(reflectionAnswer!, "It names the quiet system behind the ritual.");
    });

    const continueButton = container.querySelector<HTMLButtonElement>("#reflectNext");
    await act(async () => {
      continueButton?.click();
    });
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledTimes(1);
    expect(createReflection).toHaveBeenCalledTimes(1);
    expect(createReflection).toHaveBeenCalledWith("insp-reflective-save", {
      question: "What about this is worth remembering?",
      answer: "It names the quiet system behind the ritual.",
      skipped: false,
    });
    expect(vi.mocked(createInspiration).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createReflection).mock.invocationCallOrder[0],
    );
    expect(container.querySelector(".history-item-reflections")?.textContent).toContain(
      "1 of 1 reflected",
    );
    expect(container.querySelector(".inspiration-result-meta")?.textContent).toContain(
      "WOW 7",
    );
  });

  it("keeps reflective mode open and explains that a reflection answer is needed", async () => {
    setApiFixtures({ inspirations: [] });

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const textarea = container.querySelector<HTMLTextAreaElement>("#capNote");
    expect(textarea).not.toBeNull();
    await act(async () => {
      setInputValue(textarea!, "Save only after I process this");
    });

    const reflectiveButton = container.querySelector<HTMLButtonElement>("#capReflectiveSave");
    await act(async () => {
      reflectiveButton?.click();
    });
    await flushReactWork();

    const continueButton = container.querySelector<HTMLButtonElement>("#reflectNext");
    await act(async () => {
      continueButton?.click();
    });
    await flushReactWork();

    expect(createInspiration).not.toHaveBeenCalled();
    expect(createReflection).not.toHaveBeenCalled();
    expect(container.querySelector(".capture--reflect")).not.toBeNull();
    expect(container.textContent).toContain("Add a thought before reflective save");
    expect(container.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "Save only after I process this",
    );
  });

  it("shows a selected inspiration WOW score breakdown in the detail panel", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const firstResult = container.querySelector<HTMLButtonElement>(
      ".inspiration-result-card",
    );
    expect(firstResult).not.toBeNull();
    await act(async () => {
      firstResult?.click();
    });
    await flushReactWork();

    expect(fetchInspirationScoreBreakdown).toHaveBeenCalledWith("insp-1");
    const detail = container.querySelector<HTMLElement>(".detail-view");
    expect(detail?.textContent).toContain("WOW score breakdown");
    expect(detail?.textContent).toContain("WOW 12");
    expect(detail?.textContent).toContain("Displayed WOW");
    expect(detail?.textContent).toContain("Stored/core WOW");
    expect(detail?.textContent).toContain("Freshness adjustment");
    expect(detail?.textContent).toContain("Content/text/context");
    expect(detail?.textContent).toContain("Processing/reflection");
    expect(detail?.textContent).toContain("Revisit");
    expect(detail?.textContent).toContain(
      "1 unique day · 1 total revisit · 1 recent revisit",
    );
    expect(detail?.textContent).toContain(
      "signals: 33 unique-day, 20 total-revisit, 100 recent",
    );
    expect(detail?.textContent).not.toContain("33 unique days");
    expect(detail?.textContent).toContain("Relationship");
    expect(detail?.textContent).toContain("viewing this panel does not run provider calls or generate embeddings");
    expect(detail?.textContent).toContain("No stored embedding");
  });

  it("opens saved inspirations as editable details without a static preview and saves edits", async () => {
    setApiFixtures();
    vi.mocked(updateInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-1",
        text: "Edited bridge rhythm note for the next walk",
        wowScore: 6,
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-15T12:00:00.000Z",
      }),
    );

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const firstResult = container.querySelector<HTMLButtonElement>(
      ".inspiration-result-card",
    );
    expect(firstResult).not.toBeNull();
    await act(async () => {
      firstResult?.click();
    });
    await flushReactWork();

    const detail = container.querySelector<HTMLElement>(".detail-view");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("Inspiration details");
    expect(detail?.querySelector(".detail-text")).toBeNull();
    expect(detail?.querySelector(".detail-links")).toBeNull();
    expect(detail?.querySelector(".detail-attachments")).toBeNull();
    expect(detail?.querySelector(".detail-meta")).toBeNull();
    const detailsTextarea = detail?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Inspiration details"]',
    );
    expect(detailsTextarea?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
    expect(
      detail?.querySelector<HTMLButtonElement>(
        'button[aria-label="Process this inspiration with a reflection"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      setInputValue(detailsTextarea!, "Edited bridge rhythm note for the next walk");
    });
    const saveButton = Array.from(
      detail?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "Save details");
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      saveButton?.click();
    });
    await flushReactWork();

    expect(updateInspiration).toHaveBeenCalledWith("insp-1", {
      text: "Edited bridge rhythm note for the next walk",
    });
    expect(detailsTextarea?.value).toBe("Edited bridge rhythm note for the next walk");
    expect(getInspirationResultTexts(container)[0]).toContain(
      "Edited bridge rhythm note for the next walk",
    );
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".inspiration-result-meta")).some(
        (node) => node.textContent?.includes("WOW 6"),
      ),
    ).toBe(true);
  });

  it("adds a later reflection from an existing inspiration detail without refreshing", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([
      persistedReflection({
        id: "reflection-existing",
        answer: "This already helped once.",
      }),
    ]);
    vi.mocked(createReflection).mockResolvedValue({
      reflection: persistedReflection({
        id: "reflection-later",
        answer: "It turns a quick save into something I can use.",
      }),
      inspiration: {
        id: "insp-1",
        importanceScore: 9,
        wowScore: 10,
      },
    });

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const firstResult = container.querySelector<HTMLButtonElement>(
      ".inspiration-result-card",
    );
    expect(firstResult).not.toBeNull();
    await act(async () => {
      firstResult?.click();
    });
    await flushReactWork();

    expect(fetchReflections).toHaveBeenCalledWith("insp-1");
    expect(container.textContent).toContain("This already helped once.");

    const processButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Process this inspiration with a reflection"]',
    );
    expect(processButton).not.toBeNull();
    await act(async () => {
      processButton?.click();
    });
    await flushReactWork();

    const detailAnswer = container.querySelector<HTMLTextAreaElement>(
      '.detail-view .reflect-area textarea[placeholder^="Sit with it"]',
    );
    expect(detailAnswer).not.toBeNull();
    await act(async () => {
      setInputValue(detailAnswer!, "It turns a quick save into something I can use.");
    });

    const saveReflectionButton = container.querySelector<HTMLButtonElement>(
      '.detail-view .reflect-area button[aria-label="Save reflection"]',
    );
    await act(async () => {
      saveReflectionButton?.click();
    });
    await flushReactWork();

    expect(createReflection).toHaveBeenCalledTimes(1);
    expect(createReflection).toHaveBeenCalledWith("insp-1", {
      question: "What about this is worth remembering?",
      answer: "It turns a quick save into something I can use.",
    });
    expect(container.textContent).toContain("This already helped once.");
    expect(container.textContent).toContain(
      "It turns a quick save into something I can use.",
    );
    expect(container.textContent).toContain("Hide reflection · 2 notes");
    expect(container.querySelector(".history-list")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#detailBack")?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".history-item-reflections")?.textContent).toContain(
      "2 of 2 reflected",
    );
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".inspiration-result-meta")).some(
        (node) => node.textContent?.includes("WOW 10"),
      ),
    ).toBe(true);
  });

  it("keeps the detail reflection entry point hidden until existing reflections are ready", async () => {
    setApiFixtures();
    let resolveFetchReflections: (rows: ApiReflection[]) => void = () => undefined;
    const fetchReflectionsPromise = new Promise<ApiReflection[]>((resolve) => {
      resolveFetchReflections = resolve;
    });
    vi.mocked(fetchReflections).mockReturnValue(fetchReflectionsPromise);

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const firstResult = container.querySelector<HTMLButtonElement>(
      ".inspiration-result-card",
    );
    await act(async () => {
      firstResult?.click();
    });
    await flushReactWork();

    expect(container.textContent).toContain("Loading reflections…");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Process this inspiration with a reflection"]',
      ),
    ).toBeNull();

    await act(async () => {
      resolveFetchReflections([
        persistedReflection({
          id: "reflection-existing",
          answer: "Ready reflections can be extended safely.",
        }),
      ]);
      await fetchReflectionsPromise;
    });
    await flushReactWork();

    expect(container.textContent).toContain("Ready reflections can be extended safely.");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Process this inspiration with a reflection"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector(".history-list")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#detailBack")?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".history-item-reflections")?.textContent).toContain(
      "1 of 1 reflected",
    );
  });

  it("does not post an empty later reflection from the inspiration detail", async () => {
    setApiFixtures();

    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const firstResult = container.querySelector<HTMLButtonElement>(
      ".inspiration-result-card",
    );
    await act(async () => {
      firstResult?.click();
    });
    await flushReactWork();

    const processButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Process this inspiration with a reflection"]',
    );
    await act(async () => {
      processButton?.click();
    });
    await flushReactWork();

    const saveReflectionButton = container.querySelector<HTMLButtonElement>(
      '.detail-view .reflect-area button[aria-label="Save reflection"]',
    );
    await act(async () => {
      saveReflectionButton?.click();
    });
    await flushReactWork();

    expect(createReflection).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Add a thought before saving this reflection.",
    );
    expect(container.querySelector(".detail-view .reflect-area")).not.toBeNull();
  });

  it("keeps optimistic Inspiration First saves simple, then shows returned WOW score after persistence", async () => {
    setApiFixtures({ inspirations: [] });
    let resolveCreate: (value: ApiInspiration) => void = () => undefined;
    const createPromise = new Promise<ApiInspiration>((resolve) => {
      resolveCreate = resolve;
    });
    vi.mocked(createInspiration).mockReturnValue(createPromise);

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    await saveInspirationFromCapture(
      container,
      "Fresh note with a server-scored surprise",
    );

    const optimisticMeta = Array.from(
      container.querySelectorAll<HTMLElement>(".inspiration-result-meta"),
    ).map((node) => node.textContent ?? "");
    expect(optimisticMeta).toHaveLength(1);
    expect(optimisticMeta[0]).toContain("saving");
    expect(optimisticMeta[0]).not.toContain("WOW");

    await act(async () => {
      resolveCreate(
        persistedInspiration({
          id: "insp-wow-after-save",
          text: "Fresh note with a server-scored surprise",
          wowScore: 8,
        }),
      );
      await createPromise;
    });
    await flushReactWork();

    const persistedMeta = Array.from(
      container.querySelectorAll<HTMLElement>(".inspiration-result-meta"),
    ).map((node) => node.textContent ?? "");
    expect(persistedMeta).toHaveLength(1);
    expect(persistedMeta[0]).toContain("saved");
    expect(persistedMeta[0]).toContain("WOW 8");
    expect(persistedMeta[0]).not.toMatch(/\b(NOTE|QUOTE|IMAGE|BRIDGE|TENSION)\b/);
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

    const detail = container.querySelector<HTMLElement>(".detail-view.visible");
    expect(detail?.textContent).toContain("Inspiration details");
    expect(
      detail?.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Inspiration details"]',
      )?.value,
    ).toBe("Architecture essay about bridge rhythms in city walks");
    expect(detail?.querySelector(".detail-text")).toBeNull();
    expect(detail?.querySelector(".detail-links")).toBeNull();
    expect(detail?.querySelector(".detail-attachments")).toBeNull();
    expect(detail?.querySelector(".detail-meta")).toBeNull();
    expect(historyPanel?.querySelector(".history-list")).toBeNull();
    expect(historyPanel?.querySelector(".history-item")).toBeNull();
    expect(vi.mocked(fetchReflections)).toHaveBeenCalledWith("insp-1");

    await act(async () => {
      detail?.querySelector<HTMLButtonElement>("#detailBack")?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".detail-view.visible")).toBeNull();
    expect(historyPanel?.querySelectorAll(".history-item")).toHaveLength(3);
    expect(
      Array.from(historyPanel?.querySelectorAll<HTMLElement>(".history-item") ?? []).some(
        (card) => card.textContent?.includes("Architecture essay about bridge rhythms"),
      ),
    ).toBe(true);
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

  it("Escape shrinks expanded Inspiration First capture without discarding draft or attachments", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await switchToInspirationFirst(container);

    const textarea = container.querySelector<HTMLTextAreaElement>("#capNote");
    const fileInput = container.querySelector<HTMLInputElement>("#capFile");
    const expandButton = container.querySelector<HTMLButtonElement>("#capExpand");
    expect(textarea).not.toBeNull();
    expect(fileInput).not.toBeNull();
    expect(expandButton).not.toBeNull();

    await act(async () => {
      setInputValue(textarea!, "Draft that must survive Escape");
      const file = new File(["notes"], "notes.txt", { type: "text/plain" });
      Object.defineProperty(fileInput!, "files", {
        value: [file],
        configurable: true,
      });
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReactWork();

    await act(async () => {
      expandButton?.click();
    });
    await flushReactWork();

    const focusedCaptureCell = container.querySelector<HTMLElement>("#capture");
    expect(focusedCaptureCell?.classList.contains("focused")).toBe(true);
    expect(container.querySelector("#capStrip")?.textContent).toContain("notes.txt");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushReactWork();

    const shrunkCaptureCell = container.querySelector<HTMLElement>("#capture");
    expect(shrunkCaptureCell?.classList.contains("focused")).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "Draft that must survive Escape",
    );
    expect(container.querySelector("#capStrip")?.textContent).toContain("notes.txt");
    expect(container.querySelector<HTMLButtonElement>("#capSave")?.disabled).toBe(false);
    expect(createInspiration).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushReactWork();

    const stillSmallCaptureCell = container.querySelector<HTMLElement>("#capture");
    expect(stillSmallCaptureCell?.classList.contains("focused")).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "Draft that must survive Escape",
    );
    expect(container.querySelector("#capStrip")?.textContent).toContain("notes.txt");
    expect(createInspiration).not.toHaveBeenCalled();
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
    expect(html).not.toContain("WOW STATUS");
    expect(html).toContain("aria-pressed=\"true\">Inspiration First</button>");
  });

  it("can render the dev-only WOW STATUS switcher tab", () => {
    const html = renderToStaticMarkup(
      createElement(HomeViewToggle, {
        activeView: "wow-status",
        onChange: () => undefined,
        showInternalStatusTab: true,
      }),
    );

    expect(html).toContain("data-active-view=\"wow-status\"");
    expect(html).toContain("WOW STATUS");
    expect(html).toContain("aria-pressed=\"true\">WOW STATUS</button>");
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

  it("gates the internal WOW status affordance to dev/demo environments", async () => {
    expect(
      shouldShowInternalStatus({ DEV: false, VITE_SHOW_INTERNAL_STATUS: undefined }),
    ).toBe(false);
    expect(
      shouldShowInternalStatus({ DEV: false, VITE_SHOW_INTERNAL_STATUS: "false" }),
    ).toBe(false);
    expect(
      shouldShowInternalStatus({ DEV: false, VITE_SHOW_INTERNAL_STATUS: "TRUE" }),
    ).toBe(false);
    expect(
      shouldShowInternalStatus({ DEV: false, VITE_SHOW_INTERNAL_STATUS: "true" }),
    ).toBe(true);
    expect(
      shouldShowInternalStatus({ DEV: true, VITE_SHOW_INTERNAL_STATUS: undefined }),
    ).toBe(true);
  });

  it("renders the development WOW status table from the status endpoint on a dev-only tab", async () => {
    vi.stubEnv("VITE_SHOW_INTERNAL_STATUS", "true");
    setApiFixtures();

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    expect(container.querySelector(".internal-wow-status-table")).toBeNull();
    expect(container.querySelector(".inspiration-discovery-panel")).not.toBeNull();

    await switchToWowStatus(container);
    await flushReactWork();

    expect(
      container.querySelector<HTMLElement>(".home-view-switcher")?.dataset
        .activeView,
    ).toBe("wow-status");
    expect(container.textContent).toContain("Temporary development surface");
    expect(container.textContent).toContain("will be removed before the product experience is finalized");
    expect(container.textContent).toContain("Saved");
    expect(container.textContent).toContain("When the inspiration was stored");
    expect(container.textContent).toContain("Inspiration");
    expect(container.textContent).toContain("saved inspiration id and text preview");
    expect(container.textContent).toContain("Job");
    expect(container.textContent).toContain("background classification/processing job");
    expect(container.textContent).toContain("Embedded");
    expect(container.textContent).toContain("retrieval embedding");
    expect(container.textContent).toContain("Cluster");
    expect(container.textContent).toContain("internal pattern bucket");
    expect(container.textContent).toContain("Scores");
    expect(container.textContent).toContain("importance and WOW scores");
    expect(container.textContent).toContain("WOW links");
    expect(container.textContent).toContain("linked back to that inspiration");

    const table = container.querySelector<HTMLElement>(
      '.internal-wow-status-table[aria-label="Development WOW status table"]',
    );
    expect(table).not.toBeNull();
    expect(fetchWowStatus).toHaveBeenCalledWith(12);
    expect(table?.textContent).toContain("Development WOW status");
    expect(table?.textContent).toContain("insp-1");
    expect(table?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(table?.textContent).toContain("succeeded");
    expect(table?.textContent).toContain("1/3");
    expect(table?.textContent).toContain("yes");
    expect(table?.textContent).toContain("bridge");
    expect(table?.textContent).toContain("importance 7");
    expect(table?.textContent).toContain("wow 4");
    expect(table?.textContent).toContain("Cities keep teaching through bridges");
  });

  it("does not render the internal WOW status UI when the dev/demo gate is disabled", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SHOW_INTERNAL_STATUS", "false");
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-gated-off" }),
    );

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    await saveInspirationFromCapture(container, "Gated-off internal status save");

    expect(container.querySelector(".internal-wow-status")).toBeNull();
    expect(fetchBackgroundJobs).not.toHaveBeenCalled();
  });

  it("shows an internal demo-only pipeline status after a successful save and poll path", async () => {
    vi.useFakeTimers();
    setApiFixtures();
    vi.mocked(fetchBackgroundJobs).mockResolvedValue(sampleBackgroundJobs);
    vi.mocked(createInspiration).mockResolvedValue(persistedInspiration());
    vi.mocked(fetchInspirations)
      .mockResolvedValueOnce(sampleInspirations)
      .mockResolvedValueOnce([
        persistedInspiration({ cluster: "bridge", classifiedAt: "2026-05-14T16:30:03.000Z" }),
        ...sampleInspirations,
      ]);
    vi.mocked(fetchWowMoments)
      .mockResolvedValueOnce(sampleWowMoments)
      .mockResolvedValueOnce(sampleWowMoments)
      .mockResolvedValueOnce([
        {
          ...sampleWowMoments[0],
          id: "wow-3",
          title: "Library rituals keep becoming prompts",
          createdAt: "2026-05-14T16:30:04.000Z",
        },
        ...sampleWowMoments,
      ]);

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    await saveInspirationFromCapture(
      container,
      "New demo inspiration about recurring library rituals",
    );

    expect(container.querySelector(".internal-wow-status")).toBeNull();

    await switchToWowStatus(container);

    const panel = container.querySelector<HTMLElement>(".internal-wow-status");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Internal/demo-only WOW pipeline status");
    expect(panel?.textContent).toContain("Saved inspiration insp-new");
    expect(panel?.textContent).toContain("Saved inspiration");
    expect(panel?.textContent).toContain("Background classification job running");
    expect(panel?.textContent).toContain("WOW refresh checking");
    expect(panel?.textContent).toContain("Latest WOW count 2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await flushReactWork();

    expect(panel?.textContent).toContain("New WOW moment found");
    expect(panel?.textContent).toContain("Latest WOW count 3");
    expect(fetchBackgroundJobs).toHaveBeenCalledWith({
      type: "process_inspiration",
      limit: 10,
    });
  });

  it("degrades gracefully when admin background-job details are unavailable", async () => {
    setApiFixtures();
    vi.mocked(fetchBackgroundJobs).mockRejectedValue(
      new Error("Failed to load background jobs (HTTP 403)."),
    );
    vi.mocked(createInspiration).mockResolvedValue(persistedInspiration());

    const container = await renderHomePage();
    await switchToInspirationFirst(container);
    await saveInspirationFromCapture(
      container,
      "Demo save with admin endpoint unavailable",
    );

    expect(container.querySelector(".internal-wow-status")).toBeNull();

    await switchToWowStatus(container);

    const panel = container.querySelector<HTMLElement>(".internal-wow-status");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain(
      "Admin job details unavailable; WOW refresh still polling.",
    );
    expect(panel?.textContent).toContain("WOW refresh checking");
  });
});
