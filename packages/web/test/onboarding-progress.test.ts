// @vitest-environment jsdom
/**
 * WHERE A PERSON IS IN ONBOARDING, and the first read across their answers.
 *
 * WHAT THIS MOCKS, AND WHY: nothing for the step rule and the marker — they
 * are pure functions over a count and the browser's storage. The first read
 * takes its HTTP calls as injected deps, so the order it asks in (each answer
 * past derivation, THEN the refresh, THEN the current read) is asserted on
 * the calls themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leadOf, requestFirstRead, withinBudget, type FirstReadDeps } from "../src/lib/first-read";
import {
  clearOnboardingMarker,
  onboardingStep,
  readOnboardingMarker,
  writeOnboardingMarker,
} from "../src/lib/onboarding-progress";
import type { ApiTopOfMind } from "../src/lib/api";

describe("onboardingStep", () => {
  it("asks the name first, then the intro, then the first question", () => {
    expect(onboardingStep({ saved: 0, marker: {}, hasName: false })).toEqual({ kind: "name" });
    expect(onboardingStep({ saved: 0, marker: { named: true }, hasName: true })).toEqual({ kind: "intro" });
    expect(onboardingStep({ saved: 0, marker: { named: true, introSeen: true }, hasName: true })).toEqual({ kind: "question", index: 0 });
  });

  it("resumes at the next unanswered question from the server's count, whatever the browser forgot", () => {
    expect(onboardingStep({ saved: 1, marker: {}, hasName: true })).toEqual({ kind: "question", index: 1 });
    expect(onboardingStep({ saved: 2, marker: {}, hasName: true })).toEqual({ kind: "question", index: 2 });
  });

  it("goes to the read once three answers exist", () => {
    expect(onboardingStep({ saved: 3, marker: {}, hasName: true })).toEqual({ kind: "reading" });
    expect(onboardingStep({ saved: 9, marker: {}, hasName: true })).toEqual({ kind: "reading" });
  });

  it("asks the name before anything else when the profile has none, however many answers exist", () => {
    /* Finishing sends the profile's name, and the server refuses an empty
       one — so a nameless profile past its answers was stuck for good. */
    expect(onboardingStep({ saved: 2, marker: { named: true, introSeen: true }, hasName: false })).toEqual({ kind: "name" });
    expect(onboardingStep({ saved: 3, marker: {}, hasName: false })).toEqual({ kind: "name" });
  });

  it("asks the name again when the profile has none, even if marked", () => {
    expect(onboardingStep({ saved: 0, marker: { named: true, introSeen: true }, hasName: false })).toEqual({ kind: "name" });
  });
});

describe("the onboarding marker", () => {
  beforeEach(() => window.localStorage.clear());

  it("is scoped to the account", () => {
    writeOnboardingMarker("acc-a", { named: true });
    writeOnboardingMarker("acc-a", { introSeen: true });
    expect(readOnboardingMarker("acc-a")).toEqual({ named: true, introSeen: true });
    expect(readOnboardingMarker("acc-b")).toEqual({});
    clearOnboardingMarker("acc-a");
    expect(readOnboardingMarker("acc-a")).toEqual({});
  });

  it("reads garbage as nothing", () => {
    window.localStorage.setItem("waka.onboarding:acc-a", "{not json");
    expect(readOnboardingMarker("acc-a")).toEqual({});
  });
});

const reading = (body: string): ApiTopOfMind => ({
  id: "t", version: 1, reason: "initial", createdAt: "",
  entries: [
    { id: "a", type: "pattern", body: "Dismissed", belief: null, prompt: null, locked: false, pinned: false, dismissed: true, sortOrder: 0, citedSignals: [], createdAt: "" },
    { id: "b", type: "pattern", body, belief: null, prompt: null, locked: false, pinned: false, dismissed: false, sortOrder: 1, citedSignals: [], createdAt: "" },
  ],
});

describe("the first read", () => {
  afterEach(() => vi.useRealTimers());

  it("leads with the first live entry", () => {
    expect(leadOf(reading("You keep choosing slow mornings."))).toBe("You keep choosing slow mornings.");
    expect(leadOf(null)).toBeNull();
  });

  it("waits for every answer to be past derivation, then asks for a read, then reads it", async () => {
    const calls: string[] = [];
    let clock = 0;
    const stages: Record<string, Array<"derivation" | "reading">> = { a: ["derivation", "reading"], b: ["reading"], c: ["derivation", "derivation", "reading"] };
    const deps: FirstReadDeps = {
      processing: vi.fn(async (id: string) => {
        calls.push(`processing:${id}`);
        const stage = stages[id]!.shift() ?? "reading";
        return { phase: stage === "reading" ? "waiting" : "processing", stage } as never;
      }),
      refresh: vi.fn(async () => { calls.push("refresh"); return { jobId: "job", requestVersion: "1" }; }),
      refreshStatus: vi.fn(async () => { calls.push("status"); return { status: "succeeded", runAfter: null, result: null } as never; }),
      current: vi.fn(async () => { calls.push("current"); return reading("Across the three."); }),
      wait: async (ms) => { clock += ms; },
      now: () => clock,
    };
    await expect(requestFirstRead("profile-1", ["a", "b", "c"], deps)).resolves.toBe("Across the three.");
    expect(calls).toEqual([
      "processing:a", "processing:a", "processing:b", "processing:c", "processing:c", "processing:c",
      "refresh", "status", "current",
    ]);
  });

  it("never rejects: a refused refresh is no read", async () => {
    const deps: FirstReadDeps = {
      processing: vi.fn(async () => ({ phase: "ready", stage: null }) as never),
      refresh: vi.fn(async () => { throw new Error("down"); }),
      refreshStatus: vi.fn(),
      current: vi.fn(),
      wait: async () => {},
      now: () => 0,
    };
    await expect(requestFirstRead("profile-2", ["a"], deps)).resolves.toBeNull();
  });

  it("gives up waiting at the budget and says so with null", async () => {
    vi.useFakeTimers();
    const never = new Promise<string | null>(() => {});
    const raced = withinBudget(never, 20_000);
    vi.advanceTimersByTime(19_999);
    let settled = false;
    void raced.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(raced).resolves.toBeNull();
  });
});
