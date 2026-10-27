import type { ModelProvider } from '../../src/lib/model-provider.js';

/** Explicit model stub for orchestration tests, not a semantic evaluator. */
export const approveReadingReview: ModelProvider['reviewTopOfMind'] = async input => ({
  entries: input.entries.map((entry, index) => ({ index, languageMatches: true,
    grounded: true, synthesized: true, supportingInspirationIds: entry.inspirationIds })),
});
