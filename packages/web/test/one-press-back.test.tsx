// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing but the locale catalogue's
 * host. The real `Menu` renders with real items and a real press; there is no
 * router, no auth and no server here because the control under test takes its
 * destinations as a prop. Appearance is not claimed. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Menu, type MenuItem } from "../src/components/Menu";

/**
 * ONE PRESS BACK TO YOUR TOP OF MIND.
 *
 * Founder, naming this control specifically: "I find it so annoying that from
 * talk with Waka, there's no one click to go back to top of mind."
 *
 * WHY THIS SUITE EXISTS, AND IT IS NOT BECAUSE THE CONTROL WAS MISSING. It
 * was built, and then it quietly died. It found its destination by matching
 * `id.endsWith("top-of-mind")` on the switcher's rows — and when the switcher
 * became a list of OWNERS rather than views, those ids became "me" and
 * "agent:<id>". Nothing ended in "top-of-mind" any more, `find` returned
 * undefined, and the press became a no-op. Every type check passed. The
 * button was still there, still labelled, still enabled, and did nothing.
 *
 * That is the worst failure available to a control: a dead press reads as the
 * product being broken, where a missing control merely reads as a thing not
 * offered. And no test could see it, because the suites that covered this bar
 * covered the SWITCHER — the one-press-back branch only renders on a page
 * that is not one of the views, which no suite mounted.
 *
 * So this asserts the behaviour rather than the markup: pressing it must
 * actually call something, and that something must be your own top of mind.
 */
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/* The owners, in the order `lib/page-menu` builds them: you first, always. */
const owners = (mine: () => void, theirs: () => void): MenuItem[] => [
  { id: "me", label: "worldMenuTopOfMind", onSelect: mine },
  { id: "agent:agent-1", label: "worldAgentTopOfMind", onSelect: theirs },
];

/* THE ONE-PRESS WAY BACK IS THE SHARED HEADER'S "<" NOW (nav system): the
   centre switch ("‹ On your mind lately") that used to carry it went with
   the corners leaving every page. `page-exit.test.tsx` presses the "<" on
   your days; `nav-system.test.tsx` holds every page to it. What stays here
   is the rungs' half: on a surface that is one of the owners, each is one
   press. */
it("offers the owners instead, on a surface that is one of them", async () => {
  /* The branch boundary, so the back control cannot start appearing on the
     world — where it would be a second control answering a question the
     switcher already answers. */
  const mine = vi.fn(), theirs = vi.fn();
  await act(async () => {
    root.render(<Menu locale="en-US" items={owners(mine, theirs)} current="me" onSettings={() => undefined} />);
  });
  /* LAID OUT, NOT LISTED. Founder: "i dont like current dropdown way to do
     it." On the world there is no trigger and no sheet — the rungs are the
     control, all of them visible, each a single press. So the boundary this
     case guards is now the clearer one: the back control appears only where
     `label` says you did not travel here on purpose. */
  expect(host.querySelector(".waka-switch-trigger")).toBeNull();
  const rungs = [...host.querySelectorAll<HTMLButtonElement>(".waka-rungs .waka-rung")];
  expect(rungs.map((node) => node.textContent?.trim())).toEqual(["On your mind lately", "On your agent’s mind"]);
  await act(async () => rungs[1]!.click());
  expect(theirs, "a rung is one press, with nothing to open first").toHaveBeenCalledOnce();
  expect(mine).not.toHaveBeenCalled();
});
