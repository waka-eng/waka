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
    title: "I need places that quietly tell me to be braver.",
    ambitionDimension: "place",
    ambientSignal: "I need places that quietly tell me to be braver.",
    matchedEnvironment: "A city, studio, or room where honest work feels publicly reinforced.",
    antiEnvironment: "Settings that make ambition feel private, apologetic, or over-explained.",
    evidenceRationale: "Three saved signals are clustering around this frequency.",
    rejectedAlternativeInterpretation: null,
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
        textPreview: "RAW PRIVATE SIGNAL: private salons where builders admit what they are actually making.",
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
    title: "I want peers who make fast, public building feel normal.",
    ambitionDimension: "people",
    ambientSignal: "I want peers who make fast, public building feel normal.",
    matchedEnvironment: "People who make original thinking feel like a shared operating rhythm.",
    antiEnvironment: "Circles where permission, polish, or social caution arrives before motion.",
    evidenceRationale: "Two saved signals point toward a peer frequency.",
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
    expect(text).toContain("catches what moved Yunbefore it slips away");
    expect(text).toContain("what they may want to build");
    expect(text).toContain("who they want around them");
    expect(text).toContain("where they may need to be");
    expect(text).toContain("These post-its were not typed by Yun.");
    expect(text).toContain("savedcorrectedreturned tochanged shape");
    expect(text).toContain("The raw saved signals stay private.");
    expect(text).toContain("personal context is alive");
    expect(text).toContain("Five provisional post-its sit on top.");
    expect(container.querySelectorAll(".tom-share-postit")).toHaveLength(5);
    expect(text).toContain("I need places that quietly tell me to be braver.");
    expect(text).toContain("A city, studio, or room where honest work feels publicly reinforced.");
    expect(text).toContain("Settings that make ambition feel private");
    expect(text).toContain("1 saved signal shaped this read; the private saved moments stay inside WAKA.");
    expect(text).not.toContain("RAW PRIVATE SIGNAL");
    expect(text).not.toContain("private salons where builders admit");
    expect(text).toContain("still here because evidence keeps returning");
    expect(text).toContain("I want peers who make fast, public building feel normal.");
    expect(text).toContain("Waiting for a stronger signal to earn this spot.");
    expect(text).not.toContain("WOW");
    expect(text).not.toContain("wow");
  });
});
