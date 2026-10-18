// @vitest-environment jsdom
/**
 * THE WAY OUT, PRESSED.
 *
 * Founder, three separate times, about three different surfaces:
 *
 *   "after I click on it, I feel like I'm lost how to go back to the previous
 *   screen"
 *   "I go to my agent and then now I have no way to get back to my top of mind"
 *   "I find it so annoying that from talk with Waka, there's no one click to
 *   go back to top of mind"
 *
 * Law 2 of `docs/six-laws.md` is the most-reported and least-fixed, and this
 * file exists because of HOW it was least-fixed. `Menu` was given a one-press
 * back control for exactly these complaints, and it looked up the row to press
 * by string suffix — `id.endsWith("top-of-mind")`. The switcher later became a
 * list of OWNERS, whose rows are named `me` and `agent:<id>`, so `find`
 * returned `undefined` and the control rendered, read "Your top of mind",
 * carried a left chevron, and DID NOTHING. On `/days` and on the settings page
 * the cog navigates to, that is the founder's sentence live, with a button
 * sitting right there claiming otherwise. A press that no-ops is worse than a
 * missing control: it answers the question and then does not.
 *
 * NOTHING CAUGHT IT BECAUSE NOTHING PRESSED IT. `home-navigation.test.tsx`
 * asserts the control's TEXT, which is true of a dead button. So every case
 * here is a press and a resulting address.
 *
 * `components/Menu.tsx` presses `items[0]` now — your own world, as a property
 * of how `lib/page-menu.ts` builds the list rather than as a name to match —
 * and `test/one-press-back.test.tsx` holds that from the component's side.
 * This file holds it from the two PAGES' side, which is the half that failed:
 * the component was fine in isolation every day it was broken in the product.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/auth-context` — the session is stated as a fact because the subject
 *   is what the chrome DOES with one, not how one is arrived at;
 *   `auth-boundary.test.ts` owns the second question.
 *
 *   `lib/api` — the two pages each load on mount (`listKeptDays`,
 *   `fetchProfiles`, `fetchConnections`, …) and neither has a fixture
 *   fallback: every `catch` puts a message on screen and renders nothing in
 *   place of what it did not get. A wrong mock here produces an empty page
 *   and a red test rather than a green one describing something else — which
 *   is the condition that makes mocking this layer safe.
 *
 *   THAT CONDITION USED TO BE ARGUED IN `Profile.test.ts`, which this
 *   paragraph cited rather than restated. That file was deleted with the
 *   settings page, so the argument briefly lived nowhere — a G6 declaration
 *   whose justification is a dangling reference declares nothing. It is
 *   stated here now, in full, and `public-page.test.tsx` states its own.
 *
 *   `lib/use-agent` — whether this account has an agent decides how many rows
 *   the switcher holds, and a two-row list is the only shape in which the exit
 *   can point at the wrong row at all. Stating it is how the third case is
 *   reachable.
 *
 * React Router's real history runs. The address after the press is the
 * assertion, so replacing the router would replace the subject.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Days } from "../src/pages/Days";

const session = vi.hoisted(() => {
  const account = {
    id: "account-1",
    email: "river@example.com",
    onboardingCompletedAt: "2026-05-01T00:00:00.000Z",
    isAdmin: false,
  };
  const profile = {
    id: "profile-1",
    accountId: "account-1",
    type: "human" as const,
    name: "River",
    avatarUrl: null,
    preferredLocale: "en-US" as const,
    publicHandle: "river",
    publicProfileEnabled: false,
    publicTopOfMindEnabled: false,
  };
  return {
    value: {
      account,
      profile,
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(async () => undefined),
      refresh: vi.fn(async () => null),
      updatePreferredLocale: vi.fn(),
      updateProfile: vi.fn(),
      deleteAccount: vi.fn(),
    },
  };
});

/** Whether this account has an agent — the axis the third case walks. */
const agent = vi.hoisted(() => ({ value: null as { id: string; name: string } | null }));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => session.value,
  useOptionalAuth: () => session.value,
}));

