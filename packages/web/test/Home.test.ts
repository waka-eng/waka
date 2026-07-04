// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFeedback,
  createInspiration,
  createReflection,
  deleteInspiration,
  finalizeAttachment,
  fetchInspirations,
  fetchReflections,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  generateGuidedReflectionQuestion,
  presignAttachment,
  recordInspirationRevisit,
  updateInspiration,
  updateTopOfMindNote,
  uploadToPresignedUrl,
} from "../src/lib/api";
import type {
  ApiAttachment,
  ApiInspiration,
  ApiReflection,
  ApiSavedSignalDetail,
  ApiSavedSignalSearchResult,
  ApiTopOfMind,
  ApiTopOfMindNoteSurface,
} from "../src/lib/api";
import { HomePage, getMemoryPreviewPlacement } from "../src/pages/Home";

const mockAuthState = vi.hoisted(() => ({
  value: {
    user: {
      id: "user-1",
      email: "river@example.com",
      name: "River",
      preferredLocale: "en-US" as "en-US" | "ko-KR",
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => null),
    updatePreferredLocale: vi.fn(async () => ({
      id: "user-1",
      email: "river@example.com",
      name: "River",
      preferredLocale: "en-US" as "en-US" | "ko-KR",
    })),
  },
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => mockAuthState.value,
  useOptionalAuth: () => mockAuthState.value,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchInspirations: vi.fn(async () => []),
    fetchTopOfMind: vi.fn(async () => sampleTopOfMind),
    fetchTopOfMindNotes: vi.fn(async () => [sampleTopOfMindNote]),
    createFeedback: vi.fn(async () => ({
      id: "feedback-1",
      userId: "user-1",
      targetType: "top_of_mind_note",
      targetId: "note-1",
      value: "true",
      emotionLabel: null,
      correctionText: null,
      source: "user",
      metadata: {},
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    })),
    fetchReflections: vi.fn(async () => []),
    fetchSavedSignals: vi.fn(async () => sampleSavedSignals),
    fetchSavedSignalDetail: vi.fn(async () => sampleSavedSignalDetail),
    fetchInspirationScoreBreakdown: vi.fn(async () => null),
    createInspiration: vi.fn(async () => {
      throw new Error("createInspiration mock not configured");
    }),
    finalizeAttachment: vi.fn(async () => {
      throw new Error("finalizeAttachment mock not configured");
    }),
    presignAttachment: vi.fn(async () => {
      throw new Error("presignAttachment mock not configured");
    }),
    uploadToPresignedUrl: vi.fn(async () => undefined),
    createReflection: vi.fn(async () => {
      throw new Error("createReflection mock not configured");
    }),
    generateGuidedReflectionQuestion: vi.fn(async () => ({
      question: "What does this signal want you to notice next?",
      source: "fallback",
    })),
    updateInspiration: vi.fn(async () => {
      throw new Error("updateInspiration mock not configured");
    }),
    updateTopOfMindNote: vi.fn(async (noteId: string, input: { title: string }) => ({
      ...sampleTopOfMindNote,
      id: noteId,
      title: input.title,
      ambientSignal: input.title,
    })),
    deleteInspiration: vi.fn(async () => undefined),
    recordInspirationRevisit: vi.fn(async () => ({
      revisit: {
        id: "revisit-1",
        eventType: "detail_opened",
        createdAt: "2026-05-14T16:32:00.000Z",
      },
      inspiration: null,
    })),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    id: "insp-other-user",
    userId: "user-2",
    text: "Other user save should never render",
    kind: "note",
    category: null,
    importanceScore: 1,
    wowScore: 1,
    cluster: null,
    classifiedAt: null,
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:00.000Z",
  },
];

const sampleSavedSignals: ApiSavedSignalSearchResult[] = [
  {
    id: "insp-1",
    userId: "user-1",
    textPreview: "Architecture essay about bridge rhythms in city walks",
    kind: "note",
    capturedAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    resonanceScore: 7,
    signalScores: {
      resonance: 7,
      recurrence: 6,
      agency: 5,
      identitySignal: 7,
      decisionRelevance: 4,
    },
    highlightedSnippets: [
      {
        id: "spark-1",
        text: "bridge rhythms in city walks",
        source: "user",
        confidence: 0.96,
        isPrimary: true,
      },
    ],
    matchingSnippets: ["bridge rhythms"],
    relatedContextTerms: ["places that make movement visible"],
    relatedTopOfMindNoteTitles: ["make the thing before explaining it"],
    attachmentSummary: [],
    relevanceReasons: ["highlighted"],
  },
  {
    id: "insp-2",
    userId: "user-1",
    textPreview: "Synthetic memory note for rereading old journals",
    kind: "quote",
    capturedAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-09T12:00:00.000Z",
    resonanceScore: 8,
    signalScores: {
      resonance: 8,
      recurrence: 3,
      agency: 2,
      identitySignal: 6,
      decisionRelevance: 3,
    },
    highlightedSnippets: [],
    matchingSnippets: [],
    relatedContextTerms: ["memory as a working material"],
    relatedTopOfMindNoteTitles: [],
    attachmentSummary: [],
    relevanceReasons: [],
  },
];

const sampleSavedSignalDetail: ApiSavedSignalDetail = {
  ...sampleSavedSignals[0],
  rawText: "Architecture essay about bridge rhythms in city walks",
  attachments: [],
  resonanceFeedback: [],
  signalPacket: {
    id: "packet-1",
    text: "waka.signal_packet:v1\nREAD: This signal suggests work that turns movement, place, and public rhythm into visible form.",
    primarySpark: "bridge rhythms in city walks",
    artifactExcerpt: "Architecture essay about bridge rhythms in city walks",
    updatedAt: "2026-05-10T12:05:00.000Z",
  },
  relatedContextNodes: [
    {
      id: "ctx-1",
      type: "environment",
      label: "places that make movement visible",
      description: "The user keeps saving signals about environments with readable rhythm.",
      confidence: 0.8,
      evidenceReason: "Supported by architecture and walking signals.",
    },
  ],
  relatedTopOfMindNotes: [
    {
      id: "note-1",
      title: "make the thing before explaining it",
      type: "pattern",
      body: "The signal keeps pointing toward environments where movement becomes a public artifact.",
      confidence: 0.82,
      status: "active",
    },
  ],
};

const sampleTopOfMindNote: ApiTopOfMindNoteSurface = {
  id: "note-1",
  userId: "user-1",
  title: "make the thing before explaining it",
  ambitionDimension: "work",
  ambientSignal: "make the thing before explaining it",
  matchedEnvironment: "A working culture where bridge rhythms become visible through repeated making.",
  antiEnvironment: "Work contexts that reward commentary while the real object stays abstract.",
  evidenceRationale: "Several saved signals cluster around city walks, architecture, and jazz history.",
  rejectedAlternativeInterpretation: "This is not just an archive theme about bridges or city walking.",
  type: "pattern",
  body: "Several saved signals connect architecture essays with walking routes and jazz history.",
  prompt: "What bridge keeps reappearing?",
  guidance: "Name what it connects, then choose one next crossing.",
  confidence: 0.82,
  status: "active",
  relatedSignalIds: ["insp-1"],
  relatedContextNodeIds: ["theme-1"],
  createdAt: "2026-05-11T12:00:00.000Z",
  updatedAt: "2026-05-11T12:00:00.000Z",
  source: "wow_moment_compatibility",
  isProvisional: true,
  legacy: {
    wowMomentId: "wow-1",
    wowKind: "bridge",
    wowScore: 9,
  },
  evidencePreviews: [
    {
      signalId: "insp-1",
      role: "anchor",
      reason: "This signal anchors the pattern.",
      textPreview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      createdAt: "2026-05-10T12:00:00.000Z",
      resonanceScore: 4,
    },
  ],
  relatedSignals: [
    {
      id: "insp-1",
      preview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      createdAt: "2026-05-10T12:00:00.000Z",
      resonanceScore: 4,
    },
  ],
};

const sampleTopOfMind: ApiTopOfMind = {
  generatedAt: "2026-05-12T12:00:00.000Z",
  headline: "make the thing before explaining it",
  activeThemes: [
    {
      nodeId: "theme-1",
      label: "rooms where people can be honest before they are impressive",
      type: "theme",
      reason: "A theme from saved architecture and collaboration notes.",
      evidenceCount: 2,
      lastReinforcedAt: "2026-05-12T12:00:00.000Z",
      supportingInspirations: [
        {
          id: "insp-1",
          preview: "Architecture essay about bridge rhythms in city walks",
          reason: "It names the pattern.",
          createdAt: "2026-05-10T12:00:00.000Z",
        },
      ],
    },
  ],
  activeQuestions: [],
  relationshipSignals: [],
  summary: {
    inspirationCount: 2,
    meaningNoteCount: 1,
    relationshipEdgeCount: 0,
  },
};

function setApiFixtures({
  inspirations = sampleInspirations,
  topOfMind = sampleTopOfMind,
  topOfMindNotes = [sampleTopOfMindNote],
  savedSignals = sampleSavedSignals,
  savedSignalDetail = sampleSavedSignalDetail,
}: {
  inspirations?: ApiInspiration[];
  topOfMind?: ApiTopOfMind;
  topOfMindNotes?: ApiTopOfMindNoteSurface[];
  savedSignals?: ApiSavedSignalSearchResult[];
  savedSignalDetail?: ApiSavedSignalDetail;
} = {}): void {
  vi.mocked(fetchInspirations).mockResolvedValue(inspirations);
  vi.mocked(fetchTopOfMind).mockResolvedValue(topOfMind);
  vi.mocked(fetchTopOfMindNotes).mockResolvedValue(topOfMindNotes);
  vi.mocked(fetchReflections).mockResolvedValue([]);
  vi.mocked(fetchSavedSignals).mockResolvedValue(savedSignals);
  vi.mocked(fetchSavedSignalDetail).mockImplementation(async (id: string) => {
    const fallback = savedSignals.find((signal) => signal.id === id) ?? savedSignals[0] ?? sampleSavedSignals[0];
    if (id === savedSignalDetail.id || fallback.textPreview.includes("Architecture essay")) {
      return {
        ...savedSignalDetail,
        id,
        textPreview: fallback.textPreview,
        rawText: fallback.textPreview,
      };
    }
    return {
      ...fallback,
      rawText: fallback.textPreview,
      attachments: [],
      resonanceFeedback: [],
      signalPacket: null,
      relatedContextNodes: [],
      relatedTopOfMindNotes: [],
    };
  });
  vi.mocked(recordInspirationRevisit).mockResolvedValue({
    revisit: {
      id: "revisit-1",
      eventType: "detail_opened",
      createdAt: "2026-05-14T16:32:00.000Z",
    },
    inspiration: null,
  });
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
  mockAuthState.value.user.email = "river@example.com";
  mockAuthState.value.user.name = "River";
  mockAuthState.value.user.preferredLocale = "en-US";
  if (typeof window.localStorage.clear === "function") {
    window.localStorage.clear();
  }
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
    root.render(createElement(MemoryRouter, null, createElement(HomePage)));
  });
  await flushReactWork();
  await flushReactWork();

  return container;
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitForTimers(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
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

async function openCaptureModal(container: HTMLElement): Promise<void> {
  const captureButton = container.querySelector<HTMLButtonElement>(".nc-save");
  expect(captureButton).not.toBeNull();
  await act(async () => {
    captureButton?.click();
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

function persistedAttachment(overrides: Partial<ApiAttachment> = {}): ApiAttachment {
  return {
    id: "att-new-1234567890",
    inspirationId: "insp-new-1234567890",
    type: "link",
    url: "https://example.com/article",
    name: "example.com/article",
    s3Key: null,
    contentType: null,
    size: null,
    createdAt: "2026-05-14T16:30:01.000Z",
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

describe("memory preview placement", () => {
  const anchor = {
    top: 240,
    right: 240,
    bottom: 280,
    left: 160,
    width: 80,
    height: 40,
  };
  const preview = { width: 320, height: 190 };

  it("clamps the hover card inside the left viewport edge", () => {
    const placement = getMemoryPreviewPlacement(
      { ...anchor, left: 8, right: 88 },
      { width: 960, height: 720 },
      preview,
    );

    const left = Number.parseInt(placement.left, 10) - preview.width / 2 + 8;
    expect(left).toBeGreaterThanOrEqual(12);
    expect(placement.side).toBe("below");
  });

  it("clamps the hover card inside the right viewport edge", () => {
    const placement = getMemoryPreviewPlacement(
      { ...anchor, left: 900, right: 980 },
      { width: 960, height: 720 },
      preview,
    );

    const viewportLeft = 900 + Number.parseInt(placement.left, 10) - preview.width / 2;
    expect(viewportLeft + preview.width).toBeLessThanOrEqual(948);
    expect(placement.originX).not.toBe("160px");
  });

  it("flips above when the anchor is near the bottom edge", () => {
    const placement = getMemoryPreviewPlacement(
      { ...anchor, top: 650, bottom: 690 },
      { width: 960, height: 720 },
      preview,
    );

    expect(placement.side).toBe("above");
    expect(placement.originY).toBe("bottom");
    expect(Number.parseInt(placement.top, 10)).toBeLessThan(0);
  });

  it("keeps the hover card below when flipping would cross the top edge", () => {
    const placement = getMemoryPreviewPlacement(
      { ...anchor, top: 8, bottom: 48 },
      { width: 960, height: 720 },
      preview,
    );

    expect(placement.side).toBe("below");
    expect(Number.parseInt(placement.top, 10)).toBeGreaterThan(0);
  });
});


describe("HomePage current home experience", () => {
  async function clickSavesTab(container: HTMLElement, count = 2): Promise<void> {
    const drawerObject = container.querySelector<HTMLButtonElement>(".nc-drawer-object");
    expect(drawerObject?.textContent).toMatch(new RegExp(`${count} saved|영감 ${count}개 저장됨`));
    await act(async () => {
      drawerObject?.click();
    });
    await flushReactWork();
  }

  async function openAllInspirations(container: HTMLElement): Promise<void> {
    const columns = container.querySelector<HTMLElement>(".memory-category-panel");
    expect(columns).not.toBeNull();
    await flushReactWork();
  }

  async function openBridgeDetail(container: HTMLElement): Promise<HTMLElement> {
    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    const search = container.querySelector<HTMLInputElement>('.nc-drawer-search input[type="search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      setInputValue(search!, "bridge");
    });
    const bridgeSave = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(bridgeSave).not.toBeNull();
    expect(bridgeSave?.textContent).toContain("Architecture essay about bridge rhythms");
    await act(async () => {
      bridgeSave?.click();
    });
    await flushReactWork();
    await flushReactWork();
    const detail = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(detail).not.toBeNull();
    return detail!;
  }

  it("shows saved-inspiration feedback affordances directly after expanded detail", async () => {
    setApiFixtures();

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(detail.textContent).not.toContain("reflect on this inspiration");
    expect(detail.textContent).not.toContain("What did this mean then?");
    expect(detail.textContent).not.toContain("What does it mean now?");
    expect(detail.textContent).not.toContain("Is this still me?");
    expect(detail.textContent).toContain("still alive");
    expect(detail.textContent).toContain("changed shape");
    expect(detail.textContent).toContain("not anymore");
  });

  it("opens a saved inspiration with original content without interpretation or evidence sections", async () => {
    setApiFixtures();

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(container.querySelector(".nc-canvas")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".nc-canvas")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".nc-profile-link")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".memory-drawer-stack")?.getAttribute("role")).toBe("dialog");
    expect(container.querySelector<HTMLInputElement>('.nc-drawer-search input[type="search"]')).not.toBeNull();

    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="edit saved inspiration"]')?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
    expect(detail.textContent).not.toContain("WAKA interpretation");
    expect(detail.textContent).not.toContain(
      "READ: This inspiration suggests work that turns movement, place, and public rhythm into visible form.",
    );
    expect(detail.textContent).not.toContain("Primary spark: bridge rhythms in city walks");
    expect(detail.textContent).not.toContain("Evidence and context");
    expect(detail.textContent).not.toContain("places that make movement visible");
    expect(detail.textContent).not.toContain("The user keeps saving signals about environments with readable rhythm.");
    expect(detail.textContent).not.toContain("Supported by architecture and walking signals.");
    expect(detail.textContent).not.toContain("Helped shape “make the thing before explaining it”");
    expect(detail.textContent).not.toContain(
      "The signal keeps pointing toward environments where movement becomes a public artifact.",
    );
    expect(detail.textContent).not.toContain("waka.signal_packet:v1");
    expect(detail.textContent).not.toContain("This signal suggests");
  });

  it("does not show dot-format signal packet debug copy in saved inspiration detail", async () => {
    setApiFixtures({
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        signalPacket: {
          id: "packet-debug",
          text: [
            "waka.signal_packet.v1",
            "WHAT_HIT",
            "primary: Architecture essay about bridge rhythms in city walks (user_written, confidence=100)",
            "WHY_IT_MATTERS",
            "cluster=unclassified",
            "REFLECTIONS",
            "none",
            "CONTEXT_EXCERPT",
            "Architecture essay about bridge rhythms in city walks",
          ].join("\n"),
          primarySpark: "Architecture essay about bridge rhythms in city walks",
          artifactExcerpt: "Architecture essay about bridge rhythms in city walks",
          updatedAt: "2026-05-10T12:05:00.000Z",
        },
      },
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="edit saved inspiration"]')?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
    expect(detail.textContent).not.toContain("WAKA interpretation");
    expect(detail.textContent).not.toContain("Primary spark: Architecture essay about bridge rhythms in city walks");
    expect(detail.textContent).not.toContain("waka.signal_packet.v1");
    expect(detail.textContent).not.toContain("WHAT_HIT");
    expect(detail.textContent).not.toContain("user_written");
    expect(detail.textContent).not.toContain("cluster=unclassified");
    expect(detail.textContent).not.toContain("REFLECTIONS");
    expect(detail.textContent).not.toContain("CONTEXT_EXCERPT");
  });

  it("does not show not-ready interpretation or evidence copy when saved inspiration detail has no packet or evidence yet", async () => {
    setApiFixtures({
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        signalPacket: null,
        highlightedSnippets: [],
        relatedContextNodes: [],
        relatedTopOfMindNotes: [],
      },
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="edit saved inspiration"]')?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
    expect(detail.textContent).not.toContain("WAKA is still gathering enough context to interpret this inspiration.");
    expect(detail.textContent).not.toContain("Context evidence is still being gathered for this inspiration.");
    expect(detail.textContent).not.toContain("READ:");
    expect(detail.textContent).not.toContain("Helped shape");
  });

  it("asks for an optional saved-inspiration correction before submitting changed shape", async () => {
    setApiFixtures();
    vi.mocked(createFeedback).mockResolvedValueOnce({
      id: "feedback-signal-1",
      userId: "user-1",
      targetType: "signal",
      targetId: "insp-1",
      value: "partly",
      emotionLabel: null,
      correctionText: "more about daily walks now",
      source: "user",
      metadata: {},
      createdAt: "2026-05-14T16:40:00.000Z",
      updatedAt: "2026-05-14T16:40:00.000Z",
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const changedShape = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("changed shape"),
    );
    expect(changedShape).not.toBeNull();

    await act(async () => {
      changedShape?.click();
    });
    await flushReactWork();

    expect(createFeedback).not.toHaveBeenCalled();
    expect(detail.textContent).toContain("what changed?");
    const correction = detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="what changed?"]');
    expect(correction?.placeholder).toBe("optional — how does it feel different now?");
    expect(correction).not.toBeNull();
    await act(async () => {
      setInputValue(correction!, "  more about daily walks now  ");
    });
    const save = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "save",
    );
    expect(save).not.toBeNull();
    await act(async () => {
      save?.click();
    });
    await flushReactWork();

    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "signal",
      targetId: "insp-1",
      value: "partly",
      correctionText: "more about daily walks now",
    });
    expect(changedShape?.getAttribute("aria-pressed")).toBe("true");
  });

  it("skips blank saved-inspiration correction text and lets still alive submit immediately", async () => {
    setApiFixtures();
    vi.mocked(createFeedback).mockResolvedValueOnce({
      id: "feedback-signal-blank",
      userId: "user-1",
      targetType: "signal",
      targetId: "insp-1",
      value: "not_true",
      emotionLabel: null,
      correctionText: null,
      source: "user",
      metadata: {},
      createdAt: "2026-05-14T16:40:00.000Z",
      updatedAt: "2026-05-14T16:40:00.000Z",
    });
    vi.mocked(createFeedback).mockResolvedValueOnce({
      id: "feedback-signal-true",
      userId: "user-1",
      targetType: "signal",
      targetId: "insp-1",
      value: "true",
      emotionLabel: null,
      correctionText: null,
      source: "user",
      metadata: {},
      createdAt: "2026-05-14T16:41:00.000Z",
      updatedAt: "2026-05-14T16:41:00.000Z",
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const notAnymore = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("not anymore"),
    );
    await act(async () => {
      notAnymore?.click();
    });
    await flushReactWork();
    const correction = detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="what changed?"]');
    expect(correction).not.toBeNull();
    await act(async () => {
      setInputValue(correction!, "   ");
    });
    const skip = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "skip",
    );
    await act(async () => {
      skip?.click();
    });
    await flushReactWork();

    expect(createFeedback).toHaveBeenNthCalledWith(1, {
      targetType: "signal",
      targetId: "insp-1",
      value: "not_true",
    });

    await act(async () => {
      notAnymore?.click();
    });
    await flushReactWork();
    expect(detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="what changed?"]')).not.toBeNull();
    const stillAlive = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("still alive"),
    );
    await act(async () => {
      stillAlive?.click();
    });
    await flushReactWork();

    expect(detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="what changed?"]')).toBeNull();
    expect(createFeedback).toHaveBeenNthCalledWith(2, {
      targetType: "signal",
      targetId: "insp-1",
      value: "true",
    });
  });

  it("shows persisted saved-inspiration feedback with Korean button copy", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures({
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        resonanceFeedback: [
          {
            id: "feedback-existing-1",
            value: "not_true",
            emotionLabel: null,
            correctionText: null,
            createdAt: "2026-05-14T16:39:00.000Z",
          },
        ],
      },
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const notAnymore = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("더는 아님"),
    );

    expect(detail.textContent).not.toContain("이 영감 돌아보기");
    expect(detail.textContent).not.toContain("그때 이 영감은 어떤 의미였나요?");
    expect(detail.textContent).not.toContain("지금은 어떻게 다가오나요?");
    expect(detail.textContent).not.toContain("아직 나다운가요?");
    expect(notAnymore).not.toBeNull();
    expect(notAnymore?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      notAnymore?.click();
    });
    await flushReactWork();
    const correction = detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="무엇이 달라졌나요?"]');
    expect(detail.textContent).toContain("무엇이 달라졌나요?");
    expect(correction?.placeholder).toBe("선택 사항 — 지금은 어떻게 달라졌나요?");
    expect(detail.textContent).toContain("저장");
    expect(detail.textContent).toContain("건너뛰기");
  });

  it("keeps saved-inspiration feedback failures visible without changing the persisted choice", async () => {
    setApiFixtures({
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        resonanceFeedback: [
          {
            id: "feedback-existing",
            value: "true",
            emotionLabel: null,
            correctionText: null,
            createdAt: "2026-05-14T12:00:00.000Z",
          },
        ],
      },
    });
    vi.mocked(createFeedback).mockRejectedValueOnce(new Error("network down"));

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const notAnymore = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("not anymore"),
    );

    await act(async () => {
      notAnymore?.click();
    });
    await flushReactWork();
    const skip = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "skip",
    );
    await act(async () => {
      skip?.click();
    });
    await flushReactWork();

    const stillAlive = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("still alive"),
    );
    expect(stillAlive?.getAttribute("aria-pressed")).toBe("true");
    expect(detail.textContent).toContain("could not save inspiration feedback");
  });

  it("shows an inline saved-inspiration edit failure and keeps the original text primary", async () => {
    setApiFixtures();
    vi.mocked(updateInspiration).mockRejectedValueOnce(new Error("patch failed"));

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const editor = detail.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor");
    expect(editor).not.toBeNull();

    await act(async () => {
      setInputValue(editor!, "Architecture essay about bridge rhythms in city walks revised");
    });
    await flushReactWork();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-save")?.click();
    });
    await flushReactWork();

    expect(updateInspiration).toHaveBeenCalledWith("insp-1", {
      text: "Architecture essay about bridge rhythms in city walks revised",
    });
    expect(detail.textContent).toContain("could not save inspiration edit");
    expect(detail.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor")?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
  });

  it("shows delete failure status and restores the saved inspiration to the drawer", async () => {
    setApiFixtures();
    vi.mocked(deleteInspiration).mockRejectedValueOnce(new Error("delete failed"));

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const deleteSaved = Array.from(detail.querySelectorAll<HTMLButtonElement>(".memory-contents-expanded-actions button")).find(
      (button) => button.textContent?.trim() === "delete",
    );

    await act(async () => {
      deleteSaved?.click();
    });
    await flushReactWork();
    expect(container.textContent).toContain("inspiration deleted. You can undo it.");
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.textContent).toContain("inspiration was deleted · undo");

    await waitForTimers(4300);
    await flushReactWork();

    expect(deleteInspiration).toHaveBeenCalledWith("insp-1");
    expect(container.textContent).toContain("could not delete inspiration. It is back in the drawer.");
    expect(container.textContent).toContain("Architecture essay about bridge rhythms");
  });

  it("shows a restored status when undoing a saved-inspiration delete", async () => {
    setApiFixtures();

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const deleteSaved = Array.from(detail.querySelectorAll<HTMLButtonElement>(".memory-contents-expanded-actions button")).find(
      (button) => button.textContent?.trim() === "delete",
    );

    await act(async () => {
      deleteSaved?.click();
    });
    await flushReactWork();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-save")?.click();
    });
    await flushReactWork();

    expect(deleteInspiration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("inspiration restored");
    expect(container.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor")?.value).toBe(
      "Architecture essay about bridge rhythms in city walks",
    );
  });

  it("shows visible saved-inspiration reflection question and save failures", async () => {
    setApiFixtures();
    vi.mocked(generateGuidedReflectionQuestion).mockRejectedValueOnce(new Error("question failed"));
    vi.mocked(createReflection).mockRejectedValueOnce(new Error("save failed"));

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const reflectButton = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "reflect",
    );
    await act(async () => {
      reflectButton?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-drawer-reflect-question")?.textContent).toContain(
      "What does this make you notice about yourself right now?",
    );
    expect(container.textContent).toContain("Could not find a new question, so this fallback is here.");

    const answer = container.querySelector<HTMLTextAreaElement>(".nc-drawer-reflect textarea");
    await act(async () => {
      setInputValue(answer!, "It still points toward public rhythm.");
    });
    await flushReactWork();
    await flushReactWork();
    await act(async () => {
      container.querySelector<HTMLFormElement>(".nc-drawer-reflect")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushReactWork();

    expect(createReflection).toHaveBeenCalledWith("insp-1", {
      question: "What does this make you notice about yourself right now?",
      answer: "It still points toward public rhythm.",
    });
    expect(container.textContent).toContain("could not save reflection");
  });

  it("keeps the Reflect Deeper analysis section hidden until a reflection exists", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([]);

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(detail.textContent).toContain("reflect");
    expect(detail.textContent).not.toContain("No deeper reflection yet.");
    expect(detail.querySelector('[aria-label="Reflect Deeper analysis"]')).toBeNull();
  });

  it("localizes saved-inspiration expanded drawer actions in Korean", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures();

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const actions = detail.querySelector<HTMLElement>(".memory-contents-expanded-actions");

    expect(actions?.getAttribute("aria-label")).toBe("영감 작업");
    expect(actions?.textContent).toContain("조금 더 생각하기");
    expect(actions?.textContent).toContain("삭제");
    expect(actions?.textContent).not.toContain("reflect");
    expect(actions?.textContent).not.toContain("delete");
  });

  it("localizes active Home drawer and top-of-mind controls in Korean", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    const delayedQuestion = deferred<Awaited<ReturnType<typeof generateGuidedReflectionQuestion>>>();
    vi.mocked(generateGuidedReflectionQuestion).mockReturnValueOnce(delayedQuestion.promise);
    vi.mocked(updateInspiration).mockResolvedValueOnce({
      ...sampleInspirations[0],
      text: "Architecture essay about bridge rhythms in city walks revised",
      updatedAt: "2026-05-14T16:45:00.000Z",
    });
    setApiFixtures();

    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit")?.getAttribute("aria-label")).toBe(
      "포스트잇 수정",
    );
    const pin = note?.querySelector<HTMLButtonElement>(".nc-note-icon-btn--pin");
    const noteDelete = note?.querySelector<HTMLButtonElement>(".nc-note-icon-btn--delete");
    expect(note?.querySelector(".nc-note-preview")?.getAttribute("aria-label")).toBe("포스트잇 미리보기");
    expect(pin?.getAttribute("aria-label")).toBe("고정");
    expect(pin?.getAttribute("title")).toBe("고정");
    expect(noteDelete?.getAttribute("aria-label")).toBe("삭제");
    expect(noteDelete?.getAttribute("title")).toBe("삭제");
    const evidence = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidence?.textContent).toContain("영감 1개가 여기로 이어짐");

    await act(async () => {
      evidence?.click();
    });
    await flushReactWork();

    expect(container.querySelector<HTMLElement>(".memory-path-panel")?.getAttribute("aria-label")).toBe(
      "저장된 영감 목록",
    );
    expect(container.querySelector<HTMLElement>(".memory-path-filters")?.getAttribute("aria-label")).toBe(
      "저장된 영감 경로",
    );
    expect(container.querySelector(".memory-path-filter--active")?.textContent).toContain("탑오브마인드");
    expect(container.querySelector<HTMLInputElement>('.nc-drawer-search input[type="search"]')?.placeholder).toBe(
      "저장된 영감 검색",
    );
    expect(container.querySelector<HTMLElement>(".nc-bottom-bar")?.getAttribute("aria-label")).toBe("하단 작업");
    expect(container.querySelector<HTMLButtonElement>(".nc-drawer-object")?.getAttribute("aria-label")).toBe(
      "방으로 돌아가기",
    );

    const drawerSave = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    await act(async () => {
      drawerSave?.click();
    });
    await flushReactWork();
    await flushReactWork();

    const detail = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(detail).not.toBeNull();
    expect(detail?.querySelector<HTMLButtonElement>(".memory-contents-collapse")?.getAttribute("aria-label")).toBe(
      "영감 접기",
    );
    const editor = detail!.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor");
    expect(editor?.getAttribute("aria-label")).toBe("저장된 영감 수정");
    expect(detail?.querySelector<HTMLElement>(".memory-contents-feedback-actions")?.getAttribute("aria-label")).toBe(
      "영감 피드백",
    );
    expect(
      detail?.querySelector<HTMLButtonElement>(".memory-contents-feedback-action")?.getAttribute("aria-label"),
    ).toBe("영감 피드백: 아직 살아 있음");

    await act(async () => {
      setInputValue(editor!, "Architecture essay about bridge rhythms in city walks cancelled");
    });
    await flushReactWork();
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.getAttribute("aria-label")).toBe(
      "수정한 영감 저장",
    );
    expect(container.querySelector<HTMLButtonElement>(".nc-edit-cancel")?.textContent).toBe("수정 취소");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-edit-cancel")?.click();
    });
    await flushReactWork();
    expect(updateInspiration).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(editor!, "Architecture essay about bridge rhythms in city walks revised");
    });
    await flushReactWork();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-save")?.click();
    });
    await flushReactWork();
    expect(updateInspiration).toHaveBeenCalledWith("insp-1", {
      text: "Architecture essay about bridge rhythms in city walks revised",
    });

    const reflect = Array.from(detail!.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("조금 더 생각하기"),
    );
    await act(async () => {
      reflect?.click();
    });
    await flushReactWork();
    expect(container.querySelector(".nc-drawer-reflect-question")?.textContent).toContain(
      "이 영감을 위한 질문을 찾는 중...",
    );
    const answer = container.querySelector<HTMLTextAreaElement>(".nc-drawer-reflect textarea");
    expect(answer?.getAttribute("aria-label")).toBe("돌아보기 답변");
    expect(answer?.placeholder).toBe("여기에 답하기");
    expect(container.querySelector(".nc-drawer-reflect-actions")?.textContent).toContain("이전");
    expect(container.querySelector(".nc-drawer-reflect-actions")?.textContent).toContain("다음");
    expect(container.querySelector(".nc-drawer-reflect-actions")?.textContent).toContain("저장");
    expect(container.querySelector(".nc-drawer-reflect-actions")?.textContent).toContain("취소");
    await act(async () => {
      delayedQuestion.resolve({ question: "이 영감이 지금 묻는 것은 무엇인가요?", source: "model" });
      await delayedQuestion.promise;
    });
    await flushReactWork();
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-drawer-reflect-actions button"))
        .find((button) => button.textContent?.trim() === "취소")
        ?.click();
    });
    await flushReactWork();

    const deleteSaved = Array.from(detail!.querySelectorAll<HTMLButtonElement>(".memory-contents-expanded-actions button")).find(
      (button) => button.textContent?.trim() === "삭제",
    );
    await act(async () => {
      deleteSaved?.click();
    });
    await flushReactWork();
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.getAttribute("aria-label")).toBe(
      "영감이 삭제됨, 되돌리기",
    );
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.textContent).toContain("영감이 삭제됨 · 되돌리기");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-save")?.click();
    });
    await flushReactWork();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-drawer-object")?.click();
    });
    await flushReactWork();
    await waitForTimers(380);
    await flushReactWork();
    const visibleNoteDelete = container.querySelector<HTMLButtonElement>(".nc-note-icon-btn--delete");
    expect(visibleNoteDelete).not.toBeNull();
    await act(async () => {
      visibleNoteDelete?.click();
    });
    await flushReactWork();
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.getAttribute("aria-label")).toBe(
      "포스트잇이 삭제됨, 되돌리기",
    );
    expect(container.querySelector<HTMLButtonElement>(".nc-save")?.textContent).toContain("포스트잇이 삭제됨 · 되돌리기");

    const scopedControlCopy = [
      ...Array.from(container.querySelectorAll<HTMLElement>(".nc-note-preview")),
      ...Array.from(container.querySelectorAll<HTMLElement>(".nc-note-actions button, .nc-note-inspiration-slide")),
      ...Array.from(
        container.querySelectorAll<HTMLElement>(
          ".memory-path-filter, .memory-contents-collapse, .memory-contents-feedback-action, .memory-contents-expanded-actions button, .nc-bottom-bar button, .nc-drawer-reflect-actions button",
        ),
      ),
      ...Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")),
    ]
      .flatMap((element) => [
        element.textContent ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? "",
        element.getAttribute("placeholder") ?? "",
      ])
      .join(" ");
    expect(scopedControlCopy).not.toMatch(
      /saved inspiration feedback|edit saved inspiration|collapse inspiration|reflection conversation|answer reflection prompt|answer here|cancel edit|bottom actions|back home|unpin post-it|\b(Pin|Delete|reflect|previous|next|cancel)\b|inspiration was deleted|sticky note was deleted|inspirations? led here/i,
    );
  });

  it("renders persisted Reflect Deeper transcript in saved inspiration detail after fetch", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([
      persistedReflection({
        id: "reflection-1",
        question: "What texture did this save point toward?",
        answer: "Mossy light and imperfect ceramic edges.",
        createdAt: "2026-05-14T16:31:00.000Z",
      }),
      persistedReflection({
        id: "reflection-2",
        question: "What should stay attached after refresh?",
        answer: "The Reflect Deeper transcript should be readable in detail.",
        createdAt: "2026-05-14T16:32:00.000Z",
      }),
    ]);

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(fetchReflections).toHaveBeenCalledWith("insp-1");
    expect(detail.textContent).toContain("2 reflections from this inspiration");
    expect(detail.textContent).not.toContain("2 of 2 answered");
    const show = detail.querySelector<HTMLButtonElement>(".memory-contents-reflection-summary");
    await act(async () => {
      show?.click();
    });
    expect(detail.textContent).toContain("What texture did this save point toward?");
    expect(detail.textContent).toContain("Mossy light and imperfect ceramic edges.");
    expect(detail.textContent).toContain("What should stay attached after refresh?");
    expect(detail.textContent).toContain("The Reflect Deeper transcript should be readable in detail.");
    expect(detail.textContent).not.toContain("Q1 What texture did this save point toward?");
    expect(detail.textContent).not.toContain("Answer Mossy light and imperfect ceramic edges.");
  });

  it("requests the first saved-signal Reflect question immediately and preserves the draft while it resolves", async () => {
    setApiFixtures();
    const delayedQuestion = deferred<Awaited<ReturnType<typeof generateGuidedReflectionQuestion>>>();
    vi.mocked(generateGuidedReflectionQuestion).mockReturnValueOnce(delayedQuestion.promise);

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const reflectButton = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "reflect",
    );
    expect(reflectButton).not.toBeNull();

    await act(async () => {
      reflectButton!.click();
    });

    expect(generateGuidedReflectionQuestion).toHaveBeenCalledTimes(1);
    expect(generateGuidedReflectionQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        priorAnswers: [],
        inspiration: expect.objectContaining({
          text: sampleSavedSignalDetail.rawText,
          kind: "note",
        }),
      }),
    );
    const question = container.querySelector<HTMLElement>(".nc-drawer-reflect-question");
    expect(question?.textContent).toContain("Finding a question for this inspiration...");
    expect(question?.textContent).not.toContain("What does this make you notice about yourself right now?");

    const answer = container.querySelector<HTMLTextAreaElement>(".nc-drawer-reflect textarea");
    expect(answer).not.toBeNull();
    expect(answer?.getAttribute("aria-label")).toBe("answer reflection prompt");
    expect(answer?.getAttribute("aria-describedby")).toBe("saved-signal-reflection-question");
    await act(async () => {
      setInputValue(answer!, "Second draft while model question resolves.");
    });

    await act(async () => {
      delayedQuestion.resolve({
        question: "When this bridge rhythm appears, what feels safe enough to try next?",
        source: "model",
      });
      await delayedQuestion.promise;
    });
    await flushReactWork();

    expect(answer?.value).toBe("Second draft while model question resolves.");
    expect(question?.textContent).toContain(
      "When this bridge rhythm appears, what feels safe enough to try next?",
    );
  });

  it("keeps a saved-memory CTA reflection when the initial reflections fetch resolves late", async () => {
    setApiFixtures();
    const delayedReflections = deferred<Awaited<ReturnType<typeof fetchReflections>>>();
    vi.mocked(fetchReflections).mockReturnValueOnce(delayedReflections.promise);
    vi.mocked(createReflection).mockResolvedValueOnce({
      reflection: persistedReflection({
        id: "reflection-memory-race",
        answer: "Keep the memory drawer answer visible.",
        createdAt: "2026-05-14T16:33:00.000Z",
      }),
    });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const reflectButton = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "reflect",
    );
    expect(reflectButton).not.toBeNull();

    await act(async () => {
      reflectButton!.click();
    });
    const answer = container.querySelector<HTMLTextAreaElement>(".nc-drawer-reflect textarea");
    expect(answer).not.toBeNull();
    await act(async () => {
      setInputValue(answer!, "Keep the memory drawer answer visible.");
    });
    expect(answer?.value).toBe("Keep the memory drawer answer visible.");

    await act(async () => {
      delayedReflections.resolve([]);
      await delayedReflections.promise;
    });

    expect(answer?.value).toBe("Keep the memory drawer answer visible.");
    expect(detail.textContent).not.toContain("No deeper reflection yet.");
  });

  it("enriches an existing saved inspiration through Reflect Deeper without duplicating the inspiration", async () => {
    setApiFixtures();
    const serverReflection = persistedReflection({
      id: "reflection-existing-new",
      question: "What does this inspiration ask you to notice next?",
      answer: "It wants the bridge rhythm to become a daily walk.",
      createdAt: "2026-05-14T16:33:00.000Z",
    });
    vi.mocked(createReflection).mockResolvedValue({ reflection: serverReflection });

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const reflectButton = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "reflect",
    );
    expect(reflectButton).not.toBeNull();

    await act(async () => {
      reflectButton!.click();
    });
    const answer = container.querySelector<HTMLTextAreaElement>(".nc-drawer-reflect textarea");
    expect(answer).not.toBeNull();

    await act(async () => {
      setInputValue(answer!, "It wants the bridge rhythm to become a daily walk.");
    });
    expect(answer?.value).toBe("It wants the bridge rhythm to become a daily walk.");
    expect(createInspiration).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".memory-contents-item")).toHaveLength(1);
    expect(container.querySelector(".nc-drawer-reflect")).not.toBeNull();
  });

  it("loads current Home data from signals and top-of-mind endpoints", async () => {
    setApiFixtures();
    await renderHomePage();

    expect(fetchInspirations).toHaveBeenCalledTimes(1);
    expect(fetchTopOfMind).toHaveBeenCalledTimes(1);
    expect(fetchTopOfMindNotes).toHaveBeenCalledWith({ limit: 5 });
  });



  it("renders source-grounded attachment context from refreshed inspirations", async () => {
    setApiFixtures({
      inspirations: [
        {
          ...sampleInspirations[0],
          attachments: [
            persistedAttachment({
              id: "att-link-ready",
              inspirationId: "insp-1",
              type: "link",
              url: "https://example.com/article",
              name: "Example",
              enrichment: {
                status: "ready",
                source: "url",
                sourceUrl: "https://example.com/article",
                errorReason: null,
                checkedAt: "2026-05-14T16:30:02.000Z",
                link: {
                  originalUrl: "https://example.com/article",
                  finalUrl: "https://example.com/article",
                  hostname: "example.com",
                  title: "<script>alert(1)</script> Source title",
                  description: "A source-grounded preview from metadata.",
                  siteName: null,
                  previewImageUrl: null,
                },
                image: null,
              },
            }),
            persistedAttachment({
              id: "att-image-ready",
              inspirationId: "insp-1",
              type: "image",
              url: "https://private-bucket.s3.us-east-1.amazonaws.com/users/user-1/image.png",
              s3Key: "users/user-1/image.png",
              name: "image.png",
              contentType: "image/png",
              size: 4096,
              enrichment: {
                status: "ready",
                source: "user_upload",
                sourceUrl: null,
                errorReason: null,
                checkedAt: "2026-05-14T16:30:03.000Z",
                link: null,
                image: {
                  filename: "image.png",
                  contentType: "image/png",
                  size: 4096,
                  width: null,
                  height: null,
                },
              },
            }),
          ],
        },
      ],
      topOfMindNotes: [],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, 1);
    await openAllInspirations(container);
    expect(container.textContent).toContain("<script>alert(1)</script> Source title");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("image.png · 4 KB");

    const save = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    await act(async () => {
      save?.click();
    });
    await flushReactWork();

    expect(container.textContent).not.toContain("attachment details");
    expect(container.textContent).toContain("<script>alert(1)</script> Source title");
    expect(container.textContent).toContain("image.png · 4 KB");
    expect(container.querySelector(".detail-attachment-image")).toBeNull();
    expect(container.innerHTML).not.toContain("private-bucket.s3.us-east-1.amazonaws.com");
    expect(container.innerHTML).not.toContain("users/user-1/image.png");
  });

  it("renders saved link, note plus URL, image-only, and mixed history without backend kind labels", async () => {
    const readyLinkEnrichment = (url: string) => ({
      status: "ready" as const,
      source: "url" as const,
      sourceUrl: url,
      errorReason: null,
      checkedAt: "2026-05-14T16:30:02.000Z",
      link: {
        originalUrl: url,
        finalUrl: url,
        hostname: "example.com",
        title: null,
        description: null,
        siteName: null,
        previewImageUrl: null,
      },
      image: null,
    });
    setApiFixtures({
      inspirations: [
        persistedInspiration({
          id: "insp-link-only",
          text: "Link inspiration",
          kind: "link",
          createdAt: "2026-05-14T16:33:00.000Z",
          updatedAt: "2026-05-14T16:33:00.000Z",
          attachments: [
            persistedAttachment({
              id: "att-link-only",
              inspirationId: "insp-link-only",
              type: "link",
              url: "https://example.com/tokyo-guide",
              name: "example.com/tokyo-guide",
              enrichment: readyLinkEnrichment("https://example.com/tokyo-guide"),
            }),
          ],
        }),
        persistedInspiration({
          id: "insp-note-url",
          text: "Kyoto ramen note https://example.com/kyoto-guide",
          kind: "mixed",
          createdAt: "2026-05-14T16:32:00.000Z",
          updatedAt: "2026-05-14T16:32:00.000Z",
          attachments: [
            persistedAttachment({
              id: "att-note-url",
              inspirationId: "insp-note-url",
              type: "link",
              url: "https://example.com/kyoto-guide",
              name: "example.com/kyoto-guide",
              enrichment: readyLinkEnrichment("https://example.com/kyoto-guide"),
            }),
          ],
        }),
        persistedInspiration({
          id: "insp-image-only",
          text: "Image inspiration",
          kind: "image",
          createdAt: "2026-05-14T16:31:00.000Z",
          updatedAt: "2026-05-14T16:31:00.000Z",
          attachments: [
            persistedAttachment({
              id: "att-image-only",
              inspirationId: "insp-image-only",
              type: "image",
              url: "",
              name: "pixel.png",
              contentType: "image/png",
              size: 1024,
            }),
          ],
        }),
        persistedInspiration({
          id: "insp-mixed",
          text: "Mixed capture about Osaka",
          kind: "mixed",
          createdAt: "2026-05-14T16:30:00.000Z",
          updatedAt: "2026-05-14T16:30:00.000Z",
          attachments: [
            persistedAttachment({
              id: "att-mixed",
              inspirationId: "insp-mixed",
              type: "link",
              url: "https://example.com/osaka-guide",
              name: "example.com/osaka-guide",
              enrichment: readyLinkEnrichment("https://example.com/osaka-guide"),
            }),
          ],
        }),
      ],
      topOfMindNotes: [],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, 4);
    await openAllInspirations(container);
    expect(container.querySelector(".reference-save-kind")).toBeNull();
    const historyText = container.querySelector(".reference-saves-page")?.textContent ?? "";
    expect(historyText).toContain("Link inspiration");
    expect(historyText).toContain("Kyoto ramen note https://example.com/kyoto-guide");
    expect(historyText).toContain("Image inspiration");
    expect(historyText).toContain("Mixed capture about Osaka");
    expect(historyText).toContain("example.com");
    expect(historyText).toContain("pixel.png · 1 KB");
    expect(historyText).not.toContain("LINK");
    expect(historyText).not.toContain("MIXED");
    expect(historyText).not.toContain("IMAGE");
    expect(historyText).not.toContain("FILE");
    expect(historyText).not.toContain("(attachment-only inspiration)");
  });

  it("renders the current top-of-mind canvas and hero copy", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-canvas")).not.toBeNull();
    expect(container.querySelector(".nc-topbar")).toBeNull();
    expect(container.querySelector(".nc-mode")).toBeNull();
    expect(container.querySelector(".nc-meta")).toBeNull();
    expect(container.textContent).toContain("river's top of mind");
    expect(container.textContent).not.toContain("Most inspiration disappears.");
    expect(container.textContent).not.toContain("Waka caught what almost slipped away.");
    expect(container.textContent).not.toContain("They caught what almost slipped away.");
    expect(container.textContent).not.toContain("five provisional post-its. not final. changed by new saves.");
  });

  it("renders a spaced display name fully in the hero copy", async () => {
    mockAuthState.value.user.name = " River Song ";
    setApiFixtures();

    const container = await renderHomePage();

    expect(container.textContent).toContain("river song's top of mind");
    expect(container.textContent).not.toContain("river's top of mind");
  });

  it("falls back to the email local part when the display name is blank", async () => {
    mockAuthState.value.user.email = "cloudwalker@example.com";
    mockAuthState.value.user.name = "   ";
    setApiFixtures();

    const container = await renderHomePage();

    expect(container.textContent).toContain("cloudwalker's top of mind");
  });

  it("names the primary product spaces without surfacing internal graph UI", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("top of mind");
    expect(container.querySelector(".nc-drawer-object")?.textContent).toContain("2 saved");
    expect(container.querySelector("a[href='/top-of-mind/share']")).toBeNull();
    expect(container.querySelector(".admin-entry-pill")?.textContent).toBe("Debug");
    expect(container.textContent).not.toContain("meaning graph");
    expect(container.textContent).not.toContain("compatibility archive");
  });

  it("keeps internal language out of the main wall, post-it, drawer, and capture copy", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const bannedInternalCopy = /\b(signals?|memories|nodes?|graph|resonance|analysis|AI|productivity|knowledge[-\s]?base)\b|memory movement/i;
    const wallCopy = [
      container.querySelector(".nc-titlecard")?.textContent,
      container.querySelector(".nc-stage")?.textContent,
      container.querySelector(".nc-save")?.textContent,
    ].join(" ");

    expect(wallCopy).not.toMatch(bannedInternalCopy);
    expect(container.querySelector(".nc-titlecard")?.textContent).not.toMatch(/\bWAKA\b/);
    expect(container.querySelector(".nc-stage")?.textContent).not.toMatch(/\bWAKA\b/);

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(container.querySelector(".nc-note")?.textContent).not.toMatch(bannedInternalCopy);
    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    const drawerCopy = [
      container.querySelector(".signal-revisit-header")?.textContent,
      container.querySelector(".memory-category-panel")?.textContent,
      container.querySelector(".memory-contents-flow")?.textContent,
    ].join(" ");
    expect(drawerCopy).not.toMatch(bannedInternalCopy);
    expect(drawerCopy).not.toMatch(/\bWAKA\b/);
  });

  it("keeps top-of-mind notes primary when enough inspirations are available", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-stage")).not.toBeNull();
    expect(container.querySelector(".nc-topbar")).toBeNull();
    expect(container.querySelector(".nc-mode")).toBeNull();
    expect(container.querySelector(".nc-drawer-object")).not.toBeNull();
    expect(container.querySelectorAll(".nc-note")).toHaveLength(1);
    expect(container.textContent).toContain("make the thing before explaining it");
    expect(container.textContent).not.toContain("ambition signal");
    expect(container.textContent).not.toContain("try one small thing in the real world");
    expect(container.querySelector(".nc-note .nc-note-control-btn")).toBeNull();
    expect(container.querySelector(".nc-note")?.textContent).not.toContain("keeps returning");
    expect(container.querySelector(".nc-note")?.textContent).not.toContain("not final");
    expect(container.querySelector(".nc-note")?.textContent).not.toContain("changed by new saves");
    expect(container.textContent).not.toContain("Waiting for a stronger signal to earn this spot.");
    expect(container.textContent).not.toContain("What WAKA noticed");
    expect(container.textContent).not.toContain("Dev-only inspect WOW fields");
  });

  it("does not render preview graph labels as post-its when no generated top-of-mind notes exist", async () => {
    setApiFixtures({
      topOfMind: {
        ...sampleTopOfMind,
        headline: "Top of mind: RAW_GRAPH_LABEL_preview_headline",
        activeThemes: [
          {
            nodeId: "theme-unsafe-preview",
            label: "RAW_GRAPH_LABEL_frequency_scaffold",
            type: "theme",
            reason: "Supporting signals and Memory movement should stay out of the wall.",
            evidenceCount: 4,
            lastReinforcedAt: "2026-05-12T12:00:00.000Z",
            supportingInspirations: [
              {
                id: "insp-preview-support",
                preview: "deterministic preview support should not be a post-it",
                reason: "frequency scaffold",
                createdAt: "2026-05-11T12:00:00.000Z",
              },
            ],
          },
        ],
        activeQuestions: [
          {
            nodeId: "question-unsafe-preview",
            label: "Top of mind: template question scaffold",
            type: "question",
            reason: "Raw graph labels are preview-only compatibility data.",
            evidenceCount: 3,
            lastReinforcedAt: "2026-05-12T12:00:00.000Z",
            supportingInspirations: [],
          },
        ],
      },
      topOfMindNotes: [],
    });

    const container = await renderHomePage();

    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(container.textContent).toContain(
      "Capture an inspiration. As you save and reflect, WAKA connects recurring patterns, and provisional post-its you can correct will appear here.",
    );
    expect(container.textContent).toContain("capture inspiration");
    expect(container.textContent).not.toContain("RAW_GRAPH_LABEL_frequency_scaffold");
    expect(container.textContent).not.toContain("Top of mind: template question scaffold");
    expect(container.textContent).not.toContain("RAW_GRAPH_LABEL_preview_headline");
    expect(container.textContent).not.toContain("Supporting signals");
    expect(container.textContent).not.toContain("Memory movement");
    expect(container.textContent).not.toContain("frequency scaffold");
  });

  it("shows first-run expectation guidance instead of an empty wall", async () => {
    setApiFixtures({ topOfMindNotes: [], savedSignals: [], inspirations: [] });

    const container = await renderHomePage();
    const guide = container.querySelector<HTMLElement>(".nc-first-run-guide");

    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(guide).not.toBeNull();
    expect(guide?.getAttribute("aria-label")).toBe("Start with one small loop");
    expect(guide?.textContent).toContain("Save the first inspiration that is tugging at you.");
    expect(guide?.textContent).toContain("Add a few words about what pulled you toward it.");
    expect(guide?.textContent).toContain(
      "As you save and reflect, WAKA starts noticing patterns as provisional post-its.",
    );
    expect(guide?.textContent).not.toContain("signal");
    expect(guide?.textContent).not.toContain("graph");
    expect(container.querySelector(".nc-save")?.textContent).toContain("capture inspiration");
  });

  it("keeps ko-KR users on the safe empty state instead of English preview scaffolds", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures({
      topOfMind: {
        ...sampleTopOfMind,
        headline: "Top of mind: English fallback scaffold",
        activeThemes: [
          {
            nodeId: "theme-english-preview",
            label: "English-only deterministic scaffold card",
            type: "theme",
            reason: "Supporting signals from preview graph data.",
            evidenceCount: 2,
            lastReinforcedAt: "2026-05-12T12:00:00.000Z",
            supportingInspirations: [],
          },
        ],
        activeQuestions: [],
      },
      topOfMindNotes: [],
    });

    const container = await renderHomePage();

    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(container.textContent).toContain(
      "첫 영감을 기록하세요. 저장하고 돌아볼수록 WAKA가 반복되는 패턴을 연결하고, 고치기 쉬운 임시 포스트잇이 여기에 나타납니다.",
    );
    expect(container.textContent).not.toContain("English-only deterministic scaffold card");
    expect(container.textContent).not.toContain("Top of mind: English fallback scaffold");
    expect(container.textContent).not.toContain("Capture inspirations to generate your top of mind stickies.");
    expect(container.textContent).not.toContain("Supporting signals");
  });

  it("localizes first-run expectation guidance for ko-KR users", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures({ topOfMindNotes: [], savedSignals: [], inspirations: [] });

    const container = await renderHomePage();
    const guide = container.querySelector<HTMLElement>(".nc-first-run-guide");

    expect(guide).not.toBeNull();
    expect(guide?.getAttribute("aria-label")).toBe("처음에는 이렇게 시작하세요");
    expect(guide?.textContent).toContain("지금 마음에 걸리는 영감 하나를 저장하세요.");
    expect(guide?.textContent).toContain("왜 끌렸는지 몇 단어만 덧붙이세요.");
    expect(guide?.textContent).toContain(
      "영감과 돌아보기가 쌓이면 WAKA가 반복되는 패턴을 임시 포스트잇으로 보여줍니다.",
    );
    expect(guide?.textContent).not.toContain("signal");
    expect(guide?.textContent).not.toContain("graph");
    expect(container.querySelector(".nc-save")?.textContent).toContain("영감 기록");
  });

  it("treats post-its as intentional inline editing surfaces without opening a modal", async () => {
    const fullTitle =
      "make the thing before explaining it because the room keeps rewarding comments before anyone can touch the real object";
    const fullBody =
      "Several saved signals connect architecture essays with walking routes, jazz history, and a repeated wish to make the concrete draft before the commentary takes over.";
    setApiFixtures({
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          title: fullTitle,
          body: fullBody,
          evidencePreviews: [
            {
              ...sampleTopOfMindNote.evidencePreviews[0],
              textPreview:
                "Architecture essay about bridge rhythms in city walks, public crossings, jazz history, and making before commentary",
            },
          ],
        },
      ],
    });
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(note?.querySelector(".nc-note-preview")?.getAttribute("aria-label")).toBe("post-it preview");
    expect(note?.querySelector<HTMLTextAreaElement>(".nc-note-body-edit--inline")?.value).toBe(fullTitle);
    expect(note?.querySelector(".nc-note-explain--preview")).toBeNull();
    expect(note?.querySelector(".nc-note-inspirations")).toBeNull();
    expect(note?.textContent).not.toContain("where it began");
    expect(note?.textContent).not.toContain("Architecture essay about bridge rhythms");
    expect(note?.textContent).not.toContain("This signal anchors the pattern.");
    expect(note?.textContent).not.toContain("insp-1");
    expect(note?.querySelector(".nc-note-open-hint")).toBeNull();

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(note?.querySelector<HTMLTextAreaElement>(".nc-note-body-edit--inline")?.value).toBe(fullTitle);
  });

  it("keeps the post-it itself out of the keyboard action order while exposing the inspiration slide", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("role")).toBeNull();
    expect(note?.getAttribute("tabindex")).toBeNull();
    expect(note?.getAttribute("aria-label")).toBeNull();

    const evidenceButton = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceButton).not.toBeNull();
    expect(evidenceButton?.textContent).toContain("1 inspiration led here");
  });

  it("keeps post-its direct and rejects summary-like topic labels", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const postitBodies = Array.from(container.querySelectorAll(".nc-note:not(.nc-note--empty) .nc-note-body")).map(
      (note) => note.textContent ?? "",
    );

    expect(postitBodies).toHaveLength(1);
    expect(postitBodies[0]).toBe("make the thing before explaining it");
    expect(postitBodies[0]).not.toMatch(/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i);
    expect(postitBodies[0].split(/\s+/).length).toBeGreaterThanOrEqual(5);
    expect(postitBodies[0].split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(postitBodies[0]).toMatch(/\b(people|room|work|thing|path|taste|self|question|experiment)\b/i);
    expect(postitBodies[0]).not.toMatch(
      /^(public before perfect|taste as default|test it outside|test it in public|courage normal)$/i,
    );
    expect(postitBodies.join(" ")).not.toMatch(/\b(startups|comedy|cities|AI|inspiration|productivity)\b/i);
    expect(postitBodies.join(" ")).not.toContain("places that make movement visible");
  });

  it("opens top-of-mind evidence from the explicit inspiration slide control", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    const evidenceSummary = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceSummary).not.toBeNull();
    expect(evidenceSummary?.textContent).toContain("1 inspiration led here");
    expect(container.querySelector(".nc-note-evidence-open")).toBeNull();
    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(container.querySelector(".nc-note-related-block")).toBeNull();
    expect(container.querySelector(".nc-note-drawer-link")).toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-icon-btn--pin")).not.toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-icon-btn--delete")).not.toBeNull();

    await act(async () => {
      evidenceSummary?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    const drawer = container.querySelector<HTMLElement>(".signal-revisit-page");
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain("top of mind");
    expect(drawer?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
  });

  it("expands the opened post-it around a non-first evidence inspiration", async () => {
    setApiFixtures({
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          evidencePreviews: [
            sampleTopOfMindNote.evidencePreviews[0],
            {
              signalId: "insp-2",
              role: "second clue",
              reason: "This later save deepens the same pattern.",
              textPreview: "Second inspiration about collaboration rooms and honest critique",
              kind: "note",
              createdAt: "2026-05-11T12:00:00.000Z",
              resonanceScore: 5,
            },
          ],
          relatedSignals: [],
          relatedSignalIds: [],
        },
      ],
      savedSignals: [
        sampleSavedSignals[0],
        {
          ...sampleSavedSignals[0],
          id: "insp-2",
          textPreview: "Second inspiration about collaboration rooms and honest critique",
        },
      ],
    });
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    const evidenceSummary = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceSummary).not.toBeNull();
    expect(evidenceSummary?.textContent).toContain("2 inspirations led here");

    await act(async () => {
      evidenceSummary?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    const drawer = container.querySelector<HTMLElement>(".signal-revisit-page");
    expect(drawer?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(drawer?.textContent).toContain("Synthetic memory note for rereading old journals");
    expect(drawer?.textContent).not.toContain("also points at this post-it");
    expect(drawer?.textContent).not.toContain("nearby saves");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-2", "detail_opened");
  });

  it("opens a full saved inspiration from the post-it evidence drawer", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    expect(container.querySelector(".nc-note-evidence-open")).toBeNull();

    const evidenceSummary = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceSummary).not.toBeNull();

    await act(async () => {
      evidenceSummary?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    const drawerSave = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(drawerSave?.textContent).toContain("Architecture essay about bridge rhythms in city walks");

    await act(async () => {
      drawerSave?.click();
    });
    await flushReactWork();
    await flushReactWork();

    const detail = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(detail?.textContent).not.toContain("Signal packet");
    expect(detail?.textContent).not.toContain("what did this mean then?");
    expect(detail?.textContent).not.toContain("what does it mean now?");
    expect(detail?.textContent).not.toContain("does this still fit?");
    expect(detail?.textContent).not.toContain("attachment details");
    expect(detail?.textContent).not.toContain("nearby piles");
    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
  });

  it("keeps post-it evidence preview-only when an inspiration id is missing", async () => {
    setApiFixtures({
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          evidencePreviews: [
            {
              ...sampleTopOfMindNote.evidencePreviews[0],
              signalId: "",
              textPreview: "A preview without a resolvable saved inspiration id",
            },
          ],
          relatedSignals: [],
          relatedSignalIds: [],
        },
      ],
    });
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    const evidenceTrigger = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceTrigger?.disabled).toBe(true);
    expect(evidenceTrigger?.textContent).toContain("1 inspiration led here");
    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(container.querySelector(".nc-note-evidence-open")).toBeNull();
    expect(container.querySelector(".nc-note-evidence-open--disabled")).toBeNull();
    expect(container.querySelector(".memory-stack-detail--mockup")).toBeNull();
    expect(fetchSavedSignalDetail).not.toHaveBeenCalled();
  });

  it("keeps empty evidence out of the opened post-it and points to the drawer", async () => {
    setApiFixtures({
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          id: "note-no-evidence",
          title: "A question is still forming",
          evidencePreviews: [],
          relatedSignals: [],
          relatedSignalIds: [],
          relatedContextNodeIds: [],
        },
      ],
    });
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(note?.querySelector(".nc-note-inspirations")).toBeNull();
    expect(note?.textContent).not.toContain("open to see what led here");
    expect(note?.textContent).not.toContain("no saved inspiration");

    expect(note?.querySelector(".nc-note-inspiration-slide")).toBeNull();
    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(note?.textContent).not.toContain("saved inspirations stay private there");
    expect(note?.textContent).not.toContain("saved inspirations nearby");
    expect(note?.textContent).not.toContain("no saved inspiration attached yet");
    expect(note?.textContent).not.toContain("This post-it does not have saved inspiration attached yet.");
    expect(note?.textContent).not.toContain("ambition dimension");
    expect(note?.textContent).not.toContain("No deeper read has attached to this note yet.");
    expect(note?.textContent).not.toContain("meaning_nodes");
    expect(note?.textContent).not.toContain("context_node:");
  });

  it("removes old reaction buttons from the wall and opened post-it", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    expect(container.querySelector(".nc-note .nc-note-control-btn")).toBeNull();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(note?.textContent).not.toContain("true");
    expect(note?.textContent).not.toContain("partly");
    expect(note?.textContent).not.toContain("not this");
    expect(note?.textContent).not.toContain("rewrite in my words");
    expect(note?.textContent).not.toContain("rewrite this post-it");
    expect(note?.textContent).not.toContain("pin wording");
    expect(note?.textContent).not.toContain("pull down");
    expect(note?.textContent).not.toContain("open memory drawer");
    expect(note?.querySelector(".nc-note-icon-btn--delete")).not.toBeNull();
  });

  it("persists an in-place Top of Mind rewrite using the user's wording", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    const rewrite = container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit");
    expect(rewrite).not.toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    await act(async () => {
      setInputValue(rewrite!, "make rooms where rough drafts can breathe");
    });
    await flushReactWork();
    await waitForTimers(700);
    await flushReactWork();

    expect(container.textContent).toContain("make rooms where rough drafts can breathe");
    expect(note?.textContent).not.toContain("saved");
    expect(updateTopOfMindNote).toHaveBeenCalledWith("note-1", {
      title: "make rooms where rough drafts can breathe",
    });
  });

  it("shows loading while an in-place Top of Mind rewrite is saving", async () => {
    const delayedUpdate = deferred<ApiTopOfMindNoteSurface>();
    vi.mocked(updateTopOfMindNote).mockReturnValueOnce(delayedUpdate.promise);
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    const rewrite = container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit");
    expect(note).not.toBeNull();
    expect(rewrite).not.toBeNull();

    await act(async () => {
      setInputValue(rewrite!, "make rooms where rough drafts can breathe");
    });
    await flushReactWork();
    await waitForTimers(700);
    await flushReactWork();

    expect(note?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".nc-note-edit-saving")).not.toBeNull();
    expect(rewrite?.disabled).toBe(true);

    delayedUpdate.resolve({
      ...sampleTopOfMindNote,
      title: "make rooms where rough drafts can breathe",
      ambientSignal: "make rooms where rough drafts can breathe",
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-edit-saving")).toBeNull();
    expect(rewrite?.disabled).toBe(false);
  });

  it("deletes a Top of Mind post-it without showing a weak replacement", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    const deleteButton = note?.querySelector<HTMLButtonElement>(".nc-note-icon-btn--delete");
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(container.textContent).toContain(
      "Capture an inspiration. As you save and reflect, WAKA connects recurring patterns, and provisional post-its you can correct will appear here.",
    );
    expect(container.textContent).not.toContain("ambition signal");
    expect(container.textContent).not.toContain("Waiting for a stronger signal to earn this spot.");
    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "top_of_mind_note",
      targetId: "note-1",
      value: "not_true",
      correctionText: "pulled down from the wall",
    });
  });

  it("surfaces Top of Mind edit failures without keeping optimistic wording", async () => {
    vi.mocked(updateTopOfMindNote).mockRejectedValueOnce(new Error("offline"));
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    const rewrite = container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit");
    expect(rewrite).not.toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    await act(async () => {
      setInputValue(rewrite!, "make the public room first");
    });
    await flushReactWork();
    await waitForTimers(700);
    await flushReactWork();

    const visiblePostItBodies = Array.from(container.querySelectorAll<HTMLTextAreaElement>(".nc-note-body-edit")).map(
      (body) => body.value,
    );
    expect(visiblePostItBodies.join(" ")).toContain("make the thing before explaining it");
    expect(visiblePostItBodies.join(" ")).not.toContain("make the public room first");
    expect(container.textContent).toContain("could not change post-it");
  });

  it("starts low-data users on Top of Mind with bottom capture available", async () => {
    setApiFixtures({
      inspirations: [],
      topOfMindNotes: [],
      topOfMind: {
        ...sampleTopOfMind,
        activeThemes: [],
        activeQuestions: [],
        relationshipSignals: [],
        summary: {
          inspirationCount: 0,
          meaningNoteCount: 0,
          relationshipEdgeCount: 0,
        },
      },
    });
    const container = await renderHomePage();

    expect(container.querySelector(".reference-capture-page")).toBeNull();
    expect(container.querySelector(".nc-topbar")).toBeNull();
    expect(container.querySelector(".nc-mode")).toBeNull();
    expect(container.textContent).toContain(
      "Capture an inspiration. As you save and reflect, WAKA connects recurring patterns, and provisional post-its you can correct will appear here.",
    );
    expect(container.querySelector(".nc-drawer-object")?.textContent).toContain("0 saved");
    expect(container.querySelector(".nc-save")?.textContent).toContain("capture inspiration");
    expect(container.querySelector("#capNote")).toBeNull();
  });

  it("keeps graph preview notes out of the wall while top-of-mind note persistence is empty", async () => {
    setApiFixtures({ topOfMindNotes: [] });
    const container = await renderHomePage();

    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(container.textContent).toContain(
      "Capture an inspiration. As you save and reflect, WAKA connects recurring patterns, and provisional post-its you can correct will appear here.",
    );
    expect(container.textContent).not.toContain("rooms where people can be honest before they are impressive");
    expect(container.textContent).not.toContain("ambition signal");
    expect(container.textContent).not.toContain("What WAKA noticed");
  });

  it("removes the authorship footnote and keeps profile access top-right", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).not.toContain("This page was not written by river.");
    expect(container.textContent).not.toContain("— Ⓒ 2026, for minds that wander");
    expect(container.querySelector(".nc-footnote")).toBeNull();
    expect(container.querySelector(".nc-lang-btn")).toBeNull();
    expect(container.querySelector<HTMLAnchorElement>(".nc-profile-link")?.getAttribute("href")).toBe("/profile");
  });

  it("filters server-returned inspirations down to the authenticated user", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-drawer-object")?.textContent).toContain("2 saved");
    expect(container.textContent).not.toContain("Other user save should never render");
  });

  it("keeps the capture form closed and legacy Home switcher absent on first paint", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".home-view-switcher")).toBeNull();
    expect(container.querySelector("#capNote")).toBeNull();
    expect(container.querySelector(".reference-capture-modal")).toBeNull();
  });

  it("removes Korean intro copy after onboarding owns the explanation", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("river의 탑오브마인드");
    expect(container.textContent).not.toContain("떠오른 생각은 자주 사라집니다.");
    expect(container.textContent).not.toContain("쓴 것이 아니라");
    expect(container.textContent).toContain("make the thing before explaining it");
  });

  it("keeps logout off the home surface", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".home-signout-pill")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("button[aria-label^='로그아웃']")).toBeNull();
  });

  it("does not render home language buttons after onboarding owns locale selection", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-lang-btn")).toBeNull();
    expect(mockAuthState.value.updatePreferredLocale).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLAnchorElement>(".nc-profile-link")?.textContent).toContain("Profile");
  });

  it("keeps the inspiration evidence sticky text large enough to read", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.nc-note-evidence-summary > span\s*\{[\s\S]*?font-size:\s*18px;/);
    expect(css).toMatch(/\.nc-note-evidence-previews small\s*\{[\s\S]*?font-size:\s*11px;/);
  });

  it("opens an anchored memory drawer stack from the wall drawer object", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);

    expect(container.querySelector(".reference-saves-page")).not.toBeNull();
    expect(container.querySelector(".signal-revisit-page")).not.toBeNull();
    expect(container.querySelector(".signal-archive-page")).toBeNull();
    expect(container.querySelector(".nc-drawer-object--close")).not.toBeNull();
    expect(container.querySelector(".nc-bottom-bar--drawer")).not.toBeNull();
    expect(container.querySelector(".nc-drawer-search input")).not.toBeNull();
    expect(container.querySelector(".memory-drawer-stack")).not.toBeNull();
    expect(container.querySelector(".memory-drawer-overlay")).toBeNull();
    expect(container.textContent).not.toContain("Choose a pile, or open everything.");
    expect(container.textContent).not.toContain("back to wall");
    expect(container.querySelector(".memory-category-panel")).not.toBeNull();
    expect(container.querySelector(".memory-category-column")).toBeNull();
    expect(container.querySelector(".memory-path-filters")).not.toBeNull();
    expect(container.querySelector(".memory-path-filter")?.textContent).toContain("all saved");
    expect(container.querySelector(".memory-group-board")).toBeNull();
    expect(container.querySelector(".memory-contents-flow")).toBeNull();
    expect(container.querySelector(".memory-mode-switcher")).toBeNull();
    expect(container.textContent).not.toContain("List scans the timeline");
  });

  it("keeps drawer bottom controls responsive on phone widths", () => {
    const css = readFileSync("src/styles/global.css", "utf8");
    const mobileDrawerRules = css.match(/@media \(max-width: 760px\) \{[\s\S]*?\.nc-bottom-bar--drawer[\s\S]*?\.nc-bottom-bar--drawer \.nc-drawer-object[\s\S]*?\n  \}/)?.[0] ?? "";

    expect(mobileDrawerRules).toContain("left: 50%");
    expect(mobileDrawerRules).toContain("display: inline-flex");
    expect(mobileDrawerRules).toContain("transform: translateX(-50%)");
    expect(mobileDrawerRules).toContain("min-width: 0");
  });

  it("opens filesystem-filtered drawer entries and inspiration detail in place", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    const stack = container.querySelector<HTMLElement>(".memory-drawer-stack");
    expect(stack).not.toBeNull();
    const columns = stack?.querySelector<HTMLElement>(".memory-category-panel");
    expect(columns).not.toBeNull();
    expect(stack?.querySelector(".memory-group-board")).toBeNull();
    expect(stack?.querySelector(".memory-contents-flow")).toBeNull();
    expect(stack?.querySelector(".memory-stack-detail")).toBeNull();
    expect(columns?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(container.querySelector(".memory-path-filter--active")?.textContent).toContain("all saved");

    const firstInspiration = columns?.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(firstInspiration).not.toBeNull();
    await act(async () => {
      firstInspiration?.click();
    });
    await flushReactWork();

    expect(stack?.querySelector(".memory-category-panel")).not.toBeNull();
    const detail = stack?.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("Architecture essay about bridge rhythms");
    const detailBack = detail?.querySelector<HTMLButtonElement>(".memory-contents-collapse");
    expect(detailBack).not.toBeNull();
    expect(container.querySelector(".memory-window")).toBeNull();

    await act(async () => {
      detailBack?.click();
    });
    await flushReactWork();
    expect(stack?.querySelector(".memory-category-panel")).not.toBeNull();
  });

  it("closes the category drawer when the user clicks outside a column", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    const categoryLevel = container.querySelector<HTMLElement>(".memory-stack-level--categories");
    expect(categoryLevel).not.toBeNull();

    await act(async () => {
      categoryLevel?.click();
    });
    await flushReactWork();
    expect(container.querySelector(".memory-drawer-stack--closing")).not.toBeNull();

    await waitForTimers(380);
    await flushReactWork();
    expect(container.querySelector(".memory-drawer-stack")).toBeNull();
    expect(container.querySelector(".nc-save")).not.toBeNull();
  });

  it("keeps path filters available after the drawer closes and reopens", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    expect(container.querySelector(".memory-path-filter")?.textContent).toContain("all saved");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-drawer-object")?.click();
    });
    await flushReactWork();
    await waitForTimers(380);
    await flushReactWork();
    expect(container.querySelector(".memory-drawer-stack")).toBeNull();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    expect(container.querySelector(".memory-category-panel")).not.toBeNull();
    expect(container.querySelector(".memory-path-filter")?.textContent).toContain("all saved");
    expect(container.querySelector(".memory-category-panel")?.textContent).toContain("save");
  });

  it("lists the authenticated user's saved inspirations newest first", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await openAllInspirations(container);

    const savesPage = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPage?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(savesPage?.textContent).toContain("Synthetic memory note");
    expect(savesPage?.textContent).not.toContain("Other user save should never render");
  });

  it("shows filesystem path filters with chronological list rows and search secondary", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    const drawer = container.querySelector<HTMLElement>(".signal-revisit-page");
    const panel = drawer?.querySelector<HTMLElement>(".memory-category-panel");
    const contents = drawer?.querySelector<HTMLElement>(".memory-contents-flow");
    const pathFilters = container.querySelector<HTMLElement>(".memory-path-filters");
    expect(panel).not.toBeNull();
    expect(pathFilters?.textContent).toContain("all saved");
    expect(pathFilters?.textContent).toContain("recently saved");
    expect(pathFilters?.textContent).not.toContain("make the thing before explaining it");
    expect(contents).toBeNull();
    expect(container.querySelector(".nc-drawer-search input")).not.toBeNull();
    expect(panel?.textContent?.indexOf("Architecture essay")).toBeLessThan(
      panel?.textContent?.indexOf("Synthetic memory note") ?? 9999,
    );
    expect(drawer?.querySelector(".signal-memory-lenses")).toBeNull();
    expect(drawer?.textContent?.toLowerCase()).not.toContain("keeps coming back");
    expect(drawer?.textContent?.toLowerCase()).not.toContain("memory movement");
  });

  it("renders expanded saved inspirations with one stable text layer even when old highlights exist", async () => {
    setApiFixtures({
      savedSignals: [
        {
          ...sampleSavedSignals[0],
          highlightedSnippets: [],
        },
        {
          ...sampleSavedSignals[1],
          highlightedSnippets: [
            {
              id: "spark-journal",
              text: "rereading old journals",
              source: "user",
              confidence: 0.92,
              isPrimary: true,
            },
          ],
        },
      ],
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        highlightedSnippets: [],
      },
    });
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    const firstSave = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(firstSave?.textContent).toContain("Architecture essay");
    await act(async () => {
      firstSave?.click();
    });
    await flushReactWork();

    let expanded = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(expanded).not.toBeNull();
    expect(expanded?.querySelector(".memory-contents-loading")).toBeNull();
    expect(expanded?.querySelector(".memory-contents-highlight-layer")).toBeNull();
    const editor = expanded?.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor");
    expect(editor).not.toBeNull();
    expect(editor?.classList.contains("memory-contents-expanded-editor--with-highlights")).toBe(false);
    expect(editor?.value).toBe("Architecture essay about bridge rhythms in city walks");

    const collapse = expanded?.querySelector<HTMLButtonElement>(".memory-contents-collapse");
    await act(async () => {
      collapse?.click();
    });
    await flushReactWork();

    const highlightedSave = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item")).find((save) =>
      save.textContent?.includes("Synthetic memory note"),
    );
    expect(highlightedSave).not.toBeNull();
    await act(async () => {
      highlightedSave?.click();
    });
    await flushReactWork();

    expanded = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(expanded?.querySelector(".memory-contents-loading")).toBeNull();
    const highlightedEditor = expanded?.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor");
    expect(expanded?.querySelector(".memory-contents-highlight-layer")).toBeNull();
    expect(highlightedEditor?.classList.contains("memory-contents-expanded-editor--with-highlights")).toBe(false);
    expect(highlightedEditor?.value).toBe("Synthetic memory note for rereading old journals");
  });

  it("generates filesystem path filters from saved inspiration context", async () => {
    const constellationSignals: ApiSavedSignalSearchResult[] = [
      {
        ...sampleSavedSignals[0],
        id: "sig-note",
        textPreview: "Handwritten thought about rooms where making feels public",
        kind: "note",
        relatedContextTerms: ["public making rooms", "meaning_nodes", "context_node", "node id ctx_1234"],
        relatedTopOfMindNoteTitles: ["make the thing before explaining it"],
        attachmentSummary: [],
      },
      {
        ...sampleSavedSignals[0],
        id: "sig-link",
        textPreview: "Essay link about people who build in public",
        kind: "link",
        relatedContextTerms: ["public making rooms"],
        attachmentSummary: [
          { id: "att-link", type: "link", label: "https://example.com/public-building" },
        ],
      },
      {
        ...sampleSavedSignals[0],
        id: "sig-image",
        textPreview: "Image inspiration",
        kind: "image",
        relatedTopOfMindNoteTitles: [],
        relatedContextTerms: ["studio wall"],
        attachmentSummary: [
          { id: "att-image", type: "image", label: "studio-wall.png" },
        ],
      },
      {
        ...sampleSavedSignals[0],
        id: "sig-mixed",
        textPreview: "Mixed save with a note and a link about collaborators",
        kind: "mixed",
        relatedTopOfMindNoteTitles: [],
        relatedContextTerms: ["collaborators"],
        attachmentSummary: [
          { id: "att-mixed-link", type: "link", label: "https://example.com/collab" },
          { id: "att-mixed-file", type: "file", label: "notes.pdf" },
        ],
      },
    ];
    setApiFixtures({
      inspirations: constellationSignals.map((signal) => ({
        ...sampleInspirations[0],
        id: signal.id,
        text: signal.textPreview,
        kind: signal.kind as ApiInspiration["kind"],
        createdAt: signal.capturedAt,
        updatedAt: signal.updatedAt,
      })),
      savedSignals: constellationSignals,
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          relatedSignalIds: ["sig-note", "sig-link"],
          evidencePreviews: [],
          relatedSignals: [],
        },
      ],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, 4);
    await waitForTimers(130);
    await flushReactWork();

    const panel = container.querySelector<HTMLElement>(".memory-category-panel");
    const pathFilters = container.querySelector<HTMLElement>(".memory-path-filters");
    expect(panel).not.toBeNull();
    expect(pathFilters).not.toBeNull();
    expect(pathFilters?.textContent).toContain("all saved");
    expect(pathFilters?.textContent).toContain("recently saved");
    expect(pathFilters?.textContent).not.toContain("make the thing before explaining it");
    expect(pathFilters?.textContent).not.toMatch(/meaning[-_]?nodes?|context[-_]?nodes?|node id|ctx[-_]?1234/i);

    expect(pathFilters?.querySelectorAll(".memory-path-filter").length).toBe(2);
  });

  it("keeps drawer filters limited to the base pills", async () => {
    const categorySignals: ApiSavedSignalSearchResult[] = Array.from({ length: 8 }, (_, index) => ({
      ...sampleSavedSignals[0],
      id: `category-signal-${index + 1}`,
      textPreview: `Saved inspiration for path ${index + 1}`,
      capturedAt: `2026-05-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`,
      relatedTopOfMindNoteTitles: [],
      relatedContextTerms: [`category path ${index + 1}`],
      highlightedSnippets: [],
      matchingSnippets: [],
      attachmentSummary: [],
    }));
    setApiFixtures({
      inspirations: categorySignals.map((signal) => ({
        ...sampleInspirations[0],
        id: signal.id,
        text: signal.textPreview,
        createdAt: signal.capturedAt,
        updatedAt: signal.updatedAt,
      })),
      savedSignals: categorySignals,
      topOfMindNotes: [],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, categorySignals.length);
    await waitForTimers(130);
    await flushReactWork();

    const pathFilters = container.querySelector<HTMLElement>(".memory-path-filters");
    expect(pathFilters).not.toBeNull();
    const filterText = pathFilters?.textContent ?? "";
    expect(filterText).toContain("all saved");
    expect(filterText).toContain("recently saved");
    expect(filterText).not.toContain("category path 1");
    expect(filterText).not.toContain("more themes");
    expect(pathFilters?.querySelectorAll(".memory-path-filter").length).toBe(2);
  });

  it("shows a temporary top-of-mind filter when opened from the evidence slide", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    const evidenceSummary = note?.querySelector<HTMLButtonElement>(".nc-note-inspiration-slide");
    expect(evidenceSummary).not.toBeNull();

    await act(async () => {
      evidenceSummary?.click();
    });
    await flushReactWork();

    const pathFilters = container.querySelector<HTMLElement>(".memory-path-filters");
    expect(pathFilters?.textContent).toContain("top of mind");
    expect(pathFilters?.textContent).toContain("all saved");
    expect(pathFilters?.textContent).toContain("recently saved");
    expect(pathFilters?.querySelectorAll(".memory-path-filter").length).toBe(3);
  });

  it("keeps the drawer centered on desktop and full-bleed on phone CSS", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.memory-drawer-stack\s*\{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
    expect(css).toMatch(
      /\.memory-drawer-stack\s*\{[\s\S]*?--memory-drawer-bottom-clearance: clamp\(128px, 14vh, 168px\);[\s\S]*?inset: 0;[\s\S]*?width: 100vw;[\s\S]*?transform: none;[\s\S]*?animation: memoryDrawerOverlayIn/,
    );
    expect(css).toMatch(
      /\.memory-stack-level--categories\s*\{[\s\S]*?bottom: var\(--memory-drawer-bottom-clearance\);[\s\S]*?padding: clamp\(64px, 10vh, 96px\) clamp\(20px, 5vw, 56px\) 12px;/,
    );
    expect(css).toMatch(/\.memory-category-panel\s*\{[\s\S]*?width: min\(680px, 100%\);[\s\S]*?margin: 0 auto;/);
    expect(css).toMatch(/\.memory-path-list\s*\{[\s\S]*?width: min\(680px, 100%\);[\s\S]*?margin: 0 auto;/);
    expect(css).toMatch(
      /\.memory-contents-flow\s*\{[\s\S]*?max-height: calc\(100dvh - var\(--memory-drawer-bottom-clearance\)\);[\s\S]*?padding: clamp\(72px, 12vh, 130px\) 8px 24px;/,
    );
    expect(css).toMatch(
      /\.memory-contents-list--has-expanded li:has\(\.memory-contents-item:not\(\.memory-contents-item--expanded\)\)\s*\{[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.signal-revisit-page\.memory-drawer-stack\s*\{[\s\S]*?left: 0;[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.memory-stack-level--categories\s*\{[\s\S]*?bottom: 0;[\s\S]*?padding: 0;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.memory-category-panel\s*\{[\s\S]*?width: 100%;[\s\S]*?min-height: 100dvh;[\s\S]*?margin: 0;[\s\S]*?box-sizing: border-box;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.memory-path-panel \.memory-path-filters\s*\{[\s\S]*?position: sticky;[\s\S]*?top: calc\(12px \+ env\(safe-area-inset-top\)\);[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/,
    );
  });

  it("keeps the drawer stack visually neutral without decorative folder chrome or loud stack cards", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();

    const stack = container.querySelector<HTMLElement>(".memory-drawer-stack");
    expect(stack).not.toBeNull();
    expect(stack?.querySelector(".folder-icon")).toBeNull();
    expect(stack?.querySelector(".mac-folder-front")).toBeNull();
    expect(stack?.querySelector(".mac-folder-back")).toBeNull();
    expect(stack?.querySelector(".memory-category-column")).toBeNull();
    expect(container.querySelector(".memory-path-filter")).not.toBeNull();

    await openAllInspirations(container);

    const contents = container.querySelector<HTMLElement>(".memory-category-panel");
    expect(contents).not.toBeNull();
    expect(contents?.querySelectorAll(".memory-order-switcher").length).toBe(0);

    const stackCard = contents?.querySelector<HTMLElement>(".memory-contents-item");
    expect(stackCard).not.toBeNull();
    expect(stackCard?.classList.contains("memory-contents-item")).toBe(true);
    expect(stackCard?.className).not.toMatch(/reference-save|signal-revisit-card|memory-signal-card--(note|link|image|mixed)/);
    expect(stackCard?.querySelector(".memory-signal-card-kind")).toBeNull();
    expect(stackCard?.querySelector(".reference-save-link")).toBeNull();
    expect(stackCard?.querySelector(".reference-save-attachment")).toBeNull();
    expect(stackCard?.querySelector(".memory-contents-item-meta")).not.toBeNull();
  });

  it("does not render empty filler columns for one or two saves", async () => {
    setApiFixtures({
      savedSignals: [sampleSavedSignals[0]],
      inspirations: [sampleInspirations[0]],
      topOfMindNotes: [],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, 1);
    await waitForTimers(130);
    await flushReactWork();

    const columns = container.querySelectorAll(".memory-category-column");
    expect(columns).toHaveLength(0);
    expect(container.querySelector(".memory-bulletin-object")).toBeNull();
  });

  it("lists category column contents newest first", async () => {
    setApiFixtures({
      savedSignals: [
        {
          ...sampleSavedSignals[0],
          id: "sig-relevant-old",
          textPreview: "Old highlighted save about bridge rooms",
          capturedAt: "2026-04-01T12:00:00.000Z",
          relatedTopOfMindNoteTitles: [],
          relatedContextTerms: ["bridge rooms"],
          highlightedSnippets: [{ id: "spark-old", text: "bridge rooms", source: "user", confidence: 0.9, isPrimary: true }],
          signalScores: { resonance: 9, recurrence: 9, agency: 9, identitySignal: 9, decisionRelevance: 9 },
        },
        {
          ...sampleSavedSignals[1],
          id: "sig-recent-light",
          textPreview: "Recent lightly relevant save about a room",
          capturedAt: "2026-05-20T12:00:00.000Z",
          relatedTopOfMindNoteTitles: [],
          relatedContextTerms: ["bridge rooms"],
          highlightedSnippets: [{ id: "spark-new", text: "room", source: "user", confidence: 0.8, isPrimary: true }],
          signalScores: { resonance: 1, recurrence: 1, agency: 1, identitySignal: 1, decisionRelevance: 1 },
        },
      ],
    });
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    const contents = container.querySelector<HTMLElement>(".memory-category-panel");
    expect(contents?.textContent?.indexOf("Recent lightly relevant")).toBeLessThan(
      contents?.textContent?.indexOf("Old highlighted save") ?? 9999,
    );
  });

  it("keeps category contents inside the anchored stack", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    await openAllInspirations(container);

    const stack = container.querySelector<HTMLElement>(".memory-drawer-stack");
    const contents = container.querySelector<HTMLElement>(".memory-category-panel");
    expect(stack).not.toBeNull();
    expect(contents).not.toBeNull();
    expect(contents?.querySelector(".memory-contents-list")).not.toBeNull();
    expect(contents?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(contents?.textContent).toContain("Synthetic memory note");
    expect(container.querySelector(".memory-view-switcher")).toBeNull();
    expect(container.querySelector(".memory-flow-workspace")).toBeNull();
    expect(container.querySelector(".memory-window")).toBeNull();
  });

  it("searches the current all-inspirations list", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await clickSavesTab(container);

    const search = container.querySelector<HTMLInputElement>('.nc-drawer-search input[type="search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      setInputValue(search!, "synthetic");
    });
    await flushReactWork();
    const savesPageAfterSearch = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPageAfterSearch?.textContent).toContain("Synthetic memory note");
    expect(savesPageAfterSearch?.textContent).not.toContain("Architecture essay about bridge rhythms");
  });

  it("updates search results as the query changes", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await clickSavesTab(container);

    const search = container.querySelector<HTMLInputElement>('.nc-drawer-search input[type="search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      setInputValue(search!, "bridge");
    });
    await flushReactWork();
    const savesPageAfterSearch = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPageAfterSearch?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(savesPageAfterSearch?.textContent).not.toContain("Synthetic memory note");
  });

  it("opens an in-place saved inspiration revisit and records a revisit", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openBridgeDetail(container);

    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
  });

  it("opens the full saved inspiration in place inside the anchored stack", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);

    expect(container.querySelector(".memory-window")).toBeNull();
    expect(detail.textContent).not.toContain("highlighted scrap");
    expect(detail.classList.contains("memory-contents-item--expanded")).toBe(true);
    expect(detail.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(detail.textContent).toContain("bridge rhythms in city walks");
    expect(detail.textContent).not.toContain("highlighted by me");
    expect(detail.textContent).not.toContain("nearby piles");
    expect(detail.textContent).not.toContain("reflect on this inspiration");
    expect(detail.textContent).toContain("still alive");
    expect(detail.textContent).not.toContain("View next inspiration");
    expect(detail.textContent?.toLowerCase()).not.toContain("memory movement");
    expect(detail.textContent).not.toContain("related context");
  });

  it("renders the clicked memory drawer inspiration with a trimmed in-place detail surface", async () => {
    setApiFixtures({
      savedSignals: [
        {
          ...sampleSavedSignals[0],
          attachmentSummary: [{ id: "att-video", type: "link", label: "youtube.com" }],
        },
        sampleSavedSignals[1],
      ],
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        attachmentSummary: [{ id: "att-video", type: "link", label: "youtube.com" }],
        attachments: [
          {
            id: "att-video",
            type: "link",
            url: "https://www.youtube.com/watch?v=fVK6pYYTN5w&t=1s",
            label: "youtube.com/watch",
            contentType: null,
            size: null,
          },
        ],
      },
    });
    const container = await renderHomePage();
    await clickSavesTab(container);
    await waitForTimers(130);
    await openAllInspirations(container);

    const firstSave = container.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(firstSave).not.toBeNull();
    await act(async () => {
      firstSave?.click();
    });
    await flushReactWork();
    await flushReactWork();

    const detail = container.querySelector<HTMLElement>(".memory-contents-item--expanded");
    expect(detail).not.toBeNull();
    expect(detail?.querySelector(".memory-contents-collapse")).not.toBeNull();
    expect(detail?.querySelector(".memory-contents-item-meta")?.textContent).toContain("youtube.com");
    expect(detail?.textContent).not.toContain("https://www.youtube.com/watch?v=fVK6pYYTN5w&t=1s");
    expect(detail?.textContent).toContain("reflect");
    expect(detail?.textContent).not.toContain("what did this mean then?");
    expect(detail?.textContent).not.toContain("what does it mean now?");
    expect(detail?.textContent).not.toContain("does this still fit?");
    expect(detail?.textContent).not.toContain("attachment details");
    expect(detail?.textContent).not.toContain("nearby piles");
    expect(detail?.textContent).not.toContain("View next inspiration");
    expect(detail?.querySelector(".memory-detail-next")).toBeNull();
  });

  it("does not expose highlight controls in opened inspiration detail", async () => {
    const unhighlightedBridgeSignal = { ...sampleSavedSignals[0], highlightedSnippets: [] };
    setApiFixtures({
      savedSignals: [unhighlightedBridgeSignal, sampleSavedSignals[1]],
      savedSignalDetail: {
        ...sampleSavedSignalDetail,
        highlightedSnippets: [],
      },
    });
    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);
    const editor = detail.querySelector<HTMLTextAreaElement>(".memory-contents-expanded-editor");
    expect(editor).not.toBeNull();
    const highlightButton = Array.from(detail.querySelectorAll<HTMLButtonElement>(".memory-contents-secondary-action")).find(
      (button) => button.textContent === "highlight",
    );
    expect(highlightButton).toBeUndefined();
    const start = editor!.value.indexOf("bridge rhythms");
    editor!.setSelectionRange(start, start + "bridge rhythms".length);
    await act(async () => {
      editor?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector(".signal-revisit-highlights")).toBeNull();
    expect(detail.querySelector(".memory-inline-highlight")).toBeNull();
    expect(container.querySelector(".memory-highlight-popover--saved")).toBeNull();
  });

  it("replaces one stack inspiration detail with another without opening windows", async () => {
    setApiFixtures({
      topOfMindNotes: [
        {
          ...sampleTopOfMindNote,
          relatedSignalIds: ["insp-1", "insp-2"],
        },
      ],
    });
    const container = await renderHomePage();

    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    await openAllInspirations(container);
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item"));
    expect(cards.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      cards[0]?.click();
    });
    await flushReactWork();
    expect(container.querySelector(".memory-contents-item--expanded")?.textContent).toContain("Architecture essay");

    const back = container.querySelector<HTMLButtonElement>(".memory-contents-item--expanded .memory-contents-collapse");
    await act(async () => {
      back?.click();
    });
    await flushReactWork();
    const nextCards = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item"));
    await act(async () => {
      nextCards[1]?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".memory-contents-item--expanded")?.textContent).toContain("Synthetic memory note");
    expect(container.querySelectorAll(".memory-contents-item--expanded")).toHaveLength(1);
    expect(container.querySelector(".memory-window")).toBeNull();
  });

  it("opens capture from the floating action", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openCaptureModal(container);

    expect(container.querySelector(".reference-capture-modal")).not.toBeNull();
    expect(container.querySelector("#capNote")).not.toBeNull();
    expect(container.querySelector("#capSave")).not.toBeNull();
  });

  it("closes the capture modal without saving", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".reference-capture-close")?.click();
    });

    expect(container.querySelector(".reference-capture-modal--closing")).not.toBeNull();
    await waitForTimers(380);
    await flushReactWork();
    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    expect(createInspiration).not.toHaveBeenCalled();
  });

  it("toggles focus mode from the expand control in the capture bar", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openCaptureModal(container);
    expect(container.querySelector(".reference-capture-modal--expanded")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(container.querySelector(".reference-capture-modal--expanded")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(container.querySelector(".reference-capture-modal--expanded")).toBeNull();
  });

  it("persists a quick note capture through the current capture contract", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-quick-save", text: "Fast save without reflective friction", wowScore: 8 }),
    );
    const container = await renderHomePage();

    await openCaptureModal(container);
    const textarea = container.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      setInputValue(textarea!, "Fast save without reflective friction");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Fast save without reflective friction",
      kind: "note",
    });
  });

  it("offers Reflect Deeper only after the capture modal has saved", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-post-save", text: "A windowed studio signal", wowScore: 8 }),
    );
    vi.mocked(createReflection).mockResolvedValue({
      reflection: persistedReflection({
        id: "reflection-post-save",
        inspirationId: "insp-post-save",
        question: "Why did this matter right now?",
        answer: "The soft north light.",
      }),
      inspiration: { id: "insp-post-save", wowScore: 9 },
    });
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#capNote")!, "A windowed studio signal");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();
    expect(createInspiration).toHaveBeenCalledWith({
      text: "A windowed studio signal",
      kind: "note",
    });
    expect(container.querySelector("#capConfirm")?.textContent).toContain("Inspiration saved.");
    expect(container.querySelector("#reflectQ")?.textContent).toContain("Why did this matter right now?");
    expect(container.querySelector("#capBar")).toBeNull();
    expect(container.querySelector("#capSave")).toBeNull();
    expect(container.querySelector("#capReflectiveSave")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Done");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Reflect deeper");
    expect(createReflection).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#reflectAns")!, "The soft north light.");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();

    expect(createReflection).toHaveBeenCalledWith("insp-post-save", {
      question: "Why did this matter right now?",
      answer: "The soft north light.",
      skipped: false,
    });
  });

  it("confirms a quick save before closing from the optional reflection step", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-quick-save", text: "Fast save without reflective friction", wowScore: 8 }),
    );
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#capNote")!, "Fast save without reflective friction");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();

    // No in-cell mirror; save is confirmed before the optional reflection step.
    expect(container.querySelector(".cap-save-mirror")).toBeNull();
    expect(container.querySelector("#capConfirm")?.textContent).toContain("Inspiration saved.");
    expect(container.querySelector(".reference-capture-modal--closing")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#reflectLater")?.click();
    });
    await flushReactWork();
    expect(container.querySelector(".reference-capture-modal--closing")).not.toBeNull();

    await waitForTimers(380);
    await flushReactWork();

    // Surface is gone and the capture button flashes an ephemeral "saved".
    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    const savedButton = container.querySelector(".nc-save--saved");
    expect(savedButton).not.toBeNull();
    expect(savedButton?.textContent).toContain("Inspiration saved.");
  });

  it("shows a newly persisted quick save in the inspiration drawer list", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-quick-save", text: "Fast save without reflective friction", wowScore: 8 }),
    );
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#capNote")!, "Fast save without reflective friction");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();
    await clickSavesTab(container, 3);
    await openAllInspirations(container);

    expect(container.textContent).toContain("Fast save without reflective friction");
  });

  it("persists a typed URL as a link attachment and shows it in the inspiration drawer", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-link-save",
        text: "Read https://example.com/article before the next salon",
        kind: "link",
      }),
    );
    vi.mocked(finalizeAttachment).mockResolvedValue(
      persistedAttachment({
        id: "att-link-save",
        inspirationId: "insp-link-save",
        url: "https://example.com/article",
        name: "example.com/article",
      }),
    );
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLTextAreaElement>("#capNote")!,
        "Read https://example.com/article before the next salon",
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();
    await clickSavesTab(container, 3);
    await openAllInspirations(container);

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Read https://example.com/article before the next salon",
      kind: "mixed",
    });
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "link",
      inspirationId: "insp-link-save",
      url: "https://example.com/article",
      name: "example.com/article",
    });
    const newSave = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item")).find((save) =>
      save.textContent?.includes("Read https://example.com/article before the next salon"),
    );
    expect(newSave?.textContent).toContain("Read https://example.com/article before the next salon");
    expect(newSave?.textContent).toContain("example.com");
    expect(newSave?.textContent).not.toContain("MIXED");
    expect(newSave?.textContent).not.toContain("LINK");
  });

  it("uploads an image attachment through the presign pipeline and shows the saved image", async () => {
    setApiFixtures();
    const objectUrl = vi.fn(() => "blob:waka-photo-preview");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: objectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-image-save",
        text: "Image inspiration",
        kind: "image",
      }),
    );
    vi.mocked(presignAttachment).mockResolvedValue({
      uploadUrl: "https://uploads.example.com/photo.png",
      key: "users/user-1/photo.png",
      expiresAt: "2026-05-14T16:45:00.000Z",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": "5",
      },
    });
    vi.mocked(finalizeAttachment).mockResolvedValue(
      persistedAttachment({
        id: "att-image-save",
        inspirationId: "insp-image-save",
        type: "image",
        url: "",
        name: "photo.png",
        s3Key: "users/user-1/photo.png",
        contentType: "image/png",
        size: 5,
      }),
    );
    const container = await renderHomePage();
    const file = new File(["image"], "photo.png", { type: "image/png" });

    await openCaptureModal(container);
    const fileInput = container.querySelector<HTMLInputElement>("#capFile");
    expect(fileInput).not.toBeNull();
    await act(async () => {
      Object.defineProperty(fileInput!, "files", {
        configurable: true,
        value: [file],
      });
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();
    await clickSavesTab(container, 3);
    await openAllInspirations(container);

    expect(objectUrl).toHaveBeenCalledWith(file);
    expect(createInspiration).toHaveBeenCalledWith({
      text: "Image inspiration",
      kind: "image",
    });
    expect(presignAttachment).toHaveBeenCalledWith({
      filename: "photo.png",
      contentType: "image/png",
      size: 5,
    });
    expect(uploadToPresignedUrl).toHaveBeenCalledWith(
      "https://uploads.example.com/photo.png",
      file,
      {
        "Content-Type": "image/png",
        "Content-Length": "5",
      },
    );
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "image",
      inspirationId: "insp-image-save",
      key: "users/user-1/photo.png",
      name: "photo.png",
      contentType: "image/png",
      size: 5,
    });
    const newSave = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item")).find((save) =>
      save.textContent?.includes("Image inspiration"),
    );
    expect(newSave?.textContent).toContain("Image inspiration");
    expect(newSave?.textContent).not.toContain("(attachment-only inspiration)");
    expect(newSave?.textContent).toContain("photo.png");
    expect(newSave?.textContent).not.toContain("IMAGE");
  });

  it("keeps an image quick-save entry saved when attachment finalization fails gracefully", async () => {
    setApiFixtures();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:waka-photo-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({
        id: "insp-image-save-no-attachment",
        text: "Image with local upload trouble",
        kind: "image",
      }),
    );
    vi.mocked(presignAttachment).mockResolvedValue({
      uploadUrl: "https://uploads.example.com/photo.png",
      key: "users/user-1/photo.png",
      expiresAt: "2026-05-14T16:45:00.000Z",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": "5",
      },
    });
    vi.mocked(finalizeAttachment).mockRejectedValue(
      new Error("S3 object not found at the supplied key"),
    );
    const container = await renderHomePage();
    const file = new File(["image"], "photo.png", { type: "image/png" });

    await openCaptureModal(container);
    const noteInput = container.querySelector<HTMLTextAreaElement>("#capNote");
    const fileInput = container.querySelector<HTMLInputElement>("#capFile");
    expect(noteInput).not.toBeNull();
    expect(fileInput).not.toBeNull();
    await act(async () => {
      setInputValue(noteInput!, "Image with local upload trouble");
      Object.defineProperty(fileInput!, "files", {
        configurable: true,
        value: [file],
      });
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capSave")?.click();
    });
    await flushReactWork();

    const historyCard = Array.from(container.querySelectorAll<HTMLElement>(".history-item")).find(
      (card) => card.textContent?.includes("Image with local upload trouble"),
    );
    expect(historyCard).not.toBeNull();
    expect(historyCard?.textContent).toContain("photo.png");
    expect(historyCard?.textContent).not.toContain("IMAGE");
    expect(historyCard?.textContent).toContain("1 attachment failed to upload.");
    expect(historyCard?.textContent?.toLowerCase()).not.toContain("error");
    expect(historyCard?.textContent).not.toContain("save failed");

    await act(async () => {
      historyCard?.click();
    });
    await flushReactWork();
    const detail = container.querySelector<HTMLElement>(".detail-view");
    expect(detail?.textContent).not.toContain("1 attachment failed to upload.");
    expect(detail?.textContent?.toLowerCase()).not.toContain("error");
    expect(detail?.textContent).not.toContain("save failed");

    await clickSavesTab(container, 3);
    await openAllInspirations(container);

    const newSave = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item")).find((save) =>
      save.textContent?.includes("Image with local upload trouble"),
    );
    expect(newSave?.textContent).toContain("Image with local upload trouble");
    expect(newSave?.textContent).toContain("photo.png");
    expect(newSave?.textContent).not.toContain("IMAGE");
    expect(newSave?.textContent).toContain("1 attachment failed to upload.");
    expect(newSave?.textContent?.toLowerCase()).not.toContain("error");
    expect(newSave?.textContent).not.toContain("save failed");
  });

  it("keeps admin inspection as a gated route entry", async () => {
    vi.stubEnv("VITE_SHOW_INTERNAL_STATUS", "true");
    setApiFixtures();
    const container = await renderHomePage();

    const adminEntry = container.querySelector<HTMLAnchorElement>(".admin-entry-pill");
    expect(adminEntry).not.toBeNull();
    expect(adminEntry?.getAttribute("href")).toBe("/admin");
  });

  it("does not reintroduce the old internal WOW STATUS Home tab", async () => {
    vi.stubEnv("VITE_SHOW_INTERNAL_STATUS", "true");
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".internal-wow-status-table")).toBeNull();
    expect(container.textContent).not.toContain("WOW STATUS");
  });

  it("does not render the old multi-view Home switcher", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".home-view-switcher")).toBeNull();
    expect(container.querySelector(".inspiration-discovery-panel")).toBeNull();
  });

  it("renders all current Home assertions without relying on the removed named exports", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(HomePage).toBeTypeOf("function");
    expect(container.querySelector(".nc-mode")).toBeNull();
    expect(container.querySelector(".nc-drawer-object")).not.toBeNull();
    expect(container.textContent).toContain("capture inspiration");
  });
});
