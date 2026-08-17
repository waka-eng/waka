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

/**
 * MAY INVENTED DATA EXIST IN THIS BUILD? `DEV` alone, and never `showsDebug()`.
 *
 * These are two rules that look alike and are not one rule. "Show me the
 * internals" is reasonable on a staging build, so `showsDebug()` honours
 * `VITE_SHOW_INTERNAL`. "Invent memories that nobody wrote" is not reasonable
 * anywhere a real person can reach, so this one does not.
 *
 * THE FIRST FIX WAS THE INSTANCE, NOT THE CLASS, AND THAT IS WHY THIS EXISTS.
 * `MOCK_AGENTS` in `fixture/agent-walls.ts` was found gated on the wider rule
 * and changed to `DEV` alone. `offlineHome()` in `fixture/offline-home.ts` was
 * calling `showsDebug()` and was missed — so `VITE_SHOW_INTERNAL=1 vite build`
 * still produced a bundle where a signed-out visitor, on any 401, was shown
 * two dozen invented memories painted as their own world instead of being sent
 * to the door. A reviewer reproduced it from the compiled output.
 *
 * Aliasing does not escape it: Vite injects `import.meta.env` as a whole
 * object, so `const env = import.meta.env` is inlined complete, flag and all.
 *
 * One predicate, so the next fixture cannot be gated on the wrong rule by
 * copying a neighbour. `test/fixture-says-so.test.ts` asserts every caller.
 */
export function inventedDataAllowed(): boolean {
  return import.meta.env.DEV === true;
}
