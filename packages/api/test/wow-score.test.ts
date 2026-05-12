import { describe, expect, it } from "vitest";

import {
  calculateContentDepthScore,
  calculateImportanceScore,
  calculateProcessingScore,
  calculateRevisitScore,
  calculateRuntimeCandidateScore,
  calculateSimilarityScore,
  calculateSurpriseSimilarityScore,
  calculateWowScore,
  clamp,
  clamp01,
  fromPersistedScore,
  log1p,
  logNormalize,
  toPersistedScore,
} from "../src/scoring/wow-score.js";

describe("WOW scoring calculators", () => {
  it("clamps raw numbers and normalizes logarithmic counts", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 0, 3)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.5)).toBe(0);
    expect(log1p(-10)).toBe(0);
    expect(logNormalize(0, { max: 10 })).toBe(0);
    expect(logNormalize(10, { max: 10 })).toBe(1);
    expect(logNormalize(100, { max: 10 })).toBe(1);
    expect(logNormalize(1, { max: 0 })).toBe(0);
  });

  it("calculates content depth as 0.70*TextDepth + 0.30*ContextScore", () => {
    expect(calculateContentDepthScore({ textDepth: 0.8, contextScore: 0.5 })).toBeCloseTo(
      0.71,
    );
  });

  it("calculates processing from reflection presence", () => {
    expect(calculateProcessingScore({ hasReflection: true })).toBe(1);
    expect(calculateProcessingScore({ hasReflection: false })).toBe(0);
  });

  it("calculates revisit as weighted normalized revisit signals", () => {
    expect(
      calculateRevisitScore({
        uniqueRevisitDays: 0.6,
        totalRevisitCount: 0.4,
        revisitedInLast7Days: true,
      }),
    ).toBeCloseTo(0.59);

    expect(
      calculateRevisitScore({
        uniqueRevisitDays: 2,
        totalRevisitCount: -1,
        revisitedInLast7Days: 0.5,
      }),
    ).toBeCloseTo(0.7);
  });

  it("calculates importance as 0.40*ContentDepth + 0.25*Processing + 0.25*Revisit + 0.10*TimeSignal", () => {
    expect(
      calculateImportanceScore({
        contentDepth: 0.71,
        processing: 1,
        revisit: 0.59,
        timeSignal: 0.2,
      }),
    ).toBeCloseTo(0.7015);
  });

  it("calculates similarity signals as normalized direct values", () => {
    expect(calculateSimilarityScore(0.73)).toBe(0.73);
    expect(calculateSimilarityScore(3)).toBe(1);
    expect(calculateSurpriseSimilarityScore(-2)).toBe(0);
  });

  it("calculates persisted WOW score from weighted constituent signals", () => {
    expect(
      calculateWowScore({
        importance: 0.7015,
        topSimilaritySignal: 0.8,
        topSurpriseSimilaritySignal: 0.25,
        timeDistanceSignal: 0.4,
      }),
    ).toBeCloseTo(0.605675);
  });

  it("calculates runtime candidate score separately from persisted WOW score", () => {
    expect(
      calculateRuntimeCandidateScore({
        wowScore: 0.605675,
        similarityToTrigger: 0.3,
        surpriseSimilarityToTrigger: 0.6,
        timeDistanceToTrigger: 0.9,
      }),
    ).toBeCloseTo(0.5428375);
  });

  it("round-trips normalized scores through 0..100 persisted integers", () => {
    expect(toPersistedScore(0.605675)).toBe(61);
    expect(toPersistedScore(2)).toBe(100);
    expect(toPersistedScore(-1)).toBe(0);
    expect(fromPersistedScore(61)).toBe(0.61);
    expect(fromPersistedScore(250)).toBe(1);
  });
});
