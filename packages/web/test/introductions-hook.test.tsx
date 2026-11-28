// @vitest-environment jsdom
/**
 * THE INTRODUCTIONS HOOK, KEPT FRESH AND KEYED ON THE PERSON (code review of
 * design/introductions, 2026-11-27).
 *
 * After Not now or Done it keeps reading for a minute (a match pass was just
 * queued, and the next ask may follow), and when the signed-in profile
 * changes it starts from nothing and drops a read that was asked for the
 * previous person.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s four introduction verbs,
 * the only network the hook has. The hook is the shipped one, mounted in a
 * bare component.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { answerIntroduction, fetchIntroductions, type ApiIntroductionState } from "../src/lib/api";
import { useIntroductions, type Introductions } from "../src/lib/introductions";

vi.mock("../src/lib/api", () => ({
  fetchIntroductions: vi.fn(),
  setIntroductionConsent: vi.fn(async () => undefined),
  answerIntroduction: vi.fn(async () => ({ stage: "declined" })),
  markIntroductionSeen: vi.fn(async () => undefined),
}));

const state = (over: Partial<ApiIntroductionState>): ApiIntroductionState =>
  ({ available: true, consent: { enabled: true, answered: true }, offerConsent: false, introduction: null, ...over });

let host: HTMLDivElement, root: Root, seen: Introductions | null = null;
function Probe({ profileId }: { profileId: string | null }) { seen = useIntroductions(profileId); return null; }
const mount = async (profileId: string | null) => { await act(async () => root.render(<Probe profileId={profileId} />)); };
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(fetchIntroductions).mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); seen = null;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("keeps reading for a minute after Not now, so the next ask shows without a reload", async () => {
  vi.mocked(fetchIntroductions).mockResolvedValue(state({ introduction: { id: "i1", stage: "ask" } }));
  await mount("p1"); await flush();
  expect(seen?.stage).toBe("ask-match");
  vi.mocked(fetchIntroductions).mockResolvedValue(state({}));
  await act(async () => seen!.notNow()); await flush();
  expect(vi.mocked(answerIntroduction)).toHaveBeenCalledWith("i1", "no");
  expect(seen?.stage).toBe("declined");
  const before = vi.mocked(fetchIntroductions).mock.calls.length;
  vi.mocked(fetchIntroductions).mockResolvedValue(state({ introduction: { id: "i2", stage: "ask" } }));
  await flush(5_000);
  expect(vi.mocked(fetchIntroductions).mock.calls.length).toBeGreaterThan(before);
  expect(seen?.stage, "the next ask did not take the declined line's place").toBe("ask-match");
});

it("starts from nothing for a new profile, and drops a read asked for the previous one", async () => {
  let release: (value: ApiIntroductionState) => void = () => undefined;
  vi.mocked(fetchIntroductions).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await mount("p1");
  vi.mocked(fetchIntroductions).mockResolvedValue(state({}));
  await mount("p2"); await flush();
  await act(async () => release(state({ introduction: { id: "theirs", stage: "introduced", principle: "theirs" } })));
  await flush();
  expect(seen?.stage, "the previous person's introduction showed for the next").toBeNull();
  expect(seen?.principle).toBe("");
});

it("does nothing at all without the session's own profile", async () => {
  await mount(null); await flush(10_000);
  expect(vi.mocked(fetchIntroductions)).not.toHaveBeenCalled();
  expect(seen?.stage).toBeNull();
});

it("drops a read that was in flight when the person pressed Not now, so the ask never comes back", async () => {
  vi.mocked(fetchIntroductions).mockResolvedValue(state({ introduction: { id: "i1", stage: "ask" } }));
  await mount("p1"); await flush();
  expect(seen?.stage).toBe("ask-match");
  /* A read starts (the tab came back) and is still out when Not now lands. */
  let release: (value: ApiIntroductionState) => void = () => undefined;
  vi.mocked(fetchIntroductions).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const reads = vi.mocked(fetchIntroductions).mock.calls.length;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(vi.mocked(fetchIntroductions).mock.calls.length, "the in-flight read never started").toBe(reads + 1);
  vi.mocked(fetchIntroductions).mockResolvedValue(state({}));
  await act(async () => seen!.notNow()); await flush();
  await act(async () => release(state({ introduction: { id: "i1", stage: "ask" } })));
  await flush();
  expect(seen?.stage, "a stale read brought the ask back").toBe("declined");
});
