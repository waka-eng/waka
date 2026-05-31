// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFeedback,
  createInspiration,
  finalizeAttachment,
  fetchInspirations,
  fetchReflections,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchTopOfMind,
  fetchTopOfMindNotes,
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
    updateInspiration: vi.fn(async () => {
      throw new Error("updateInspiration mock not configured");
    }),
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
    relatedTopOfMindNoteTitles: ["I need workrooms where making the thing is the default temperature."],
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
      title: "I need workrooms where making the thing is the default temperature.",
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
  title: "I need workrooms where making the thing is the default temperature.",
  ambitionDimension: "work",
  ambientSignal: "I need workrooms where making the thing is the default temperature.",
  matchedEnvironment: "A working culture where bridge rhythms become visible through repeated making.",
  antiEnvironment: "Work contexts that reward commentary while the real object stays abstract.",
  evidenceRationale: "Several saved signals cluster around city walks, architecture, and jazz history.",
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
  headline: "I need workrooms where making the thing is the default temperature.",
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
    const savesTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-mode-btn")).find(
      (button) => button.textContent === `memory drawer (${count})`,
    );
    expect(savesTab).not.toBeNull();
    await act(async () => {
      savesTab?.click();
    });
    await flushReactWork();
  }

  async function openBridgeDetail(container: HTMLElement): Promise<HTMLElement> {
    await clickSavesTab(container);
    await waitForTimers(130);
    await flushReactWork();
    const search = container.querySelector<HTMLInputElement>('.reference-saves-page input[type="search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      setInputValue(search!, "bridge");
    });
    const bridgeSave = container.querySelector<HTMLButtonElement>(".reference-save");
    expect(bridgeSave).not.toBeNull();
    expect(bridgeSave?.textContent).toContain("Architecture essay about bridge rhythms");
    await act(async () => {
      bridgeSave?.click();
    });
    await flushReactWork();
    await flushReactWork();
    const detail = container.querySelector<HTMLElement>(".signal-revisit-detail");
    expect(detail).not.toBeNull();
    return detail!;
  }

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
    expect(container.textContent).toContain("<script>alert(1)</script> Source title");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("image.png · 4 KB");

    const save = container.querySelector<HTMLButtonElement>(".reference-save");
    await act(async () => {
      save?.click();
    });
    await flushReactWork();

    expect(container.textContent).toContain("attachment context");
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
          text: "Link signal",
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
          text: "Image signal",
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
    expect(container.querySelector(".reference-save-kind")).toBeNull();
    const historyText = container.querySelector(".reference-saves-page")?.textContent ?? "";
    expect(historyText).toContain("Link signal");
    expect(historyText).toContain("Kyoto ramen note https://example.com/kyoto-guide");
    expect(historyText).toContain("Image signal");
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
    expect(container.textContent).toContain("river's top of mind");
    expect(container.textContent).toContain("Most inspiration disappears.");
    expect(container.textContent).toContain("five provisional post-its. not final. changed by new signals.");
  });

  it("names the primary product spaces without surfacing internal graph UI", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("top of mind");
    expect(container.textContent).toContain("memory drawer (2)");
    expect(container.querySelector<HTMLAnchorElement>("a[aria-label='Share']")?.getAttribute("href")).toBe(
      "/top-of-mind/share",
    );
    expect(container.querySelector(".admin-entry-pill")?.textContent).toBe("Debug");
    expect(container.textContent).not.toContain("meaning graph");
    expect(container.textContent).not.toContain("compatibility archive");
  });

  it("keeps top-of-mind notes primary when enough signals are available", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-stage")).not.toBeNull();
    expect(container.querySelector(".nc-mode-btn--active")?.textContent).toBe("top of mind");
    expect(container.textContent).toContain("I need workrooms where making the thing is the default temperature.");
    expect(container.textContent).toContain("ambition signal");
    expect(container.textContent).not.toContain("What WAKA noticed");
    expect(container.textContent).not.toContain("Dev-only inspect WOW fields");
  });

  it("reveals concise evidence signals and context claims for a top-of-mind note", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    expect(expanded).not.toBeNull();
    expect(expanded?.textContent).toContain("evidence signals");
    expect(expanded?.textContent).toContain("1 signal behind this");
    expect(expanded?.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(expanded?.textContent).toContain("This signal anchors the pattern.");
    expect(expanded?.textContent).toContain("internal frequency");
    expect(expanded?.textContent).toContain("matched environment");
    expect(expanded?.textContent).toContain("anti-environment");
    expect(expanded?.textContent).toContain("Several saved signals cluster around city walks");
    expect(expanded?.textContent).toContain("ambition dimension");
    expect(expanded?.textContent).toContain("work");
    expect(expanded?.textContent).toContain("I need workrooms where making the thing is the default temperature.");
    expect(expanded?.textContent).not.toContain("theme-1");
    expect(expanded?.textContent).not.toContain("meaning_nodes");
  });

  it("renders empty evidence states without exposing internal graph fields", async () => {
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

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const expanded = container.querySelector<HTMLElement>(".nc-note-modal");
    expect(expanded?.textContent).toContain("no signal evidence yet");
    expect(expanded?.textContent).toContain("This post-it does not have signal evidence attached yet.");
    expect(expanded?.textContent).toContain("ambition dimension");
    expect(expanded?.textContent).toContain("WAKA has not linked a durable context claim to this note yet.");
    expect(expanded?.textContent).not.toContain("meaning_nodes");
    expect(expanded?.textContent).not.toContain("context_node:");
  });

  it("submits compact feedback for a top-of-mind note optimistically", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const trueButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-feedback-btn")).find(
      (button) => button.textContent === "true",
    );
    expect(trueButton).not.toBeNull();

    await act(async () => {
      trueButton?.click();
    });
    await flushReactWork();

    expect(trueButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("saved");
    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "top_of_mind_note",
      targetId: "note-1",
      value: "true",
    });
  });

  it("sends optional correction text with expanded top-of-mind feedback", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    const note = container.querySelector<HTMLElement>(".nc-note");
    expect(note).not.toBeNull();

    await act(async () => {
      note?.click();
    });
    await flushReactWork();

    const correction = container.querySelector<HTMLTextAreaElement>(".nc-note-correction textarea");
    expect(correction).not.toBeNull();
    await act(async () => {
      setInputValue(correction!, "This is closer if it mentions the workshop.");
    });
    const partlyButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-modal .nc-note-feedback-btn")).find(
      (button) => button.textContent === "partly",
    );
    expect(partlyButton).not.toBeNull();

    await act(async () => {
      partlyButton?.click();
    });
    await flushReactWork();

    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "top_of_mind_note",
      targetId: "note-1",
      value: "partly",
      correctionText: "This is closer if it mentions the workshop.",
    });
    expect(partlyButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("surfaces top-of-mind feedback failures without keeping optimistic state", async () => {
    vi.mocked(createFeedback).mockRejectedValueOnce(new Error("offline"));
    setApiFixtures();
    const container = await renderHomePage();
    const notTrueButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nc-note-feedback-btn")).find(
      (button) => button.textContent === "not true",
    );
    expect(notTrueButton).not.toBeNull();

    await act(async () => {
      notTrueButton?.click();
    });
    await flushReactWork();

    expect(notTrueButton?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("could not save feedback");
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
    expect(container.querySelector(".nc-mode-btn--active")?.textContent).toBe("top of mind");
    expect(container.textContent).toContain("When signals gather, provisional notes will appear here.");
    expect(container.querySelector(".nc-save")?.textContent).toContain("capture signal");
    expect(container.querySelector("#capNote")).toBeNull();
  });

  it("falls back to graph preview notes while top-of-mind note persistence is empty", async () => {
    setApiFixtures({ topOfMindNotes: [] });
    const container = await renderHomePage();

    expect(container.textContent).toContain("rooms where people can be honest before they are impressive");
    expect(container.textContent).toContain("ambition signal");
    expect(container.textContent).not.toContain("What WAKA noticed");
  });

  it("renders the Home authorship footnote for the signed-in user", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("This page was not written by river.");
    expect(container.textContent).toContain("— Ⓒ WAKA, 2026, for minds that wander");
  });

  it("filters server-returned inspirations down to the authenticated user", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("memory drawer (2)");
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

    expect(container.textContent).toContain("river's top of mind");
    expect(container.textContent).toContain("떠오른 생각은 자주 사라집니다.");
    expect(container.textContent).toContain("I need workrooms where making the thing is the default temperature.");
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
  });

  it("switches to the in-place memory drawer surface from the top mode tabs", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);

    expect(container.querySelector(".reference-saves-page")).not.toBeNull();
    expect(container.querySelector(".signal-revisit-page")).not.toBeNull();
    expect(container.querySelector(".signal-archive-page")).toBeNull();
    expect(container.querySelector(".nc-mode-btn--active")?.textContent).toBe("memory drawer (2)");
    expect(container.textContent).toContain("Return to what once moved you.");
    expect(container.textContent).toContain("This is the drawer beneath the post-its");
  });

  it("lists the authenticated user's saved inspirations newest first", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);

    const savesPage = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPage?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(savesPage?.textContent).toContain("Synthetic memory note");
    expect(savesPage?.textContent).not.toContain("Other user save should never render");
  });

  it("searches the current all-inspirations list", async () => {
    setApiFixtures();
    const container = await renderHomePage();
    await clickSavesTab(container);

    const search = container.querySelector<HTMLInputElement>('.reference-saves-page input[type="search"]');
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

    const search = container.querySelector<HTMLInputElement>('.reference-saves-page input[type="search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      setInputValue(search!, "bridge");
    });
    await flushReactWork();
    const savesPageAfterSearch = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPageAfterSearch?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(savesPageAfterSearch?.textContent).not.toContain("Synthetic memory note");
  });

  it("opens an in-place saved signal revisit and records a revisit", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await openBridgeDetail(container);

    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("insp-1");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
  });

  it("shows the raw signal, highlights, interpretation, and related top-of-mind notes in-place", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);

    expect(detail.textContent).toContain("what once hit");
    expect(detail.textContent).toContain("Architecture essay about bridge rhythms in city walks");
    expect(detail.textContent).toContain("bridge rhythms in city walks");
    expect(detail.textContent).toContain("what it may reveal now");
    expect(detail.textContent).toContain("I need workrooms where making the thing is the default temperature.");
  });

  it("lets users mark whether a revisited signal still matters", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);
    const stillAlive = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Still alive",
    );
    expect(stillAlive).not.toBeNull();
    await act(async () => {
      stillAlive?.click();
    });
    await flushReactWork();

    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "signal",
      targetId: "insp-1",
      value: "important",
    });
    expect(detail.textContent).toContain("Saved: Still alive");
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

    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    expect(createInspiration).not.toHaveBeenCalled();
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

  it("closes capture and increments the all-signals count after a quick save", async () => {
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

    expect(container.querySelector(".reference-capture-modal")).toBeNull();
    expect(container.textContent).toContain("memory drawer (3)");
  });

  it("shows a newly persisted quick save in the all-signals list", async () => {
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

    expect(container.textContent).toContain("Fast save without reflective friction");
  });

  it("persists a typed URL as a link attachment and shows it in all signals", async () => {
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
    const newSave = container.querySelector<HTMLButtonElement>(".reference-save");
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
        text: "Image signal",
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

    expect(objectUrl).toHaveBeenCalledWith(file);
    expect(createInspiration).toHaveBeenCalledWith({
      text: "Image signal",
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
    const newSave = container.querySelector<HTMLButtonElement>(".reference-save");
    expect(newSave?.textContent).toContain("Image signal");
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
    expect(detail?.textContent).toContain("1 attachment failed to upload.");
    expect(detail?.textContent?.toLowerCase()).not.toContain("error");
    expect(detail?.textContent).not.toContain("save failed");

    await clickSavesTab(container, 3);

    const newSave = container.querySelector<HTMLButtonElement>(".reference-save");
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
    expect(container.querySelector(".nc-mode")).not.toBeNull();
    expect(container.textContent).toContain("capture signal");
  });
});
