// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY: `lib/data` supplies a cited reflection and its
 * saved source; `lib/api` supplies the unrelated room/roster reads, and
 * `lib/auth-context` the viewer. `helpers/render-home` and
 * `helpers/canvas-stub` replace time, frames and drawing, not Home's behavior.
 */
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const FACTS = { inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] };
const signal = { id: "pattern-1", inspirationIds:['kept-1'], statement: "You prefer reversible steps.", status: "active" as const,
  confidence: 60, evidenceCount: 1, lastEvidenceMs: 1, createdMs: 1, locked: false, unsupported: false, sharedGroupIds: [] };

vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof import("../src/lib/api")>(), ...apiMockFrom(FACTS) }));
vi.mock("../src/lib/auth-context", async (original) => ({
  ...await original<typeof import("../src/lib/auth-context")>(),
  useOptionalAuth: () => ({ status: "authenticated", account: { id: "a", email: "owner@example.test" },
    profile: { id: VIEWER_ID, name: "Owner", type: "human" }, profiles: [] }),
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(), ...dataMockFrom(FACTS),
  loadSignals: async () => [signal],
  loadSignal: async () => ({ ...signal, evidence: [{ signalId: signal.id, inspirationId: "kept-1",
    preview: "An original capture", quote: "I can change course", quoteSource: "own",
    quoteReflectionId: "answer-1", reason: null, createdMs: 1 }] }),
  loadTopOfMind: async () => ({ id: "reading-1", version: 1, reason: "initial", createdMs: 1,
    entries: [{ id: "entry-1", type: "pattern", body: "You prefer reversible steps.", belief: null,
      prompt: null, pinned: false, locked: false, dismissed: false, sortOrder: 0, createdMs: 1,
      citedSignals: [{ id: signal.id, statement: signal.statement }] }] }),
  loadInspiration: async () => ({ id: "kept-1", text: "An original capture", preview: "An original capture",
    kind: "note", source: "app", isPublic: false, capturedMs: 1, updatedMs: 1, attachments: [], enrichment: [],
    reflectionCount: 1, reflections: [{ id: "answer-1", question: "Why?", skipped: false, createdMs: 2,
      answer: "I can change course without losing the work already done." }] }),
}));

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub(); setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => world?.unmount());

it("labels a reflected citation and opens that answer, not the parent capture", async () => {
  world = await mountWorld(FACTS);
  await act(async () => world.container.querySelector<HTMLElement>('.jar-wallcol[data-kind="self"] .jar-poster')!.click());
  const open = [...world.container.querySelectorAll<HTMLElement>(".jar-prov-open")].find((node) => node.textContent === "built from")!;
  await act(async () => open.click());
  const row = world.container.querySelector<HTMLButtonElement>(".jar-prov-row")!;
  expect(row.textContent).toContain("from your reflection");
  await act(async () => row.click());
  expect(world.container.querySelector(".jar-prov-room-full")?.textContent)
    .toContain("I can change course without losing the work already done.");
  expect(world.container.querySelector(".jar-prov-room-full")?.textContent).not.toContain("An original capture");
  expect(world.container.querySelector(".jar-prov-room")?.textContent).not.toContain("answer-1");
});
