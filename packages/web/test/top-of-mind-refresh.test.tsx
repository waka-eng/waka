// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY: `lib/api` scripts queue acceptance and status,
 * while `sessionStorage` and timers isolate persisted receipts and polling.
 * The real hook owns cancellation, retries and completion; no model runs.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, fetchTopOfMindRefresh, refreshTopOfMind, type ApiTopOfMindRefreshResult } from "../src/lib/api";
import { useTopOfMindRefresh } from "../src/lib/use-top-of-mind-refresh";
import { profileStorageKey } from "../src/lib/profile-storage";

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  refreshTopOfMind: vi.fn(), fetchTopOfMindRefresh: vi.fn(),
}));
const keyA = profileStorageKey({ accountId: "A", profileId: "person" }, "readingRefresh")!;
const keyB = profileStorageKey({ accountId: "B", profileId: "person" }, "readingRefresh")!;
const completed: ApiTopOfMindRefreshResult = { kind: "top_of_mind", topOfMindId: "artifact-2", version: 2, outcome: "changed" };
const receipt = { jobId: "request-A", requestVersion: "2" };
const pending = { status: "pending" as const, requestVersion: "2", completedVersion: "0", runAfter: null, result: null };
const done = { status: "succeeded" as const, requestVersion: "2", completedVersion: "2", runAfter: null, result: completed };
const onComplete = vi.fn(async (_result: ApiTopOfMindRefreshResult, _current: () => boolean) => {});
let host: HTMLDivElement;
let root: Root;
function Probe({ storageKey = keyA }: { storageKey?: string }) {
  const read = useTopOfMindRefresh({ storageKey, onComplete });
  return <><span>{read.phase}:{String(read.canResume)}</span><button onClick={() => void read.start()}>read</button></>;
}
const click = () => act(async () => host.querySelector("button")!.click());
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(refreshTopOfMind).mockResolvedValue(receipt);
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue(pending);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("waits for completion, then clears the saved receipt", async () => {
  await act(async () => root.render(<Probe />)); await click();
  expect(host.textContent).toContain("pending:true");
  expect(onComplete).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(keyA)!)).toEqual(receipt);
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue(done);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(host.textContent).toContain("changed:false");
  expect(onComplete).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(keyA)).toBeNull();
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
});

it.each(["unchanged", "empty"] as const)("reports %s as a completed outcome", async (outcome) => {
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue({ ...done, result: { ...completed, outcome } });
  await act(async () => root.render(<Probe />)); await click();
  expect(host.textContent).toContain(`${outcome}:false`);
  expect(onComplete).toHaveBeenCalledOnce();
});

it("resumes an existing receipt without enqueueing again", async () => {
  sessionStorage.setItem(keyA, "already-running");
  await act(async () => root.render(<Probe />));
  expect(refreshTopOfMind).not.toHaveBeenCalled();
  expect(fetchTopOfMindRefresh).toHaveBeenCalledWith("already-running", expect.any(AbortSignal), undefined);
  expect(host.textContent).toContain("pending:true");
});

it("retries failed status reads without buying another generation", async () => {
  vi.mocked(fetchTopOfMindRefresh).mockRejectedValue(new Error("offline"));
  await act(async () => root.render(<Probe />)); await click();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.textContent).toContain("error:true");
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue(done);
  await click();
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("changed:false");
});

it("does not confuse terminal failure or an expired receipt with success", async () => {
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue({ ...pending, status: "failed" });
  await act(async () => root.render(<Probe />)); await click();
  expect(host.textContent).toContain("failed:false");
  expect(onComplete).not.toHaveBeenCalled();
  vi.mocked(fetchTopOfMindRefresh).mockRejectedValue(new ApiError({ status: 404, message: "Missing" }));
  await click();
  expect(host.textContent).toContain("unknown:false");
  expect(onComplete).not.toHaveBeenCalled();
});

it("bounds hung status reads and preserves the same request for recovery", async () => {
  vi.mocked(fetchTopOfMindRefresh).mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<Probe />)); await click();
  await act(async () => vi.advanceTimersByTimeAsync(48_000));
  expect(host.textContent).toContain("error:true");
  expect(onComplete).not.toHaveBeenCalled();
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem(keyA)!)).toEqual(receipt);
});

it("does not accept an old identity's late response after switching profiles", async () => {
  sessionStorage.setItem(keyA, "old-request");
  let finish!: (value: typeof done) => void;
  vi.mocked(fetchTopOfMindRefresh).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe storageKey={keyA} />));
  await act(async () => root.render(<Probe storageKey={keyB} />));
  await act(async () => finish(done));
  expect(host.textContent).toContain("idle:false");
  expect(onComplete).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(keyA)).toBe("old-request");
  expect(sessionStorage.getItem(keyB)).toBeNull();
});

it("deduplicates repeated starts before the receipt arrives", async () => {
  let finish!: (value: typeof receipt) => void;
  vi.mocked(refreshTopOfMind).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await click(); await click();
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
  await act(async () => finish(receipt));
  expect(host.textContent).toContain("pending:true");
});

it("shows a scheduled read as waiting, then offers to check rather than declaring failure", async () => {
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue({ ...pending, runAfter: new Date(Date.now() + 3_600_000).toISOString() });
  await act(async () => root.render(<Probe />)); await click();
  expect(host.textContent).toContain("waiting:true");
  await act(async () => vi.advanceTimersByTimeAsync(130_000));
  expect(host.textContent).toContain("delayed:true");
  expect(onComplete).not.toHaveBeenCalled();
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValue(done);
  await click();
  expect(host.textContent).toContain("changed:false");
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
});

it("does not acknowledge an older completion on the same job; keeps checking the numbered receipt", async () => {
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValueOnce({ ...done, completedVersion: "1" }).mockResolvedValue(done);
  await act(async () => root.render(<Probe />)); await click();
  expect(onComplete).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(keyA)!)).toEqual(receipt);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(onComplete).toHaveBeenCalledOnce();
  expect(fetchTopOfMindRefresh).toHaveBeenLastCalledWith(receipt.jobId, expect.any(AbortSignal), receipt.requestVersion);
  expect(refreshTopOfMind).toHaveBeenCalledOnce();
});

it("resumes a numbered request and preserves versions larger than JavaScript numbers", async () => {
  const version = "9007199254740993";
  sessionStorage.setItem(keyA, JSON.stringify({ ...receipt, requestVersion: version }));
  vi.mocked(fetchTopOfMindRefresh).mockResolvedValueOnce({ ...done, requestVersion: version, completedVersion: "9007199254740992" })
    .mockResolvedValue({ ...done, requestVersion: version, completedVersion: version });
  await act(async () => root.render(<Probe />));
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(onComplete).toHaveBeenCalledOnce();
  expect(refreshTopOfMind).not.toHaveBeenCalled();
});
