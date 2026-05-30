// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFeedback,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
} from "../src/lib/api";
import { SavedSignalsArchivePage } from "../src/pages/SavedSignalsArchive";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchSavedSignals: vi.fn(async () => signalResults),
    fetchSavedSignalDetail: vi.fn(async () => signalDetail),
    createFeedback: vi.fn(async () => ({
      id: "feedback-1",
      userId: "user-1",
      targetType: "signal",
      targetId: "sig-1",
      value: "important",
      emotionLabel: null,
      correctionText: null,
      source: "user",
      metadata: {},
      createdAt: "2026-05-30T12:00:00.000Z",
      updatedAt: "2026-05-30T12:00:00.000Z",
    })),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signalResults: ApiSavedSignalSearchResult[] = [
  {
    id: "sig-1",
    userId: "user-1",
    textPreview: "A saved signal about private research rooms.",
    kind: "note",
    capturedAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z",
    resonanceScore: 87,
    signalScores: {
      resonance: 87,
      recurrence: 76,
      agency: 70,
      identitySignal: 72,
      decisionRelevance: 78,
    },
    highlightedSnippets: [
      {
        id: "spark-1",
        text: "who gets to think before they perform",
        source: "user_selected",
        confidence: 100,
        isPrimary: true,
      },
    ],
    matchingSnippets: ["private research rooms"],
    relatedContextTerms: ["environment: rooms for honest work", "tension: performance versus privacy"],
    relatedTopOfMindNoteTitles: ["Rooms for honest work keep returning"],
    attachmentSummary: [],
    relevanceReasons: ["highlight match", "context match"],
  },
];

const signalDetail: ApiSavedSignalDetail = {
  ...signalResults[0],
  rawText: "A saved signal about private research rooms and who gets to think before they perform.",
  attachments: [
    {
      id: "att-1",
      type: "link",
      url: "https://example.com/rooms",
      label: "Research rooms essay",
      contentType: null,
      size: null,
    },
  ],
  resonanceFeedback: [],
  signalPacket: {
    id: "packet-1",
    text: "waka.signal_packet.v1\nWHY_IT_MATTERS: private rooms keep recurring as an ambition environment.",
    primarySpark: "who gets to think before they perform",
    artifactExcerpt: "A saved signal about private research rooms.",
    updatedAt: "2026-05-29T12:20:00.000Z",
  },
  relatedContextNodes: [
    {
      id: "node-1",
      type: "environment",
      label: "rooms for honest work",
      description: "A place where builders can think before performing.",
      confidence: 84,
      evidenceReason: "The signal names the room and its social pressure.",
    },
  ],
  relatedTopOfMindNotes: [
    {
      id: "note-1",
      title: "Rooms for honest work keep returning",
      type: "pattern",
      body: "Several signals point to private rooms for thinking.",
      confidence: 88,
      status: "active",
    },
  ],
};

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

async function renderArchive(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SavedSignalsArchivePage)));
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 130));
  });
  await flushReactWork();
  await flushReactWork();

  return container;
}

describe("SavedSignalsArchivePage", () => {
  it("renders search controls, result evidence, and a saved-signal deep dive without WOW terminology", async () => {
    const container = await renderArchive();
    const text = container.textContent ?? "";

    expect(fetchSavedSignals).toHaveBeenCalledWith({
      q: undefined,
      filter: "all",
      sort: "recent",
      limit: 80,
    });
    expect(fetchSavedSignalDetail).toHaveBeenCalledWith("sig-1");
    expect(text).toContain("Search what hit");
    expect(text).toContain("Highlighted");
    expect(text).toContain("High resonance");
    expect(text).toContain("private research rooms");
    expect(text).toContain("who gets to think before they perform");
    expect(text).toContain("Current interpretation");
    expect(text).toContain("private rooms keep recurring");
    expect(text).toContain("Related context");
    expect(text).toContain("rooms for honest work");
    expect(text).toContain("Top-of-mind notes influenced");
    expect(text).toContain("Still matters");
    expect(text).not.toContain("WOW");
    expect(text).not.toContain("wow");
  });

  it("submits signal feedback from the deep-dive loop", async () => {
    const container = await renderArchive();
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Still matters",
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    expect(createFeedback).toHaveBeenCalledWith({
      targetType: "signal",
      targetId: "sig-1",
      value: "important",
    });
    expect(container.textContent).toContain("Saved: Still matters");
  });
});
