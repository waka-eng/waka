import type { ModelProvider } from '../../src/lib/model-provider.js';

/** Explicit model stub for orchestration tests, not a semantic evaluator. */
export const approveReadingReview = async (input: Parameters<ModelProvider['reviewTopOfMind']>[0], changed = true): Promise<Awaited<ReturnType<ModelProvider['reviewTopOfMind']>>> => ({
  // Orchestration fixtures allow a changed proposal. Novelty-specific tests
  // override this explicitly; this helper is not a semantic evaluator.
  entries: input.entries.map((entry, index) => ({ index, languageMatches: true,
    grounded: true, synthesized: true, supportingInspirationIds: entry.inspirationIds,
    ...(input.comparison ? { coveredByIndices: changed ? [] : [index < input.comparison.proposedCount ? input.comparison.proposedCount : 0],
      coveredByLeadingEntry: !changed,
      leadingEntryIndex: index < input.comparison.proposedCount ? input.comparison.proposedCount : 0 } : {}) })),
});
