// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTopOfMindNotes } from "../src/lib/api";
import type { ApiTopOfMindNoteSurface } from "../src/lib/api";
import { TopOfMindSharePage } from "../src/pages/TopOfMindShare";

const mockAuthState = vi.hoisted(() => ({
  value: {
    user: {
      id: "user-1",
      email: "yun@example.com",
      name: "Yun Chung",
      preferredLocale: "en-US" as const,
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => null),
    updatePreferredLocale: vi.fn(),
  },
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => mockAuthState.value,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchTopOfMindNotes: vi.fn(async () => sampleNotes),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleNotes: ApiTopOfMindNoteSurface[] = [
  {
    id: "note-1",
    userId: "user-1",
    title: "Rooms for honest work keep returning",
    type: "pattern",
    body: "Saved signals keep pointing toward spaces where people can think before they perform.",
    prompt: "Where does this room already exist?",
    guidance: "Name one version that could be built this week.",
    confidence: 0.81,
    status: "active",
    relatedSignalIds: ["sig-1"],
    relatedContextNodeIds: ["node-1"],
    createdAt: "2026-05-30T12:00:00.000Z",
    updatedAt: "2026-05-30T12:00:00.000Z",
    source: "wow_moment_compatibility",
    isProvisional: true,
    legacy: {
      wowMomentId: "legacy-1",
      wowKind: "recurrence",
      wowScore: 91,
    },
    evidencePreviews: [
      {
        signalId: "sig-1",
        role: "anchor",
        reason: "The saved signal names the room pattern.",
        textPreview: "A note about private salons where builders admit what they are actually making.",
        kind: "note",
        createdAt: "2026-05-29T12:00:00.000Z",
        resonanceScore: 88,
      },
    ],
    relatedSignals: [],
  },
  {
    id: "note-2",
    userId: "user-1",
    title: "A question about who to think with",
    type: "question",
    body: "The next useful collaborator may be a reader, not another operator.",
    prompt: null,
    guidance: null,
    confidence: 0.67,
    status: "active",
    relatedSignalIds: [],
    relatedContextNodeIds: [],
    createdAt: "2026-05-30T12:00:00.000Z",
    updatedAt: "2026-05-30T12:00:00.000Z",
    source: "wow_moment_compatibility",
    isProvisional: true,
    legacy: {
      wowMomentId: "legacy-2",
      wowKind: "bridge",
      wowScore: 75,
    },
    evidencePreviews: [],
    relatedSignals: [],
  },
];

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

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

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderSharePage(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(TopOfMindSharePage)));
  });
  await flushReactWork();
  await flushReactWork();

  return container;
}

describe("TopOfMindSharePage", () => {
  it("explains WAKA while rendering current provisional top-of-mind notes", async () => {
    const container = await renderSharePage();
    const text = container.textContent ?? "";

    expect(fetchTopOfMindNotes).toHaveBeenCalledWith({ limit: 5 });
    expect(text).toContain("Yun's Top of Mind");
    expect(text).toContain("Most inspiration disappears.");
    expect(text).toContain("caught what almost slipped away");
    expect(text).toContain("They did not manually write this page.");
    expect(text).toContain("provisional reflections, tensions, questions, and action hints");
    expect(text).toContain("Rooms for honest work keep returning");
    expect(text).toContain("A note about private salons");
    expect(text).toContain("A question about who to think with");
    expect(text).not.toContain("WOW");
    expect(text).not.toContain("wow");
  });
});
