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
  it("shows room progress and what members can do at each empty stage", async () => {
    vi.mocked(fetchPrincipleRead)
      .mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 1, topOfMindCount: 0 } })
      .mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "waiting", eligible: false, signalCount: 3, topOfMindCount: 0 } })
      .mockResolvedValue({ principles: [], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(host.textContent).toContain("1/3 shared patterns ready");
    expect(host.textContent).toContain("two current members");
    expect(host.textContent).toContain("WAKA can suggest a principle");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).toContain("Three shared patterns are ready");
    expect(host.textContent).toContain("top of mind");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).toContain("no principle is clear yet");
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("shows a load failure and retries instead of presenting an empty room", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be updated");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain(principle.statement);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchPrincipleRead).toHaveBeenLastCalledWith("room-1");
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("queues missing work once and displays completion without a page reload", async () => {
    vi.mocked(requestPrincipleRead).mockResolvedValue();
    vi.mocked(fetchPrincipleRead).mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "pending" } })
      .mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => root.render(<PrincipleRead groupId="room-1" active locale="en-US" />));
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Reading the patterns");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(host.textContent).toContain(principle.statement);
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
  });

  it("does not fetch an inactive wall", async () => {
    await act(async () => root.render(<PrincipleRead groupId="room-2" active={false} locale="en-US" />));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchPrincipleRead).not.toHaveBeenCalled();
  });
});
