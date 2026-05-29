// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInspiration,
  finalizeAttachment,
  fetchInspirations,
  fetchReflections,
  fetchTopOfMind,
  fetchWowMoments,
  presignAttachment,
  recordInspirationRevisit,
  updateInspiration,
  uploadToPresignedUrl,
} from "../src/lib/api";
import type {
  ApiAttachment,
  ApiInspiration,
  ApiReflection,
  ApiTopOfMind,
  ApiWowMoment,
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
    fetchWowMoments: vi.fn(async () => []),
    fetchReflections: vi.fn(async () => []),
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

const sampleWowMoments: ApiWowMoment[] = [
  {
    id: "wow-1",
    userId: "user-1",
    title: "Cities keep teaching through bridges",
    kind: "bridge",
    why: "Several saves connect architecture essays with walking routes and jazz history.",
    beliefStatement: "I keep learning through places I cross repeatedly.",
    reflectionQuestion: "What bridge keeps reappearing?",
    reflectionGuide: "Name what it connects, then choose one next crossing.",
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
        wowScore: 4,
      },
    ],
  },
];

const sampleTopOfMind: ApiTopOfMind = {
  generatedAt: "2026-05-12T12:00:00.000Z",
  headline: "Bridge ideas keep returning",
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
  wowMoments = sampleWowMoments,
}: {
  inspirations?: ApiInspiration[];
  topOfMind?: ApiTopOfMind;
  wowMoments?: ApiWowMoment[];
} = {}): void {
  vi.mocked(fetchInspirations).mockResolvedValue(inspirations);
  vi.mocked(fetchTopOfMind).mockResolvedValue(topOfMind);
  vi.mocked(fetchWowMoments).mockResolvedValue(wowMoments);
  vi.mocked(fetchReflections).mockResolvedValue([]);
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
      (button) => button.textContent === `all inspirations (${count})`,
    );
    expect(savesTab).not.toBeNull();
    await act(async () => {
      savesTab?.click();
    });
    await flushReactWork();
  }

  async function openBridgeDetail(container: HTMLElement): Promise<HTMLElement> {
    await clickSavesTab(container);
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
    const detail = container.querySelector<HTMLElement>(".detail-view");
    expect(detail).not.toBeNull();
    return detail!;
  }

  it("loads current Home data from inspirations, top-of-mind, and WOW endpoints", async () => {
    setApiFixtures();
    await renderHomePage();

    expect(fetchInspirations).toHaveBeenCalledTimes(1);
    expect(fetchTopOfMind).toHaveBeenCalledTimes(1);
    expect(fetchWowMoments).toHaveBeenCalledWith({ limit: 10 });
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
      wowMoments: [],
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

    expect(container.textContent).toContain("Attachment context");
    expect(container.textContent).toContain("example.com · URL source");
    expect(container.textContent).toContain("image/png · 4 KB · User-uploaded attachment");
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
      wowMoments: [],
    });
    const container = await renderHomePage();

    await clickSavesTab(container, 4);
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
    expect(container.textContent).toContain("river's top of mind");
    expect(container.textContent).toContain("Most inspiration disappears.");
    expect(container.textContent).toContain("not final. changes as new inspirations arrive.");
  });

  it("keeps meaning-graph top-of-mind primary when current WOW moments are available", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.querySelector(".nc-stage")).not.toBeNull();
    expect(container.querySelector(".nc-wow-panel")).not.toBeNull();
    expect(container.textContent).toContain("rooms where people can be honest before they are impressive");
    expect(container.textContent).toContain("What WAKA noticed");
    expect(container.textContent).toContain("Dev-only inspect WOW fields (1)");
  });

  it("renders WOW moments without replacing top-of-mind notes", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    expect(container.textContent).toContain("rooms where people can be honest before they are impressive");
    expect(container.textContent).toContain("What WAKA noticed");
    expect(container.textContent).toContain("Cities keep teaching through bridges");
    expect(container.textContent).toContain("Several saves connect architecture essays");
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

    expect(container.textContent).toContain("all inspirations (2)");
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
    expect(container.textContent).toContain("WAKA가 포착한 것");
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

  it("switches to the all-inspirations page from the top mode tabs", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    await clickSavesTab(container);

    expect(container.querySelector(".reference-saves-page")).not.toBeNull();
    expect(container.querySelector(".nc-mode-btn--active")?.textContent).toBe("all inspirations (2)");
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
    const savesPageAfterSearch = container.querySelector<HTMLElement>(".reference-saves-page");
    expect(savesPageAfterSearch?.textContent).toContain("Architecture essay about bridge rhythms");
    expect(savesPageAfterSearch?.textContent).not.toContain("Synthetic memory note");
  });

  it("opens a saved inspiration detail and records a revisit", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([
      persistedReflection({ id: "reflection-existing", answer: "This already helped once." }),
    ]);
    const container = await renderHomePage();

    await openBridgeDetail(container);

    expect(fetchReflections).toHaveBeenCalledWith("insp-1");
    expect(recordInspirationRevisit).toHaveBeenCalledWith("insp-1", "detail_opened");
  });

  it("shows existing reflections in the inspiration detail", async () => {
    setApiFixtures();
    vi.mocked(fetchReflections).mockResolvedValue([
      persistedReflection({ id: "reflection-existing", answer: "This already helped once." }),
    ]);
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);

    expect(detail.textContent).toContain("Inspiration details");
    expect(detail.textContent).toContain("This already helped once.");
  });

  it("opens saved inspirations as editable detail text instead of a static preview", async () => {
    setApiFixtures();
    const container = await renderHomePage();

    const detail = await openBridgeDetail(container);
    const detailsTextarea = detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="Inspiration details"]');

    expect(detailsTextarea).not.toBeNull();
    expect(detailsTextarea?.value).toBe("Architecture essay about bridge rhythms in city walks");
  });

  it("saves detail edits through updateInspiration", async () => {
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
    const detail = await openBridgeDetail(container);
    const detailsTextarea = detail.querySelector<HTMLTextAreaElement>('textarea[aria-label="Inspiration details"]');

    await act(async () => {
      setInputValue(detailsTextarea!, "Edited bridge rhythm note for the next walk");
    });
    const saveButton = Array.from(detail.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save details",
    );
    await act(async () => {
      saveButton?.click();
    });
    await flushReactWork();

    expect(updateInspiration).toHaveBeenCalledWith("insp-1", {
      text: "Edited bridge rhythm note for the next walk",
    });
    expect(detailsTextarea?.value).toBe("Edited bridge rhythm note for the next walk");
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

  it("closes capture and increments the all-inspirations count after a quick save", async () => {
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
    expect(container.textContent).toContain("all inspirations (3)");
  });

  it("shows a newly persisted quick save in the all-inspirations list", async () => {
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

  it("persists a typed URL as a link attachment and shows it in all inspirations", async () => {
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
    const newSave = container.querySelector<HTMLButtonElement>(".reference-save");
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
    expect(container.textContent).toContain("capture inspiration");
  });
});
