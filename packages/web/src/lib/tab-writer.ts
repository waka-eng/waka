/**
 * WHO IS WRITING A DRAFT: THIS TAB, ACROSS RELOADS.
 *
 * The chat composer and the share card both stamp each draft with a writer
 * id, and an edit to a draft some OTHER writer left is forked under a new key
 * rather than written over it — so two tabs never clobber each other's words.
 *
 * THE WRITER IS THE TAB. The id used to be minted per mount, so a reload made
 * the tab a stranger to its own draft: the next keystroke forked, the
 * original stayed on disk, and after the fork was sent the next reload
 * restored the original — words already sent, back in the box. The id lives
 * in `sessionStorage`, which is per tab and survives a reload, so a reload
 * keeps writing its own draft in place.
 *
 * A DUPLICATED TAB copies `sessionStorage`, so it starts with the same id as
 * the tab it came from. That is found where it matters, at the write: the
 * drafts' compare-and-set refuses a key the other tab changed, and the panel
 * answers that refusal by taking a new id (`newTabWriterId`) and forking to
 * it — never by reporting storage as broken.
 *
 * NO CROSS-TAB LIVENESS. A lease-and-heartbeat scheme was tried to tell an
 * open tab's draft from a closed one's. Browsers throttle timers in
 * background tabs, so a live tab read as dead and its draft was deleted —
 * worse than the failure it fixed. The cost of not knowing is written down
 * in `docs/known-issues.md`: a draft left by a CLOSED tab can come back in a
 * new tab after its words were sent from a fork.
 *
 * WHEN STORAGE THROWS, the id is kept in memory for the life of the page, and
 * that one id is returned everywhere — the id a draft is written with is
 * always the id this module reports.
 */
const KEY = "waka:draftWriter";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set once storage has failed; from then on, the only source of truth. */
let inMemory: string | null = null;

function keep(id: string): void {
  sessionStorage.setItem(KEY, id);
  if (sessionStorage.getItem(KEY) !== id) throw new Error("writer id was not kept");
}

export function tabWriterId(): string {
  if (inMemory) return inMemory;
  try {
    const held = sessionStorage.getItem(KEY);
    if (held && UUID.test(held)) return held;
    const made = crypto.randomUUID();
    keep(made);
    return made;
  } catch {
    inMemory = crypto.randomUUID();
    return inMemory;
  }
}

/** A NEW writer id for this tab, after finding it shared one with another. */
export function newTabWriterId(): string {
  const made = crypto.randomUUID();
  if (inMemory) {
    inMemory = made;
    return made;
  }
  try {
    keep(made);
  } catch {
    inMemory = made;
  }
  return made;
}