vi.mock("../src/lib/use-agent", () => ({ useAgent: () => agent.value }));

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  listKeptDays: vi.fn(async () => ({ days: [], zone: "UTC" })),
  fetchProfiles: vi.fn(async () => []),
  fetchConnections: vi.fn(async () => []),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let here = "";

function Address(): null {
  here = useLocation().pathname;
  return null;
}

beforeEach(() => {
  agent.value = null;
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Mount one page at an address and settle its on-mount loads. */
async function open(at: string, page: JSX.Element): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Address />
        {page}
      </MemoryRouter>,
    );
  });
  await act(async () => undefined);
}

/**
 * The chrome's one-press way out. Found by class rather than by its words,
 * because the words are what the dead version got right — asserting on them
 * is how this went unnoticed for as long as it did.
 */
function exit(): HTMLButtonElement {
  const control = host.querySelector<HTMLButtonElement>(".waka-switch-trigger");
  if (!control) throw new Error("no way out in the chrome at all");
  return control;
}

describe("a surface you can enter has a visible way out, and it costs one press", () => {
  it("returns from your days to the world", async () => {
    await open("/days", <Days />);
    expect(here).toBe("/days");
    await act(async () => exit().click());
    expect(here).toBe("/");
  });

  /* ═══ THE SETTINGS PAGE HAS NO EXIT BECAUSE IT HAS NO EXISTENCE ══════
     Founder: "I want all setting-related stuff to be only accessible
     through the drop down and not be its own thing." `/profile` is gone,
     so the case that pressed its way out is too.

     WHAT THAT CASE PROTECTED SURVIVES ON `/days`, which is the other page
     this exit serves and is asserted above and below — including the half
     that matters most, that the exit means YOUR world even when standing
     as an agent. One page exercising it is enough to hold the rule; two
     were exercising it only because two pages existed. */

  /**
   * THE SECOND HALF OF THE COMPLAINT, AND IT IS A REAL TRAP, NOT A TIDINESS
   * POINT.
   *
   * Founder: "I go to my agent and then now I have no way to get back to my
   * top of mind without going to my agent's top of mind." The exit has to
   * mean YOUR world, always — because the thing it is rescuing a person from
   * is precisely being somewhere that is not theirs with no row that says
   * "mine".
   *
   * This case exists because the first attempt at this fix got it backwards.
   * It re-labelled the row matching `menu.current`, reasoning that the way
   * out should return you where you came from — which on an agent's wall
   * pointed the exit at the AGENT's top of mind, i.e. shipped the founder's
   * sentence as the fix for the founder's sentence. The lesson is narrower
   * than "that was wrong": an exit must not be computed from where you are
   * standing, because the state it exists to rescue you from is a state you
   * are standing in.
   *
   * So: with an agent present and the stored standing set to it, leaving
   * these two pages still lands on `/`.
   */
  it("always means your own world, even with an agent to stand as", async () => {
    agent.value = { id: "agent-7", name: "claude" };
    localStorage.setItem(
      "waka.standing.account-1",
      JSON.stringify({ id: "agent-7", name: "claude" }),
    );
    await open("/days", <Days />);
    await act(async () => exit().click());
    expect(here).toBe("/");

  });

  /**
   * The press has to be the WHOLE way out. Not "open a list and then choose",
   * which is what this control used to be and what Law 2 refuses in as many
   * words: "A list is not an exit." One press, and the address has changed.
   */
  it("needs no list in between", async () => {
    agent.value = { id: "agent-7", name: "claude" };
    await open("/days", <Days />);
    expect(host.querySelector(".waka-menu")).toBeNull();
    await act(async () => exit().click());
    expect(host.querySelector(".waka-menu")).toBeNull();
    expect(here).toBe("/");
  });
});
