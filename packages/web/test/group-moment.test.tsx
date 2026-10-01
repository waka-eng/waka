// @vitest-environment jsdom
/**
 * The selected room date names every event and reads the wording on both
 * sides of the room's version chain.
 * WHAT THIS MOCKS, AND WHY (gate G6): only `lib/api`, specifically its
 * versioned group top-of-mind client, is replaced. It supplies deterministic snapshots; this test keeps
 * the real history resolver and React component, with no server or canvas.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchGroupTopOfMind, type ApiGroupTimeline, type ApiGroupTopOfMind } from "../src/lib/api";
import { GroupMoment } from "../src/space-kinds/GroupMoment";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/api")>(),
  fetchGroupTopOfMind: vi.fn(),
}));

const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
const stop = { at: new Date(2026, 8, 12, 23, 59, 59, 999).getTime(), grain: "day" as const, label: "Sep 12" };
const timeline: ApiGroupTimeline = {
  versions: [
    { id: "v2", version: 2, status: "live", reason: "member_proposal", entryCount: 1, createdAt: at(12, 14) },
    { id: "v1", version: 1, status: "superseded", reason: "initial", entryCount: 1, createdAt: at(1, 10) },
  ],
  doorMarks: [{ profileId: "member-1", name: "Sora Kim", kind: "joined", occurredAt: at(12, 9) }],
};
const reading = (version: number, body: string) => ({
  topOfMind: { id: `tom-${version}`, version, status: version === 2 ? "live" : "superseded",
    reason: "initial", createdAt: at(version === 2 ? 12 : 1, 10) },
  entries: [{ id: `entry-${version}`, type: "pattern", body, belief: null, prompt: null,
    lockedAt: null, pinnedAt: null, sortOrder: 0, createdAt: at(1, 10), contributors: [] }],
}) as ApiGroupTopOfMind;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("shows all events on the date and the actual wording before and after", async () => {
  vi.mocked(fetchGroupTopOfMind).mockImplementation(async (_group, version) =>
    version === 1 ? reading(1, "We start with questions.") : reading(2, "We build through questions."));
  await act(async () => root.render(<GroupMoment groupId="room-1" timeline={timeline} stop={stop} locale="en-US" />));
  expect(host.textContent).toContain("Sora arrived");
  expect(host.textContent).toContain("a proposal carried");
  expect(host.textContent).toContain("Before");
  expect(host.textContent).toContain("We start with questions.");
  expect(host.textContent).toContain("After");
  expect(host.textContent).toContain("We build through questions.");
  expect(fetchGroupTopOfMind).toHaveBeenCalledTimes(2);
});

it("shows a door event without fetching a comparison when no reading changed", async () => {
  const doorOnly = { ...timeline, versions: [] };
  await act(async () => root.render(<GroupMoment groupId="room-1" timeline={doorOnly} stop={stop} locale="en-US" />));
  expect(host.textContent).toContain("Sora arrived");
  expect(host.textContent).not.toContain("Before");
  expect(fetchGroupTopOfMind).not.toHaveBeenCalled();
});

it("names the empty room before its first reading", async () => {
  const firstStop = { at: new Date(2026, 8, 1, 23, 59, 59, 999).getTime(), grain: "day" as const, label: "Sep 1" };
  vi.mocked(fetchGroupTopOfMind).mockResolvedValue(reading(1, "We start with questions."));
  await act(async () => root.render(<GroupMoment groupId="room-1" timeline={timeline} stop={firstStop} locale="en-US" />));
  expect(host.textContent).toContain("Nothing read together yet");
  expect(host.textContent).toContain("We start with questions.");
  expect(fetchGroupTopOfMind).toHaveBeenCalledTimes(1);
  expect(fetchGroupTopOfMind).toHaveBeenCalledWith("room-1", 1);
});

it("lets the viewer retry a failed historical read", async () => {
  vi.mocked(fetchGroupTopOfMind).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reading(2, "We build through questions."))
    .mockImplementation(async (_group, version) => version === 1
      ? reading(1, "We start with questions.") : reading(2, "We build through questions."));
  await act(async () => root.render(<GroupMoment groupId="room-1" timeline={timeline} stop={stop} locale="en-US" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("We build through questions.");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("distinguishes withheld history from an empty room and does not claim nothing changed", async () => {
  vi.mocked(fetchGroupTopOfMind).mockImplementation(async (_group, version) => ({
    ...reading(version!, "Still public"), restricted: true,
  }));
  await act(async () => root.render(<GroupMoment groupId="room-1" timeline={timeline} stop={stop} locale="en-US" />));
  expect(host.textContent).toContain("Some earlier wording is hidden until its sources are verified.");
  expect(host.textContent).toContain("Still public");
  expect(host.textContent).not.toContain("Nothing read together yet");
  expect(host.textContent).not.toContain("The wording stayed the same.");
});
