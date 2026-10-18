// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY: `lib/api/principles` supplies deterministic
 * responses; no server or model is needed to prove this component's refresh
 * and error behaviour. Real SQL is covered by `principle-flow.db.test.ts`.
 *
 * ═══ THIS SUITE WAS MOSTLY ABOUT A ROOM, AND ROOMS ARE GONE ═══════════════
 *
 * Founder, 2026-10-12: "방 없애" — remove rooms. `PrincipleRead` answered for
 * two spaces and the room half was the larger one, so eight cases here lost
 * their subject outright. They are named rather than silently dropped,
 * because each one pinned a real rule and somebody rebuilding shared values
 * will want the list:
 *
 *   WITHDRAWS CACHED ROOM PRINCIPLES WHEN ACCESS CANNOT BE VERIFIED, and
 *   EXPIRES THEM IF A BACKGROUND REFRESH NEVER ANSWERS. Together these were
 *   the strongest pair in the file: a shared read is permission-sensitive, so
 *   a failed revalidation BLANKED the rows rather than keeping the last good
 *   answer, and `GROUP_READ_TTL_MS` (30s) expired them even when nothing had
 *   changed — because a version number cannot tell you access was revoked.
 *
 *   EXPLAINS WITHHELD ROOM PRINCIPLES WITHOUT PRETENDING THE ROOM HAS NO
 *   HISTORY. "Earlier principles are kept, but hidden until their sources are
 *   verified" — the restricted branch, which refused to render an empty state
 *   over material that existed and was merely unreadable to you.
 *
 *   SHOWS ROOM PROGRESS AND WHAT MEMBERS CAN DO AT EACH EMPTY STAGE, and
 *   CHECKS IMMEDIATELY WHEN REFRESHED ROOM MATERIAL ARRIVES. The staged empty
 *   state: three shared patterns, then a reading, then a candidate, with a
 *   progressbar and a lead-and-detail sentence per stage; plus `refreshKey`,
 *   which re-read the moment the room's wall or board was refetched.
 *
 *   KEEPS PROTECTED WORDS WHILE DISPLAYING UNCONFIRMED SUPPORT. A room's
 *   values were LISTED by this component; yours are not — `onRead` hands them
 *   to `pages/Home`, which draws them in the sky. With the room list gone
 *   there is nowhere here for a protected statement to be shown, so the
 *   assertion had no element to make. The per-row sentences it checked
 *   (`worldPrincipleSupportChanged`, `worldPrincipleSupportUnconfirmed`) are
 *   still rendered, by the sky.
 *
 * WHAT REMAINS IS EVERY CASE THAT WAS NEVER ABOUT A ROOM: the support-check
 * states, the failure ladder, queueing the missing work exactly once, and
 * refusing to fetch for a wall nobody is standing on.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrincipleRead } from "../src/components/PrincipleRead";
import { fetchPrincipleRead, requestPrincipleRead } from "../src/lib/api/principles";
import { ApiError } from "../src/lib/api/http";

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
const principle = { id: "principle-1", statement: "Make room for experiments.", type: "maxim" as const,
  state: "held" as const, origin: "minted" as const, rank: 1, locked: false, heldSince: null,
  conflictsWithId: null, createdAt: "2026-09-22", citedSignals: [{ id: "signal-1", statement: "Experiments recur." }] };

