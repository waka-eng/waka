/**
 * WHETHER THIS BUILD SHOWS ITS INTERNALS.
 *
 * One predicate, and it earns a file because of who asks it: the Debug pill
 * on the surface, the field audit the tests read through `window.wakaField`,
 * and the guard at the top of the offline fixture. Unrelated things obeying
 * one rule is the only reason they can be relied on to appear and disappear
 * together — and the fixture disappearing is the difference between a
 * developer looking at invented memories and a person being shown them.
 *
 * `MOCK_AGENTS` in `lib/fixture/agent-walls.ts` obeys the same rule and still
 * spells it out itself, in a second copy of the same `import.meta.env` test.
 * That is one rule in two places and it should be one call to this function,
 * but it is not fixed here: the change that created this file moved code and
 * did not edit it, and a behaviour change smuggled inside a move is how a
 * change stops being reviewable. It is a line, and it is worth a commit.
 *
 * IT USED TO LIVE IN THE FIXTURE, and that is why it moved. `Home.tsx`
 * imported this out of `lib/fixture` alongside the invented data, so a
 * product file had an ordinary-looking reason to reach into the fixture
 * module, and the next reader had no way to tell which of those imports were
 * real and which were made up. `lib/fixture/` is now imported by exactly one
 * product file, `Home.tsx`, at exactly the two places it has decided it has
 * nothing real to draw. That is a property you can check with one grep, which
 * is the only kind of property this codebase has learned to trust.
 */
/** Same rule Surface.tsx uses for the Debug pill. */
export function showsDebug(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true || env.VITE_SHOW_INTERNAL === "1";
}
