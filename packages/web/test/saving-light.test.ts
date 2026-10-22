/**
 * THE AURA'S REACH IS HOW MUCH YOU HAVE BEEN SAVING.
 *
 * Founder, 2026-10-21: "the brightness should reflect how much inspirations
 * the person has been saving." `savingLight` is the whole rule — each save
 * contributes 0.5^(age / 7 days), the sum saturates through
 * 1 − e^(−activity / SAVING_LIGHT_SCALE) — and these cases pin what it must
 * say, never how it says it on screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. `savingLight` is a pure
 * function of timestamps and a clock, and the clock is passed in, so there is
 * no layer between the test and the shipped code to replace.
 */
import { describe, expect, it } from "vitest";

import { SAVING_LIGHT_SCALE, savingLight } from "../src/lib/aliveness";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 12);
const ago = (days: number) => NOW - days * DAY;

describe("savingLight", () => {
  it("is dark when nothing has been saved", () => {
    expect(savingLight([], NOW)).toBe(0);
  });

  it("is near dark when the last saves were weeks ago", () => {
    expect(savingLight([ago(35), ago(40), ago(42)], NOW)).toBeLessThan(0.05);
  });

  it("is clearly bright after five saves this week", () => {
    const week = savingLight([ago(0), ago(1.5), ago(3), ago(4.5), ago(6)], NOW);
    expect(week).toBeGreaterThanOrEqual(0.6);
    expect(week).toBeLessThanOrEqual(0.7);
    const today = savingLight([NOW, NOW, NOW, NOW, NOW], NOW);
    expect(today).toBeGreaterThan(week);
    expect(today).toBeLessThan(1);
  });

  it("fades as the same saves age", () => {
    const saves = [0, 1, 2, 3, 4];
    const fresh = savingLight(saves.map((d) => ago(d)), NOW);
    const week = savingLight(saves.map((d) => ago(d + 7)), NOW);
    const month = savingLight(saves.map((d) => ago(d + 28)), NOW);
    expect(week).toBeLessThan(fresh);
    expect(month).toBeLessThan(week);
    expect(month).toBeLessThan(0.15);
  });

  it("rises with every save added", () => {
    const saves = [ago(2), ago(5)];
    const before = savingLight(saves, NOW);
    const after = savingLight([...saves, NOW], NOW);
    expect(after).toBeGreaterThan(before);
    /* one save today, alone, is visible but not bright */
    const one = savingLight([NOW], NOW);
    expect(one).toBeCloseTo(1 - Math.exp(-1 / SAVING_LIGHT_SCALE), 10);
    expect(one).toBeGreaterThan(0.2);
    expect(one).toBeLessThan(0.35);
  });

  it("ignores saves stamped after the dial's time", () => {
    expect(savingLight([NOW + DAY], NOW)).toBe(0);
  });
});
