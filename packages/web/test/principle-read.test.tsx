// @vitest-environment jsdom
/** The API seam is scripted to verify loading failures and background completion.
 * WHAT THIS MOCKS, AND WHY: `lib/api/principles` supplies deterministic responses;
 * no server/model is needed to prove the component's refresh and error behavior.
 * Real SQL and room membership are covered by principle-flow.db.test.ts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrincipleRead } from "../src/components/PrincipleRead";
import { fetchPrincipleRead, requestPrincipleRead } from "../src/lib/api/principles";

vi.mock("../src/lib/api/principles", () => ({ fetchPrincipleRead: vi.fn(), requestPrincipleRead: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const ready = { phase: "ready" as const, eligible: true, signalCount: 3, topOfMindCount: 1 };
const principle = { id: "room-principle", statement: "Make room for experiments.", type: "maxim" as const,
  state: "held" as const, origin: "minted" as const, rank: 1, locked: false, heldSince: null,
  conflictsWithId: null, createdAt: "2026-09-22", citedSignals: [{ id: "room-signal", statement: "Shared experiments recur." }] };

describe("principle read", () => {
  it("explains withheld room principles without pretending the room has no history", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: {
      phase: "waiting", eligible: false, signalCount: 0, topOfMindCount: 0, restricted: true,
    } });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.textContent).toContain("Earlier principles are kept, but hidden until their sources are verified.");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });
  it("shows room progress and what members can do at each empty stage", async () => {
    vi.mocked(fetchPrincipleRead)
      .mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 1, topOfMindCount: 0 } })
      .mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 3, topOfMindCount: 0 } })
      .mockResolvedValue({ principles: [], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(host.textContent).toContain("1/3 shared patterns ready");
    expect(host.textContent).toContain("two current members");
    expect(host.textContent).toContain("At least one must also appear");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(host.textContent).toContain("The shared patterns are ready");
    expect(host.textContent).toContain("top of mind");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(host.textContent).toContain("No room principle has emerged yet");
    expect(host.textContent).toContain("read the current patterns");
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("checks immediately when refreshed room material arrives", async () => {
    vi.mocked(fetchPrincipleRead)
      .mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 2, topOfMindCount: 0 } })
      .mockResolvedValue({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 3, topOfMindCount: 0 } });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" refreshKey={0} />));
    expect(host.textContent).toContain("2/3 shared patterns ready");
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" refreshKey={1} />));
    expect(host.textContent).toContain("The shared patterns are ready");
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(2);
  });

  it("recovers from one failed first read without showing a retry button", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.textContent).toContain("Checking the room’s principles");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.textContent).toContain(principle.statement);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchPrincipleRead).toHaveBeenLastCalledWith("room-1");
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("offers retry only after repeated failures, then recovers", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn’t load the room");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain(principle.statement);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(4);
  });

  it("queues missing work once and displays completion without a page reload", async () => {
    vi.mocked(requestPrincipleRead).mockResolvedValue();
    vi.mocked(fetchPrincipleRead).mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "pending" } })
      .mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Looking for a room principle");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(host.textContent).toContain(principle.statement);
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
  });

  it("shows an ongoing room read without queueing the same work again", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: { ...ready, phase: "processing" } });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.textContent).toContain("Looking for a room principle");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(2);
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("does not fetch an inactive wall", async () => {
    await act(async () => root.render(<PrincipleRead groupId="room-2" active={false} locale="en-US" />));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchPrincipleRead).not.toHaveBeenCalled();
  });
});
