/**
 * Layer 3, stage 3 — checking the reply against facts the database owns.
 *
 * Everything here is a pure function over what the provider returned, which
 * is the point: these are the two guarantees layer 3 makes in code rather
 * than in a prompt, and a guarantee that needs a model call to exercise is a
 * guarantee nobody runs. `top-of-mind-synthesis.test.ts` asserts both
 * directly.
 *
 * The known-signal set these citations are checked against is built from the
 * selection, which is filtered by `signals.profileId` — so this filter is
 * also what stops a model-invented id from being written as a foreign key,
 * and what makes "every cited signal belongs to this profile" true of the
 * stored rows rather than merely requested of the model.
 */

import type { TopOfMindSynthesisEntry } from "./model-provider.js";
import type { CarriedEntry } from "./top-of-mind-artifact.js";

interface ValidationOutcome {
  entries: TopOfMindSynthesisEntry[];
  droppedCitations: number;
}

/**
 * Keep only what the database can vouch for: citations that name a signal
 * this profile actually holds, and entries that still have at least one after
 * the filter. An entry with no citation left is not a weaker entry, it is an
 * unsourced claim about someone.
 */
export function validateSynthesizedEntries(
  entries: TopOfMindSynthesisEntry[],
  knownSignalIds: Set<string>,
): ValidationOutcome {
  let droppedCitations = 0;
  const validated: TopOfMindSynthesisEntry[] = [];

  for (const entry of entries) {
    const cited = entry.citedSignalIds.filter((id) => {
      if (knownSignalIds.has(id)) return true;
      droppedCitations += 1;
      return false;
    });
    if (cited.length === 0) continue;
    validated.push({ ...entry, citedSignalIds: [...new Set(cited)] });
  }

  return { entries: validated, droppedCitations };
}

/**
 * Did the model return every locked entry unchanged? The answer does not
 * change what gets written — locked entries are copied from storage either
 * way — but a model that quietly rewrites a person's own words is a fact
 * worth seeing in the logs before it is a fact worth seeing in the product.
 */
export function countLockViolations(
  lockedEntries: CarriedEntry[],
  returned: TopOfMindSynthesisEntry[],
): number {
  const returnedBodies = new Set(returned.map((entry) => entry.body));
  return lockedEntries.filter((entry) => !returnedBodies.has(entry.body)).length;
}
