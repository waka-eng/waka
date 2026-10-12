/**
 * ═══ SAID ONCE, ON THE SURFACE IT IS ABOUT ═════════════════════════════
 *
 * Founder: "how to add the descriptions for like this without overwhelming
 * the space we have?"
 *
 * The answer is not to find room. A description of a place is read once, by
 * one person, on one visit, and stepped over by every eye afterwards —
 * including theirs. Three permanent explainer paragraphs were deleted
 * earlier the same day under "only the most absolutely necessary things
 * should be shown", and this is the half of them worth keeping: the same
 * sentence, borrowed for one visit instead of held forever.
 *
 * ONE VISIT, NOT ONE RENDER. The flag is written on mount rather than on
 * unmount, because a surface that is re-rendered — a filter typed, a row
 * opened — must not keep re-earning its explanation, and a person who
 * closes the tab mid-visit has still had the visit.
 *
 * PROFILE-SCOPED, like every other remembered preference here: your agent's
 * archive is a different place from yours, and being new to one does not
 * make you new to the other.
 *
 * IT FAILS OPEN. If storage throws — private browsing, a full quota — the
 * line simply shows. An explanation appearing twice is a much smaller harm
 * than one that never appears because a disk was full, and this product
 * does not have an error state worth spending on a sentence.
 */
import { useEffect, useState } from "react";

import { readProfileText, writeProfileText, type ProfileStorageScope } from "./profile-storage";

export function useFirstVisit(scope: ProfileStorageScope | null, place: string): boolean {
  const [newHere] = useState(() => {
    try {
      return readProfileText(scope, `seen:${place}`) !== "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!newHere) return;
    try {
      writeProfileText(scope, `seen:${place}`, "1");
    } catch {
      /* The line shows again next time, which is the harmless direction. */
    }
  }, [newHere, place, scope]);
  return newHere;
}