describe("principle read", () => {
  it('shows queued support without asking for inspirations or generating on mount', async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: {
      ...ready, phase: 'pending', eligible: false, signalCount: 0, topOfMindCount: 0, supportPending: true,
    } });
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    expect(host.textContent).toContain('A support check is queued.');
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it('explicitly retries a failed support check even when current eligibility is below the bar', async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: {
      ...ready, phase: 'failed', eligible: false, signalCount: 0, topOfMindCount: 0, supportPending: true,
    } });
    vi.mocked(requestPrincipleRead).mockResolvedValue();
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    expect(host.textContent).toContain("Couldn't confirm current support. Your words are kept.");
    await act(async () => host.querySelector('button')!.click());
    /* THE RETRY FLAG IS THE WHOLE ARGUMENT, and it used to be the SECOND
       argument because the first was the room id. One parameter now. */
    expect(requestPrincipleRead).toHaveBeenCalledWith(true);
    expect(host.textContent).toContain('A support check is queued.');
  });

  it("hands the rows it read to its owner rather than listing them itself", async () => {
    /* WHO DRAWS YOUR VALUES: not this component. It reads them and calls
       `onRead`, and the sky in `pages/Home` renders them — which is why a
       successful read with rows in hand leaves this subtree silent. That was
       always true of your own wall and is now true of every wall, because a
       room was the one space whose values were listed here. */
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [principle], status: ready });
    const read = vi.fn();
    await act(async () => root.render(<PrincipleRead active locale="en-US" onRead={read} />));
    expect(read).toHaveBeenCalledWith([principle]);
    expect(host.textContent).not.toContain(principle.statement);
  });

  it("says your principles will form here while there are none", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: ready });
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    expect(host.textContent).toContain("Your principles will form here.");
  });

  it("recovers from one failed first read without showing a retry button", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ principles: [principle], status: ready });
    const read = vi.fn();
    await act(async () => root.render(<PrincipleRead active locale="en-US" onRead={read} />));
    expect(host.textContent).toContain("Loading principles…");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(read).toHaveBeenCalledWith([principle]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    /* NO ARGUMENT AT ALL now: it took the room id, and an absent room id was
       how the self path was spelled. There is one path. */
    expect(fetchPrincipleRead).toHaveBeenLastCalledWith();
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  it("offers retry only after repeated failures, then recovers", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ principles: [principle], status: ready });
    const read = vi.fn();
    await act(async () => root.render(<PrincipleRead active locale="en-US" onRead={read} />));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain("Principles could not be updated. Your saved words are still here.");
    await act(async () => host.querySelector("button")!.click());
    expect(read).toHaveBeenCalledWith([principle]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(4);
  });

  it("queues missing work once and displays completion without a page reload", async () => {
    vi.mocked(requestPrincipleRead).mockResolvedValue();
    vi.mocked(fetchPrincipleRead).mockResolvedValueOnce({ principles: [], status: { ...ready, phase: "pending" } })
      .mockResolvedValue({ principles: [principle], status: ready });
    const read = vi.fn();
    await act(async () => root.render(<PrincipleRead active locale="en-US" onRead={read} />));
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Reading the patterns for principles…");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(read).toHaveBeenCalledWith([principle]);
    expect(requestPrincipleRead).toHaveBeenCalledTimes(1);
  });

  it("shows an ongoing read without queueing the same work again", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: { ...ready, phase: "processing" } });
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    expect(host.textContent).toContain("Reading the patterns for principles…");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(2);
    expect(requestPrincipleRead).not.toHaveBeenCalled();
  });

  /* THE POLL HAS AN END. A job that died with its status still "processing"
     used to be re-read every ten seconds for as long as the tab stayed open,
     under "Reading…" forever. Thirty reads in, it stops, says so, and the
     same Try again a failure offers starts it over. */
  it("stops polling a read that never finishes, and says so with a retry", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: { ...ready, phase: "processing" } });
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    for (let i = 0; i < 40; i += 1) await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(30);
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain("This reading is taking longer than it should. Your saves are safe.");
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [principle], status: ready });
    await act(async () => host.querySelector("button")!.click());
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(31);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("asks the server to re-enqueue a stalled read when Try again is pressed, not only to poll again", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: { ...ready, phase: "processing" } });
    vi.mocked(requestPrincipleRead).mockResolvedValue();
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    for (let i = 0; i < 40; i += 1) await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(requestPrincipleRead).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(requestPrincipleRead).toHaveBeenCalledWith(true);
  });

  it("says a retry was tried moments ago when the server answers 429, not the generic failure", async () => {
    vi.mocked(fetchPrincipleRead).mockResolvedValue({ principles: [], status: { ...ready, phase: "failed" } });
    vi.mocked(requestPrincipleRead).mockRejectedValue(new ApiError({ status: 429, message: "soon", code: "reading_retry_throttled" }));
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    await act(async () => host.querySelector("button")!.click());
    expect(requestPrincipleRead).toHaveBeenCalledWith(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This was tried moments ago. Try again in a bit.");
  });

  it("stops polling after repeated failures until asked again", async () => {
    vi.mocked(fetchPrincipleRead).mockRejectedValue(new Error("down"));
    await act(async () => root.render(<PrincipleRead active locale="en-US" />));
    for (let i = 0; i < 20; i += 1) await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchPrincipleRead).toHaveBeenCalledTimes(6);
    expect(host.querySelector("button")?.textContent).toBe("Try again");
  });

  it("does not fetch an inactive wall", async () => {
    await act(async () => root.render(<PrincipleRead active={false} locale="en-US" />));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchPrincipleRead).not.toHaveBeenCalled();
  });
});
