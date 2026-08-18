/**
 * The rule itself: how much of the shared model key one account may spend in
 * a rolling hour, and when a refused start becomes a permitted one.
 *
 * The rule's effect on the queue — deferring rather than dropping, and leaving
 * other accounts alone — is exercised in ./queue-model-budget.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  assessModelBudget,
  MODEL_BUDGET_JOBS_PER_ACCOUNT,
  MODEL_BUDGET_RELEASE_MARGIN_MS,
  MODEL_BUDGET_WINDOW_MS,
  modelBudgetWindowStart,
} from "./model-budget.js";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const MINUTE = 60 * 1_000;

describe("assessModelBudget", () => {
  it("lets a quiet account through", () => {
    const verdict = assessModelBudget(
      { startedInWindow: 0, oldestStartInWindow: null },
      NOW,
    );

    expect(verdict).toEqual({
      withinBudget: true,
      remaining: MODEL_BUDGET_JOBS_PER_ACCOUNT,
    });
  });

  it("lets the last slot in the window be used", () => {
    const verdict = assessModelBudget(
      {
        startedInWindow: MODEL_BUDGET_JOBS_PER_ACCOUNT - 1,
        oldestStartInWindow: new Date(NOW.getTime() - 30 * MINUTE),
      },
      NOW,
    );

    expect(verdict).toEqual({ withinBudget: true, remaining: 1 });
  });

  it("refuses the start that would exceed the budget", () => {
    const verdict = assessModelBudget(
      {
        startedInWindow: MODEL_BUDGET_JOBS_PER_ACCOUNT,
        oldestStartInWindow: new Date(NOW.getTime() - 30 * MINUTE),
      },
      NOW,
    );

    expect(verdict.withinBudget).toBe(false);
  });

  /**
   * The window slides, so the answer to "when may I start again" is not "in an
   * hour" — it is "when the oldest start in the window falls out of it". An
   * account that spent its budget fifty-nine minutes ago waits about a minute.
   */
  it("frees a slot one window after the start that took it", () => {
    const oldest = new Date(NOW.getTime() - 59 * MINUTE);
    const verdict = assessModelBudget(
      { startedInWindow: MODEL_BUDGET_JOBS_PER_ACCOUNT, oldestStartInWindow: oldest },
      NOW,
    );

    if (verdict.withinBudget) throw new Error("expected the budget to be spent");
    expect(verdict.retryAfter.getTime()).toBe(
      oldest.getTime() + MODEL_BUDGET_WINDOW_MS + MODEL_BUDGET_RELEASE_MARGIN_MS,
    );
    // Roughly a minute away, not a fixed hour from now.
    expect(verdict.retryAfter.getTime() - NOW.getTime()).toBeLessThan(2 * MINUTE);
  });

  /**
   * A release time in the past would be re-read against the same inclusive
   * window boundary, count the same start again, and defer again — a loop that
   * spends queries and moves nothing.
   */
  it("always names a time in the future", () => {
    const verdict = assessModelBudget(
      {
        startedInWindow: MODEL_BUDGET_JOBS_PER_ACCOUNT,
        oldestStartInWindow: new Date(NOW.getTime() - MODEL_BUDGET_WINDOW_MS),
      },
      NOW,
    );

    if (verdict.withinBudget) throw new Error("expected the budget to be spent");
    expect(verdict.retryAfter.getTime()).toBeGreaterThan(NOW.getTime());
  });

  /**
   * A count without a minimum is a contradiction the database should never
   * produce. If it ever does, the safe reading is that the budget is spent —
   * one account waiting an hour is cheaper than every account losing the key.
   */
  it("waits a full window when the count and its minimum disagree", () => {
    const verdict = assessModelBudget(
      { startedInWindow: MODEL_BUDGET_JOBS_PER_ACCOUNT, oldestStartInWindow: null },
      NOW,
    );

    if (verdict.withinBudget) throw new Error("expected the budget to be spent");
    expect(verdict.retryAfter.getTime()).toBe(
      NOW.getTime() + MODEL_BUDGET_WINDOW_MS + MODEL_BUDGET_RELEASE_MARGIN_MS,
    );
  });
});

describe("modelBudgetWindowStart", () => {
  it("looks back exactly one window", () => {
    expect(modelBudgetWindowStart(NOW).getTime()).toBe(NOW.getTime() - MODEL_BUDGET_WINDOW_MS);
  });
});
