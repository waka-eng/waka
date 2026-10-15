/**
 * WHEN THE WORLD MUST BE BUILT AGAIN — and the one case that read as "never".
 *
 * "POUR" IN THIS FILE MEANS THE BUILD, AND NOT AN ANIMATION. It meant both
 * once: the field was staged into the world with a staggered fall, and the
 * signature below decided when that happened. The fall is deleted (2026-10-11
 * — the tombstone and the founder's words are at `POUR_MS` in
 * `canvas/simulation.ts`), and nothing in this file changes because of it: a
 * rebuild is still a rebuild, it is still catastrophic to miss one, and the
 * empty-string hole below is still the bug it always was. The name stays
 * because renaming it reaches `Home.tsx` and this file's own test, and because
 * every word of what follows is about the BUILD.
 *
 * The frame loop is set up by an effect that needs the archive, the agents and
 * a canvas before it can do anything: it builds the field, starts the rAF, and
 * attaches every listener the world has — `/`, the arrows, Escape, the drag,
 * the wheel. Miss the re-run and the world is DRAWN AND INERT: chrome up,
 * loading ground gone, and not one key or press answered.
 *
 * The effect cannot depend on `inspirations` directly, because then every keep
 * tore the whole world down and built it again — the brightening and the
 * reshuffled stars the founder reported four times. `simApi.born()` already
 * puts a new orb in the world the instant you keep it, so it depends on a
 * SIGNATURE instead: the archive's ids minus the ones this session already
 * bore. A keep changes nothing; a reload, an agent's capture or a deletion
 * does.
 *
 * THE HOLE WAS THE EMPTY STRING. Written as `(inspirations ?? [])…join(",")`,
 * the signature for "the archive has not answered yet" and the signature for
 * "the archive answered, and it is empty" were both `""`. Those are the two
 * states a brand-new account passes through, in that order. So on a fresh
 * account, if `/api/profiles` happened to answer BEFORE `/api/inspirations`,
 * the effect ran once with a null archive, returned early, and then had
 * nothing left to notice: agents unchanged, signature unchanged, no walls, no
 * rooms. The world stood there looking complete and could not be touched. It
 * recovered only if some other dependency happened to move.
 *
 * Found by a journey that flaked one run in four, pressing `/` twenty times
 * over twenty seconds at a world that never answered — and confirmed by
 * dispatching the keydown from inside the page, where it also did nothing:
 * the listener was not late, it was absent.
 *
 * A signature must never say the same thing about "no answer" and "an empty
 * answer". Nothing else about it changes.
 */

/** The one shape this needs: anything with an id. */
export interface HasId {
  id: string;
}

/**
 * NOT A SIGNATURE OF ANYTHING — the archive has not answered.
 *
 * It has to be a string no real signature can be. A signature is ids joined
 * by commas; ids never contain a space, so no archive, empty or not, can ever
 * produce this.
 */
export const NOT_POURED = "(not poured yet)";

/**
 * The archive's identity for the frame loop's setup effect.
 *
 * @param inspirations the archive, or `null` while it has not answered
 * @param born ids this session already put in the world with `born()`
 */
export function pourSignature(
  inspirations: readonly HasId[] | null | undefined,
  born: ReadonlySet<string>,
): string {
  if (!inspirations) return NOT_POURED;
  return inspirations
    .map((c) => c.id)
    .filter((id) => !born.has(id))
    .sort()
    .join(",");
}
