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

async function mount(items: MenuItem[], current: string | null) {
  await act(async () => {
    root.render(
      /* `label` is what puts the bar in its one-press-back shape: it marks a
         surface you did not travel to on purpose — a conversation, settings,
         your days — where the question is never "which owner" but "how do I
         get back". */
      <Menu locale="en-US" items={items} current={current} label="worldMenuTalk" onSettings={() => undefined} />,
    );
  });
}

const trigger = () => host.querySelector<HTMLButtonElement>(".waka-switch-trigger")!;

it("presses back to your own top of mind from a surface you did not travel to", async () => {
  const mine = vi.fn(), theirs = vi.fn();
  await mount(owners(mine, theirs), null);
  const back = trigger();
  expect(back, "a conversation offers no way back to the top of mind at all").toBeTruthy();
  /* IT SAYS WHERE IT GOES. A back arrow alone would be the unlabelled door
     the switcher was replaced for being. */
  expect(back.textContent).toContain("Your top of mind");
  await act(async () => back.click());
  expect(mine, "the one press the founder asked for by name did nothing").toHaveBeenCalledOnce();
  expect(theirs, "it went to the agent's top of mind instead of your own").not.toHaveBeenCalled();
});

it("goes to your own top of mind even while standing as the agent", async () => {
  /* THE COMPLAINT'S OTHER HALF: "I go to my agent and then now I have no way
     to get back to my top of mind without going to my agent's top of mind."
     So the destination is not "wherever you were" — it is YOURS. */
  const mine = vi.fn(), theirs = vi.fn();
  await mount(owners(mine, theirs), "agent:agent-1");
  await act(async () => trigger().click());
  expect(mine).toHaveBeenCalledOnce();
  expect(theirs).not.toHaveBeenCalled();
});

it("offers the owners instead, on a surface that is one of them", async () => {
  /* The branch boundary, so the back control cannot start appearing on the
     world — where it would be a second control answering a question the
     switcher already answers. */
  const mine = vi.fn(), theirs = vi.fn();
  await act(async () => {
    root.render(<Menu locale="en-US" items={owners(mine, theirs)} current="me" onSettings={() => undefined} />);
  });
  expect(host.querySelector(".waka-switch-trigger")?.textContent).toContain("Your top of mind");
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-switch-trigger")!.click());
  /* Pressing it on the world OPENS THE LIST rather than navigating, so
     nothing is selected yet. */
  expect(mine).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".waka-menu .waka-menu-item").length).toBe(2);
});
