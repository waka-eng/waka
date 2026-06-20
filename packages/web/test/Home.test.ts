// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFeedback,
  createInspiration,
  createInspirationSpark,
  createReflection,
  deleteInspirationSpark,
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
import { HomePage } from "../src/pages/Home";

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
    createInspirationSpark: vi.fn(async (_inspirationId: string, input: any) => ({
      id: "spark-new",
      userId: "user-1",
      inspirationId: _inspirationId,
      text: input.text,
      source: input.source ?? "user_selected",
      startOffset: input.startOffset ?? null,
      endOffset: input.endOffset ?? null,
      confidence: input.confidence ?? 100,
      isPrimary: input.isPrimary ?? false,
      note: input.note ?? null,
      whatMovedUser: null,
      impliedValues: [],
      worldviewClaims: [],
      tensions: [],
      decisionRelevance: [],
      emotionalCharge: [],
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
    })),
    deleteInspirationSpark: vi.fn(async () => undefined),
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

describe("HomePage current home experience", () => {
  async function clickSavesTab(container: HTMLElement, count = 2): Promise<void> {
    const drawerObject = container.querySelector<HTMLButtonElement>(".nc-drawer-object");
    expect(drawerObject?.textContent).toContain(`${count} saved`);
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
    const detail = container.querySelector<HTMLElement>(".memory-stack-detail.signal-revisit-detail");
    expect(detail).not.toBeNull();
    return detail!;
  }

  it("keeps the Reflect Deeper analysis section hidden until a reflection exists", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([]);

    const container = await renderHomePage();
    const detail = await openBridgeDetail(container);

    expect(detail.textContent).toContain("Reflect Deeper");
    expect(detail.textContent).not.toContain("No deeper reflection yet.");
    expect(detail.querySelector('[aria-label="Reflect Deeper analysis"]')).toBeNull();
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
    expect(detail.textContent).toContain("Inspiration details");
    expect(detail.textContent).toContain("Reflect Deeper analysis");
    expect(detail.textContent).not.toContain("2 of 2 answered");
    expect(detail.textContent).toContain("Read against the original inspiration");
    expect(detail.textContent).toContain("What this reveals: Mossy light and imperfect ceramic edges.");
    expect(detail.textContent).toContain("A useful next thread: The Reflect Deeper transcript should be readable in detail.");
    expect(detail.textContent).not.toContain("Q1 What texture did this save point toward?");
    expect(detail.textContent).not.toContain("Answer Mossy light and imperfect ceramic edges.");
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
      button.textContent?.includes("Reflect Deeper"),
    );
    expect(reflectButton).not.toBeNull();

    await act(async () => {
      reflectButton!.click();
    });
    const answer = detail.querySelector<HTMLTextAreaElement>("textarea.reflect-answer");
    expect(answer).not.toBeNull();
    await act(async () => {
      setInputValue(answer!, "Keep the memory drawer answer visible.");
    });
    const save = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "Save",
    );
    expect(save).not.toBeNull();
    await act(async () => {
      save!.click();
      await Promise.resolve();
    });
    expect(detail.textContent).toContain("A useful next thread: Keep the memory drawer answer visible.");

    await act(async () => {
      delayedReflections.resolve([]);
      await delayedReflections.promise;
    });

    expect(detail.textContent).toContain("A useful next thread: Keep the memory drawer answer visible.");
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
      button.textContent?.includes("Reflect Deeper"),
    );
    expect(reflectButton).not.toBeNull();

    await act(async () => {
      reflectButton!.click();
    });
    const answer = detail.querySelector<HTMLTextAreaElement>("textarea.reflect-answer");
    expect(answer).not.toBeNull();

    await act(async () => {
      setInputValue(answer!, "It wants the bridge rhythm to become a daily walk.");
    });
    const save = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "Save",
    );
    expect(save).not.toBeNull();
    await act(async () => {
      save!.click();
      await Promise.resolve();
    });
    await flushReactWork();

    expect(createReflection).toHaveBeenCalledWith("insp-1", {
      question: "What does this inspiration ask you to notice next?",
      answer: "It wants the bridge rhythm to become a daily walk.",
    });
    expect(createInspiration).not.toHaveBeenCalled();
    expect(detail.textContent).toContain("Reflect Deeper analysis");
    expect(detail.textContent).toContain("A useful next thread: It wants the bridge rhythm to become a daily walk.");
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
    expect(container.textContent).not.toContain("image.png · 4 KB");
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
    expect(container.textContent).toContain("Most inspiration disappears.");
    expect(container.textContent).toContain("Waka caught what almost slipped away.");
    expect(container.textContent).not.toContain("They caught what almost slipped away.");
    expect(container.textContent).not.toContain("five provisional post-its. not final. changed by new saves.");
  });

  it("uses Korean home and capture chrome when preferred locale is Korean", async () => {
    setApiFixtures();
    mockAuthState.value.user.name = "qa";
    mockAuthState.value.user.preferredLocale = "ko-KR";
    const container = await renderHomePage();

    expect(container.querySelector(".nc-titlecard")?.textContent).toContain("qa님의 탑오브마인드");
    expect(container.querySelector(".nc-titlecard")?.textContent).not.toContain("qa's top of mind");
    expect(container.querySelector(".nc-bottom-hint")?.textContent).toBe(
      "영감을 기록하면 탑오브마인드 포스트잇이 만들어집니다.",
    );
    expect(container.querySelector(".nc-bottom-hint")?.textContent).not.toContain("Capture inspirations");
    expect(container.querySelector(".nc-stage")?.getAttribute("aria-label")).toBe("탑오브마인드 포스트잇 다섯 장");
    const adminEntry = container.querySelector(".admin-entry-pill");
    expect(adminEntry?.getAttribute("aria-label")).toBe("관리자 점검 도구 열기");
    expect(adminEntry?.textContent).toBe("점검");
    expect(adminEntry?.textContent).not.toContain("Debug");

    await openCaptureModal(container);
    const modal = container.querySelector<HTMLElement>(".reference-capture-modal");
    expect(modal?.getAttribute("aria-label")).toBe("영감 기록");
    expect(modal?.textContent).toContain("닫기");
    expect(modal?.querySelector(".cap-file-btn")?.getAttribute("title")).toBe("이미지 첨부");
    expect(modal?.querySelector("#capExpand")?.getAttribute("aria-label")).toBe("집중 모드로 들어가기");
    expect(modal?.textContent).not.toContain("attach an image");
    expect(modal?.textContent).not.toContain("enter focus mode");
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

    const note = container.querySelector<HTMLElement>(".nc-note");
    await act(async () => {
      note?.click();
    });
    await flushReactWork();
    expect(container.querySelector(".nc-note-modal")?.textContent).not.toMatch(bannedInternalCopy);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".nc-note-peel-close")?.click();
    });
    await flushReactWork();
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

  it("treats collapsed post-its as intentional previews while keeping the full note in the modal", async () => {
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
    expect(note?.querySelector(".nc-note-body--preview")?.textContent).toBe(fullTitle);
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

    const expandedTitle = container.querySelector<HTMLTextAreaElement>(".nc-note-modal .nc-note-body-edit");
    expect(expandedTitle?.value).toBe(fullTitle);
    expect(container.querySelector(".nc-note-modal")?.textContent).not.toContain(
      "Several saved inspirations cluster around city walks",
    );
  });

  it("lets keyboard users open a collapsed post-it preview", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("role")).toBe("button");
    expect(note?.getAttribute("tabindex")).toBe("0");
    expect(note?.getAttribute("aria-label")).toBe("open post-it reflection");

    await act(async () => {
      note?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")?.getAttribute("role")).toBe("dialog");
    expect(container.querySelector(".nc-note-modal")?.textContent).toContain("inspirations that led here");
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

  it("opens a simplified top-of-mind post-it from the keyboard with inline evidence and updated actions", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("role")).toBe("button");
    expect(note?.getAttribute("tabindex")).toBe("0");
    expect(note?.getAttribute("aria-label")).toBe("open post-it reflection");

    await act(async () => {
      note?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    expect(expanded).not.toBeNull();
    expect(expanded?.classList.contains("nc-note-peel")).toBe(false);
    expect(expanded?.getAttribute("role")).toBe("dialog");
    expect(expanded?.textContent).not.toContain("opened post-it");
    expect(expanded?.textContent).not.toContain("short, provisional, easy to change");
    expect(expanded?.textContent).toContain("inspirations that led here");
    expect(expanded?.textContent).toContain("1 saved inspiration nearby");
    expect(expanded?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(expanded?.textContent).not.toContain("This inspiration anchors the pattern.");
    expect(expanded?.textContent?.toLowerCase()).not.toContain("memory movement");
    expect(expanded?.textContent).not.toContain("Several saved inspirations cluster around city walks");
    expect(expanded?.textContent).not.toContain("theme-1");
    expect(expanded?.textContent).not.toContain("meaning_nodes");

    const evidenceSection = container.querySelector<HTMLElement>(".nc-note-evidence");
    expect(evidenceSection).not.toBeNull();
    expect(evidenceSection?.classList.contains("nc-note-evidence--expanded")).toBe(false);
    expect(container.querySelector(".nc-note-evidence-open")).toBeNull();

    const inspirationButton = container.querySelector<HTMLButtonElement>(".nc-note-evidence-trigger");
    expect(inspirationButton?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      inspirationButton?.click();
    });
    await flushReactWork();
    expect(inspirationButton?.getAttribute("aria-expanded")).toBe("true");
    expect(expanded?.classList.contains("nc-note-modal--evidence-expanded")).toBe(true);
    expect(evidenceSection?.classList.contains("nc-note-evidence--expanded")).toBe(true);
    expect(container.querySelector(".nc-note-evidence-item--expanded .nc-note-evidence-detail")).not.toBeNull();
    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(expanded?.textContent).not.toContain("nearby passages");
    expect(expanded?.textContent).not.toContain("shares this context");
    expect(expanded?.textContent).not.toContain("also points at this post-it");
    expect(expanded?.textContent).not.toContain("nearby saves");
    expect(container.querySelector(".nc-note-related-block")).toBeNull();
    expect(container.querySelector(".nc-note-drawer-link")).toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--pin")?.textContent).toBe("PIN");
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--delete")?.textContent).toBe("delete");
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

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    const evidenceSection = container.querySelector<HTMLElement>(".nc-note-evidence");
    const evidenceTriggers = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-evidence-trigger"));
    expect(evidenceTriggers).toHaveLength(2);
    expect(evidenceTriggers[0].getAttribute("aria-expanded")).toBe("false");
    expect(evidenceTriggers[1].getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      evidenceTriggers[1].click();
    });
    await flushReactWork();

    expect(evidenceTriggers[0].getAttribute("aria-expanded")).toBe("false");
    expect(evidenceTriggers[1].getAttribute("aria-expanded")).toBe("true");
    expect(expanded?.classList.contains("nc-note-modal--evidence-expanded")).toBe(true);
    expect(evidenceSection?.classList.contains("nc-note-evidence--expanded")).toBe(true);
    const expandedItem = container.querySelector<HTMLElement>(".nc-note-evidence-item--expanded");
    expect(expandedItem?.textContent).toContain("Second inspiration about collaboration rooms and honest critique");
    const detailContainer = expandedItem?.querySelector<HTMLElement>(".nc-note-evidence-detail");
    expect(detailContainer).not.toBeNull();
    expect(detailContainer?.querySelector(".nc-note-evidence-open")?.textContent).toBe("open");
    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-2");
    expect(expanded?.textContent).not.toContain("also points at this post-it");
    expect(expanded?.textContent).not.toContain("nearby saves");
  });

  it("opens the saved inspiration detail from an expanded post-it evidence item", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-evidence-open")).toBeNull();

    const evidenceTrigger = container.querySelector<HTMLButtonElement>(".nc-note-evidence-trigger");
    expect(evidenceTrigger).not.toBeNull();

    await act(async () => {
      evidenceTrigger?.click();
    });
    await flushReactWork();

    const detailContainer = container.querySelector<HTMLElement>(".nc-note-evidence-detail");
    expect(detailContainer).not.toBeNull();
    const openButton = detailContainer?.querySelector<HTMLButtonElement>(".nc-note-evidence-open");
    expect(openButton).not.toBeNull();
    expect(openButton?.textContent).toBe("open");
    expect(openButton?.getAttribute("aria-label")).toBe("open inspiration");
    expect(openButton?.closest(".nc-note-evidence-detail")).toBe(detailContainer);

    await act(async () => {
      openButton?.click();
    });
    await flushReactWork();
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    const detail = container.querySelector<HTMLElement>(".memory-stack-detail--mockup");
    expect(detail).not.toBeNull();
    expect(detail?.getAttribute("aria-label")).toBe("opened inspiration");
    expect(detail?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(detail?.textContent).toContain("Inspiration details");
    expect(detail?.textContent).not.toContain("Signal packet");
    expect(detail?.textContent).not.toContain("what did this mean then?");
    expect(detail?.textContent).not.toContain("what does it mean now?");
    expect(detail?.textContent).not.toContain("does this still fit?");
    expect(detail?.textContent).not.toContain("attachment details");
    expect(detail?.textContent).not.toContain("nearby piles");
    expect(detail?.textContent).toContain("View next inspiration");
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

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const evidenceTrigger = container.querySelector<HTMLButtonElement>(".nc-note-evidence-trigger");
    expect(evidenceTrigger?.disabled).toBe(true);
    expect(evidenceTrigger?.textContent).toContain("preview");
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

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    expect(expanded?.textContent).toContain("inspirations that led here");
    expect(expanded?.textContent).toContain("saved inspirations stay private there");
    expect(expanded?.textContent).not.toContain("no saved inspiration attached yet");
    expect(expanded?.textContent).not.toContain("This post-it does not have saved inspiration attached yet.");
    expect(expanded?.textContent).not.toContain("ambition dimension");
    expect(expanded?.textContent).not.toContain("No deeper read has attached to this note yet.");
    expect(expanded?.textContent).not.toContain("meaning_nodes");
    expect(expanded?.textContent).not.toContain("context_node:");
  });

  it("removes old reaction buttons from the wall and opened post-it", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    expect(container.querySelector(".nc-note .nc-note-control-btn")).toBeNull();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    expect(expanded?.textContent).not.toContain("true");
    expect(expanded?.textContent).not.toContain("partly");
    expect(expanded?.textContent).not.toContain("not this");
    expect(expanded?.textContent).not.toContain("rewrite in my words");
    expect(expanded?.textContent).not.toContain("rewrite this post-it");
    expect(expanded?.textContent).not.toContain("pin wording");
    expect(expanded?.textContent).not.toContain("pull down");
    expect(expanded?.textContent).not.toContain("open memory drawer");
    expect(expanded?.textContent).toContain("delete");
  });

  it("persists an in-place Top of Mind rewrite using the user's wording", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const rewrite = container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit");
    expect(rewrite).not.toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    await act(async () => {
      setInputValue(rewrite!, "make rooms where rough drafts can breathe");
    });
    await flushReactWork();
    const pinButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-modal .nc-note-control-btn")).find(
      (button) => button.textContent === "save",
    );
    expect(pinButton).not.toBeNull();

    await act(async () => {
      pinButton?.click();
    });
    await flushReactWork();

    expect(container.textContent).toContain("make rooms where rough drafts can breathe");
    expect(container.textContent).toContain("saved");
    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "top_of_mind_note",
      targetId: "note-1",
      value: "partly",
      correctionText: "make rooms where rough drafts can breathe",
    });
  });

  it("deletes a Top of Mind post-it without showing a weak replacement", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-modal .nc-note-control-btn")).find(
      (button) => button.textContent === "delete",
    );
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".nc-note-modal")).toBeNull();
    expect(container.querySelectorAll(".nc-note")).toHaveLength(0);
    expect(container.textContent).toContain("When 2–3 related inspirations gather, provisional notes will appear here.");
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
    vi.mocked(createFeedback).mockRejectedValueOnce(new Error("offline"));
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();
    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const rewrite = container.querySelector<HTMLTextAreaElement>(".nc-note-body-edit");
    expect(rewrite).not.toBeNull();
    expect(container.querySelector(".nc-note-actions .nc-note-control-btn--save")).toBeNull();
    await act(async () => {
      setInputValue(rewrite!, "make the public room first");
    });
    await flushReactWork();
    const pinButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-modal .nc-note-control-btn")).find(
      (button) => button.textContent === "save",
    );
    expect(pinButton).not.toBeNull();

    await act(async () => {
      pinButton?.click();
    });
    await flushReactWork();

    const visiblePostItBodies = Array.from(container.querySelectorAll(".nc-note-body")).map(
      (body) => body.textContent ?? "",
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
    expect(container.textContent).toContain("When 2–3 related inspirations gather, provisional notes will appear here.");
    expect(container.querySelector(".nc-drawer-object")?.textContent).toContain("0 saved");
    expect(container.querySelector(".nc-save")?.textContent).toContain("capture inspiration");
    expect(container.querySelector("#capNote")).toBeNull();
  });

  it("falls back to graph preview notes while top-of-mind note persistence is empty", async () => {
    setApiFixtures({ topOfMindNotes: [] });
    const container = await renderHomePage();

    expect(container.textContent).toContain("rooms where people can be honest before they are impressive");
    expect(container.textContent).not.toContain("ambition signal");
    expect(container.textContent).not.toContain("What WAKA noticed");
  });

  it("removes the authorship footnote and keeps language switching top-right", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).not.toContain("This page was not written by river.");
    expect(container.textContent).not.toContain("— Ⓒ 2026, for minds that wander");
    expect(container.querySelector(".nc-footnote")).toBeNull();
    expect(container.querySelector(".nc-lang--top")).not.toBeNull();
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

  it("renders representative Korean home copy from the user locale", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("river님의 탑오브마인드");
    expect(container.textContent).not.toContain("river's top of mind");
    expect(container.textContent).toContain("떠오른 생각은 자주 사라집니다.");
    expect(container.textContent).toContain("make the thing before explaining it");
  });

  it("localizes the logout affordance in Korean", async () => {
    mockAuthState.value.user.preferredLocale = "ko-KR";
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector<HTMLButtonElement>("button[aria-label^='로그아웃']")?.title).toBe(
      "River 로그아웃",
    );
  });

  it("lets the language buttons persist a Korean locale preference", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const koreanButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-lang-btn")).find(
      (button) => button.textContent === "한",
    );

    expect(koreanButton).not.toBeNull();
    await act(async () => {
      koreanButton?.click();
    });
    expect(mockAuthState.value.updatePreferredLocale).toHaveBeenCalledWith("ko-KR");
    expect(container.textContent).toContain("떠오른 생각은 자주 사라집니다.");
    expect(container.textContent).toContain("Waka가 사라지기 전에 붙잡은 조각들이");
  });

  it("keeps the inspiration evidence sticky text large enough to read", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.nc-note-evidence-head p\s*\{[\s\S]*?font-size:\s*17px;/);
    expect(css).toMatch(/\.nc-note-evidence-trigger span\s*\{[\s\S]*?font-size:\s*17px;/);
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
    expect(columns?.textContent).toContain("2 saves");
    expect(container.querySelector(".memory-path-filter--active")?.textContent).toContain("all saved");

    const firstInspiration = columns?.querySelector<HTMLButtonElement>(".memory-contents-item");
    expect(firstInspiration).not.toBeNull();
    await act(async () => {
      firstInspiration?.click();
    });
    await flushReactWork();

    expect(stack?.querySelector(".memory-category-panel")).toBeNull();
    const detail = stack?.querySelector<HTMLElement>(".memory-stack-detail");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("Architecture essay about bridge rhythms");
    const detailBack = detail?.querySelector<HTMLButtonElement>(".memory-workspace-back");
    expect(detailBack?.textContent).toContain("← back to all saved");
    expect(detailBack?.textContent).not.toContain("map");
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
    expect(pathFilters?.textContent).toContain("make the thing before explaining it");
    expect(panel?.textContent).toContain("2 saves");
    expect(contents).toBeNull();
    expect(container.querySelector(".nc-drawer-search input")).not.toBeNull();
    expect(panel?.textContent?.indexOf("Architecture essay")).toBeLessThan(
      panel?.textContent?.indexOf("Synthetic memory note") ?? 9999,
    );
    expect(drawer?.querySelector(".signal-memory-lenses")).toBeNull();
    expect(drawer?.textContent?.toLowerCase()).not.toContain("keeps coming back");
    expect(drawer?.textContent?.toLowerCase()).not.toContain("memory movement");
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
    expect(pathFilters?.textContent).toContain("make the thing before explaining it");
    expect(pathFilters?.textContent).toContain("recently saved");
    expect(pathFilters?.textContent).not.toMatch(/meaning[-_]?nodes?|context[-_]?nodes?|node id|ctx[-_]?1234/i);

    const makingPath = Array.from(pathFilters?.querySelectorAll<HTMLButtonElement>(".memory-path-filter") ?? []).find(
      (button) => button.textContent?.includes("make the thing before explaining it"),
    );
    expect(makingPath).not.toBeNull();
    await act(async () => {
      makingPath?.click();
    });
    await flushReactWork();
    expect(panel?.textContent).toContain("2 inspirations sharing this path");
    expect(panel?.textContent).toContain("Handwritten thought about rooms where making feels public");
    expect(panel?.textContent).toContain("Essay link about people who build in public");
    expect(panel?.textContent).not.toContain("Image inspiration");
    expect(panel?.querySelector(".folder-icon")).toBeNull();
    expect(panel?.querySelector(".mac-folder-front")).toBeNull();
    expect(panel?.textContent).not.toMatch(/meaning_nodes|context_node|edge|node id/i);
    expect(panel?.textContent?.toLowerCase()).not.toContain("memory movement");
  });

  it("renders every filesystem path category with only its related inspirations", async () => {
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
    for (const signal of categorySignals) {
      const index = Number(signal.id.replace("category-signal-", ""));
      expect(filterText).toContain(`category path ${index}`);
    }
    expect(pathFilters?.querySelectorAll(".memory-path-filter").length).toBeGreaterThanOrEqual(categorySignals.length + 2);
  });

  it("keeps the drawer and filesystem list centered across desktop and phone CSS", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.memory-drawer-stack\s*\{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
    expect(css).toMatch(
      /\.memory-drawer-stack\s*\{[\s\S]*?--memory-drawer-bottom-clearance: clamp\(156px, 20vh, 220px\);[\s\S]*?inset: 0;[\s\S]*?width: 100vw;[\s\S]*?transform: none;[\s\S]*?animation: memoryDrawerOverlayIn/,
    );
    expect(css).toMatch(
      /\.memory-stack-level--categories\s*\{[\s\S]*?bottom: var\(--memory-drawer-bottom-clearance\);[\s\S]*?padding: clamp\(64px, 10vh, 96px\) clamp\(20px, 5vw, 56px\) 24px;/,
    );
    expect(css).toMatch(/\.memory-category-panel\s*\{[\s\S]*?width: min\(680px, 100%\);[\s\S]*?margin: 0 auto;/);
    expect(css).toMatch(/\.memory-path-list\s*\{[\s\S]*?width: min\(680px, 100%\);[\s\S]*?margin: 0 auto;/);
    expect(css).toMatch(
      /\.memory-contents-flow\s*\{[\s\S]*?max-height: calc\(100dvh - var\(--memory-drawer-bottom-clearance\)\);[\s\S]*?padding: clamp\(72px, 12vh, 130px\) 8px 24px;/,
    );
    expect(css).toMatch(
      /\.memory-drawer-stack \.memory-stack-detail\s*\{[\s\S]*?max-height: calc\(100dvh - var\(--memory-drawer-bottom-clearance\)\);[\s\S]*?overflow: auto;[\s\S]*?padding: clamp\(66px, 11vh, 120px\) 8px 24px;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.signal-revisit-page\.memory-drawer-stack\s*\{[\s\S]*?left: 14px;[\s\S]*?width: auto;[\s\S]*?transform: none;/,
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
    expect(container.querySelector(".memory-category-panel")?.textContent).toContain("1 save");
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

  it("opens the full saved inspiration inside the anchored stack", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);

    expect(container.querySelector(".memory-window")).toBeNull();
    expect(detail.textContent).not.toContain("highlighted scrap");
    expect(detail.textContent).toContain("saved inspiration");
    expect(detail.classList.contains("signal-revisit-detail--open")).toBe(true);
    expect(detail.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(detail.textContent).toContain("bridge rhythms in city walks");
    expect(detail.textContent).not.toContain("highlighted by me");
    expect(detail.textContent).not.toContain("nearby piles");
    expect(detail.textContent).not.toContain("what did this mean then?");
    expect(detail.textContent).not.toContain("what does it mean now?");
    expect(detail.textContent).not.toContain("is this still me?");
    expect(detail.textContent).not.toContain("still alive");
    expect(detail.textContent).not.toContain("changed shape");
    expect(detail.textContent).not.toContain("not anymore");
    expect(detail.textContent).not.toContain("View next inspiration");
    expect(detail.textContent?.toLowerCase()).not.toContain("memory movement");
    expect(detail.textContent).not.toContain("related context");
  });

  it("renders the clicked memory drawer inspiration with the trimmed mockup detail surface", async () => {
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

    const detail = container.querySelector<HTMLElement>(".memory-stack-detail--mockup");
    expect(detail).not.toBeNull();
    expect(detail?.querySelector(".memory-detail-close")?.textContent).toContain("×");
    expect(detail?.querySelector(".memory-detail-hero")).not.toBeNull();
    expect(detail?.querySelector(".memory-detail-source-card")?.textContent).toContain("youtube.com/watch");
    expect(detail?.textContent).toContain("Link");
    expect(detail?.textContent).toContain("https://www.youtube.com/watch?v=fVK6pYYTN5w&t=1s");
    expect(detail?.textContent).toContain("Reflect Deeper");
    expect(detail?.textContent).not.toContain("what did this mean then?");
    expect(detail?.textContent).not.toContain("what does it mean now?");
    expect(detail?.textContent).not.toContain("does this still fit?");
    expect(detail?.textContent).not.toContain("attachment details");
    expect(detail?.textContent).not.toContain("nearby piles");
    expect(detail?.textContent).toContain("View next inspiration");
    expect(detail?.querySelector(".memory-detail-next")).not.toBeNull();
  });

  it("creates opened-inspiration highlights from a selection popover with reaction and note controls", async () => {
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
    const readable = detail.querySelector<HTMLElement>(".memory-readable-signal");
    expect(readable).not.toBeNull();

    const selection = {
      rangeCount: 1,
      toString: () => "bridge rhythms",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          top: 120,
          left: 80,
          width: 120,
          height: 18,
          right: 200,
          bottom: 138,
          x: 80,
          y: 120,
          toJSON: () => ({}),
        }),
      }),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockImplementation(() => selection);

    await act(async () => {
      readable?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const popover = container.querySelector<HTMLElement>(".memory-highlight-popover--selection");
    expect(popover).not.toBeNull();
    expect(popover?.style.getPropertyValue("--memory-highlight-top")).toBe("74px");
    expect(popover?.textContent).toContain("bridge rhythms");
    expect(popover?.textContent).toContain("taste");
    expect(container.querySelector(".signal-revisit-highlights")).toBeNull();

    await act(async () => {
      Array.from(popover?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent === "taste")
        ?.click();
    });
    const noteInput = popover?.querySelector<HTMLInputElement>("input");
    expect(noteInput).not.toBeNull();
    await act(async () => {
      setInputValue(noteInput!, "This is the standard I keep noticing.");
    });
    await act(async () => {
      popover?.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushReactWork();

    expect(createInspirationSpark).toHaveBeenCalledWith("insp-1", {
      text: "bridge rhythms",
      source: "user_selected",
      confidence: 100,
      isPrimary: false,
      note: `highlight_reaction:v1:${JSON.stringify({
        reaction: "taste",
        note: "This is the standard I keep noticing.",
      })}`,
    });
    expect(detail.querySelector(".memory-inline-highlight")?.textContent).toBe("bridge rhythms");

    const mark = detail.querySelector<HTMLElement>(".memory-inline-highlight");
    await act(async () => {
      mark?.focus();
    });
    const savedPopover = container.querySelector<HTMLElement>(".memory-highlight-popover--saved");
    expect(savedPopover?.textContent).toContain("edit reaction");
    expect(savedPopover?.textContent).toContain("expand note");
    await act(async () => {
      Array.from(savedPopover?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent === "remove")
        ?.click();
    });
    expect(deleteInspirationSpark).toHaveBeenCalledWith("insp-1", "spark-new");

    getSelectionSpy.mockRestore();
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
    expect(container.querySelector(".memory-stack-detail")?.textContent).toContain("Architecture essay");

    const back = container.querySelector<HTMLButtonElement>(".memory-stack-detail .memory-workspace-back");
    await act(async () => {
      back?.click();
    });
    await flushReactWork();
    const nextCards = Array.from(container.querySelectorAll<HTMLButtonElement>(".memory-contents-item"));
    await act(async () => {
      nextCards[1]?.click();
    });
    await flushReactWork();

    expect(container.querySelector(".memory-stack-detail")?.textContent).toContain("Synthetic memory note");
    expect(container.querySelectorAll(".memory-stack-detail")).toHaveLength(1);
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

  it("dismisses the capture modal when clicking outside the capture card", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      container.querySelector<HTMLElement>(".reference-capture-modal")?.click();
    });

    expect(container.querySelector(".reference-capture-modal--closing")).not.toBeNull();
    await waitForTimers(380);
    await flushReactWork();
    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    expect(createInspiration).not.toHaveBeenCalled();
  });

  it("keeps the capture modal open when clicking inside the capture card", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      container.querySelector<HTMLElement>(".reference-capture-shell")?.click();
      container.querySelector<HTMLTextAreaElement>("#capNote")?.click();
    });

    expect(container.querySelector(".reference-capture-modal")).not.toBeNull();
    expect(container.querySelector(".reference-capture-modal--closing")).toBeNull();
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

  it("advances and saves Reflect Deeper from the capture modal with all three answers", async () => {
    setApiFixtures();
    vi.mocked(createInspiration).mockResolvedValue(
      persistedInspiration({ id: "insp-guided-save", text: "A windowed studio signal", wowScore: 8 }),
    );
    vi.mocked(createReflection).mockResolvedValue({
      reflection: persistedReflection({
        id: "reflection-guided-save",
        inspirationId: "insp-guided-save",
        question: "Reflect deeper guided reflection",
        answer: "saved guided answer",
      }),
      inspiration: { id: "insp-guided-save", wowScore: 9 },
    });
    vi.mocked(generateGuidedReflectionQuestion)
      .mockResolvedValueOnce({ question: "What caught you first?", source: "model" })
      .mockResolvedValueOnce({ question: "What does it ask you to protect?", source: "model" })
      .mockResolvedValueOnce({ question: "What is the smallest next move?", source: "model" });
    const container = await renderHomePage();

    await openCaptureModal(container);
    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#capNote")!, "A windowed studio signal");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#capReflectiveSave")?.click();
    });
    await flushReactWork();
    expect(container.querySelector("#reflectQ")?.textContent).toContain("What caught you first?");
    expect(container.querySelector("#reflectQ")?.textContent).not.toContain("Step 1 of 3");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(container.querySelector("#capBar")).toBeNull();
    expect(container.querySelector("#capSave")).toBeNull();
    expect(container.querySelector("#capReflectiveSave")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Continue");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).not.toContain("Save");

    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#reflectAns")!, "The soft north light.");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();
    expect(container.querySelector("#reflectQ")?.textContent).toContain("What does it ask you to protect?");
    expect(container.querySelector("#reflectQ")?.textContent).not.toContain("Step 2 of 3");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");
    expect(container.querySelector("#capBar")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Continue");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).not.toContain("Save");

    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#reflectAns")!, "Protected quiet mornings.");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();
    expect(container.querySelector("#reflectQ")?.textContent).toContain("What is the smallest next move?");
    expect(container.querySelector("#reflectQ")?.textContent).not.toContain("Step 3 of 3");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("3");
    expect(container.querySelector("#capBar")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Save reflection");

    await act(async () => {
      setInputValue(container.querySelector<HTMLTextAreaElement>("#reflectAns")!, "Block tomorrow morning.");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "A windowed studio signal",
      kind: "note",
      reflections: [
        {
          question: "What caught you first?",
          answer: "The soft north light.",
          skipped: false,
        },
        {
          question: "What does it ask you to protect?",
          answer: "Protected quiet mornings.",
          skipped: false,
        },
        {
          question: "What is the smallest next move?",
          answer: "Block tomorrow morning.",
          skipped: false,
        },
      ],
    });
    expect(createReflection).not.toHaveBeenCalled();
  });

  it("closes the surface and flashes the capture button after a quick save", async () => {
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

    // No in-cell mirror; the surface begins closing immediately on a full save.
    expect(container.querySelector(".cap-save-mirror")).toBeNull();
    expect(container.querySelector(".reference-capture-modal--closing")).not.toBeNull();

    await waitForTimers(380);
    await flushReactWork();

    // Surface is gone and the capture button flashes an ephemeral "saved".
    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    const savedButton = container.querySelector(".nc-save--saved");
    expect(savedButton).not.toBeNull();
    expect(savedButton?.textContent).toContain("saved");
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
