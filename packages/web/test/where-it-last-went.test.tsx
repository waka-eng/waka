// @vitest-environment jsdom

/**
 * THE CAPTURE REMEMBERS WHERE IT LAST WENT.
 *
 * Founder, 2026-09-08: "let's say if I captured inspiration and decided that
 * I wanted to make it public once, then keep the past, keep the last
 * selection. Don't default to private."
 *
 * WHAT IT WAS. `keepPublic` began every session at `false` and, on every
 * successful keep, was set back to `false` — the comment beside it said
 * "reset after every keep so a one-off never becomes a standing setting". So
 * a person who works in the open answered the same question on every single
 * capture, and answered it the same way every time. A question re-answered
 * identically forty times is one the product should have learned.
 *
 * WHY IT IS SAFE TO REMEMBER, which is the real question a stored `public`
 * raises. Nothing here is silent: the row prints both words and lights the
 * one that stands, on every open, before anything is written — so the
 * remembered choice is a state on screen, not a setting hidden in a menu. The
 * founder's law is that states render; this is the law applied to a default.
 *
 * THE FIRST CAPTURE IS STILL PRIVATE. A browser with nothing stored reads as
 * private, and so does one whose storage throws. The default only stops
 * applying once the person has said `public` with their own hand.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The same four seams every suite that
 * mounts this page uses, and for the reasons `home-field.test.tsx` gives at
 * length: `lib/data` (the layers arrive as fixtures, because nothing here is
 * about fetching), `lib/api` (group reads, plus `createInspiration` — the
 * keep has to SUCCEED for the case about surviving a keep to be about
 * anything, and jsdom has no server), `lib/auth-context` (a signed-in viewer,
 * because the world renders nothing without one) and `helpers/canvas-stub`
 * (jsdom has no 2D context and the field is drawn). The first three go
 * through `helpers/render-home`, so this suite and the field's describe the
 * same world rather than two worlds that happen to agree; only
 * `createInspiration` is answered here, because only this file cares what the
 * keep was asked to write. Storage is real jsdom storage, cleared between
 * cases — the claim IS about what it holds.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { profileStorageKey } from "../src/lib/profile-storage";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

/** One person, three memories — the mouth is the same mouth either way. */
const FACTS = {
  inspirations: Array.from({ length: 3 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
  groups: [],
};

/** every keep the page attempts, in order, so the request can be read back */
const kept: Array<{ visibility?: string }> = [];
const saveCalls: Array<{ text: string; requestId?: string; profile?: string }> = [];
const saveControl = vi.hoisted(() => ({ loseNext: false, holdNext: false, release: null as null | (() => void) }));
const IDENTITY = vi.hoisted(() => ({ accountId: "account-1", profileId: "profile-viewer" }));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    ...apiMockFrom(FACTS),
    fetchInspirationSaveRequest: async () => { throw new actual.ApiError({ status: 404, code: 'save_not_found', message: 'No committed save' }); },
    createInspiration: async (body: { text: string; visibility?: string }, options: { requestId?: string; profile?: string }) => {
      kept.push({ visibility: body.visibility });
      saveCalls.push({ text: body.text, requestId: options.requestId, profile: options.profile });
      if (saveControl.loseNext) { saveControl.loseNext = false; throw new Error('Response lost'); }
      if (saveControl.holdNext) { saveControl.holdNext = false; await new Promise<void>((resolve) => { saveControl.release = resolve; }); }
      const now = new Date().toISOString();
      return {
        id: `made-${kept.length}`,
        profileId: IDENTITY.profileId,
        text: body.text,
        kind: "note",
        source: "app",
        visibility: body.visibility ?? "private",
        createdAt: now,
        updatedAt: now,
        attachments: [],
        reflections: [],
      };
    },
    refreshTopOfMind: async () => null,
  };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  return { ...actual, ...dataMockFrom(FACTS) };
});

vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = {
    status: "authenticated",
    account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" },
    profiles: [],
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
  const current = () => ({ ...session,
    account: { ...session.account, id: IDENTITY.accountId },
    profile: { ...session.profile, id: IDENTITY.profileId },
  });
  return { ...actual, useOptionalAuth: current, useAuth: current };
});

/** The key the choice is remembered under. Named once, asserted everywhere. */
const SCOPE = { accountId: "account-1", profileId: VIEWER_ID };
const DRAFT_KEY = profileStorageKey(SCOPE, "draft")!;

let layout: MountedWorld | undefined;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  IDENTITY.accountId = SCOPE.accountId;
  IDENTITY.profileId = SCOPE.profileId;
  kept.length = 0;
  saveCalls.length = 0; saveControl.loseNext = false; saveControl.holdNext = false; saveControl.release = null;
  window.localStorage.clear();
});

afterEach(() => {
  layout?.unmount();
  layout = undefined;
  window.localStorage.clear();
});

/**
 * Open the world with the mouth already open.
 *
 * An unfinished sentence found on arrival opens the mouth holding it — that
 * is the page's own rule, and it is the cheapest way to reach the row without
 * driving a click into a canvas jsdom does not draw. The words are what a
 * person would have typed; the case is about where they go.
 */
async function worldWithTheMouthOpen(): Promise<MountedWorld> {
  window.localStorage.setItem(DRAFT_KEY, "a thing worth keeping");
  layout = await mountWorld(FACTS, { initialEntries: ['/?compose=1'] });
  return layout;
}

/* ═══ THE LINK BUTTON IS GONE, AND THIS CASE WENT WITH IT ════════════════
   This drove the composer's "＋ Link" control, typed a url into the field it
   opened, and proved the keyboard save shortcut carried it. The control is
   gone — founder, on the row that held Photo, Link and Record: "remove all" —
   and with it the only way to reach that field from the world.

   WHAT IT PROTECTED IS STILL PROTECTED, one layer down:
   `inspiration-composer.test.tsx` mounts the composer with `linkText` already
   set (the restored-draft case, which is now the only way the field appears)
   and asserts the same thing — that Save carries the pending link.
   `inspiration-input.test.ts` owns the joining itself.

   Recorded here rather than silently deleted, because "the test was removed"
   and "the behaviour was removed" look identical in a diff. */

/* ═══ `destination()` IS GONE, WITH THE ROW IT READ ══════════════════════
   It found `.jar-composer-visibility` and reported which of "Only me" and
   "Share with rooms" was lit. Founder: "I told you we got rid of the concept
   for room so there shouldn't be only me and share with rooms." There is no
   row, because there is no second destination for a save to go to. */

/* ═══ THE WHOLE SCREEN, NOT THE NOTE ════════════════════════════════════
   This looked inside `.jar-inspiration-composer`, which was right while
   every control for a note was on the note. Save and Save as draft are in
   the dock now — founder: "the save button is very hard to see. Maybe the
   save button should be in the bottom bar as well. And then it should have
   save or save as draft" — so scoping to the page would report a moved
   control as a deleted one.

   SCOPING TO THE CONTAINER IS NOT A LOOSENING, because of what else is on
   screen while the mouth is open: the dock's four places are nouns, and
   nothing else in this world says "Save". Each `press` below is still an
   unambiguous target. */
async function press(word: RegExp): Promise<void> {
  /* BY ACCESSIBLE NAME, NOT BY INK. Save is a check in the bar now —
     founder: "let's just have a save icon. There's no save as draft.
     There's just a save icon" — so it has no text content at all. The
     `aria-label` is what it is called, which is also what a person using
     this product by ear hears, so matching on it tests the name that
     actually has to be right. */
  const button = Array.from(layout?.container.querySelectorAll("button") ?? []).find((b) =>
    word.test(b.textContent ?? "") || word.test(b.getAttribute("aria-label") ?? ""),
  );
  if (!button) throw new Error(`no ${word} on the row`);
  await act(async () => {
    button.click();
  });
}

describe("the capture remembers where it last went", () => {
  it('retries an uncertain keep with the original request identity', async () => {
    saveControl.loseNext = true;
    await worldWithTheMouthOpen(); await press(/^save inspiration$/i);
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => layout!.container.querySelector<HTMLButtonElement>('.jar-source-status button')!.click());
    expect(saveCalls).toHaveLength(2);
    expect(saveCalls[1]).toEqual(saveCalls[0]);
    expect(Object.keys(localStorage).filter((key) => key.includes(':pendingSave:'))).toHaveLength(0);
  });

  it('does not replace a newer draft when an earlier keep finishes', async () => {
    saveControl.holdNext = true;
    await worldWithTheMouthOpen(); await press(/^save inspiration$/i);
    /* `.jar-mouth-rest` is the keep box now, and a field reopens the composer
       by taking focus rather than by being pressed. */
    await act(async () => layout!.container.querySelector<HTMLTextAreaElement>('.jar-mouth-rest')!.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
    const field = layout!.container.querySelector<HTMLTextAreaElement>('.jar-mouth-field')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'My newer unsent draft');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => saveControl.release!());
    expect(field.value).toBe('My newer unsent draft');
    expect(localStorage.getItem(DRAFT_KEY)).toBe('My newer unsent draft');
    expect(kept).toHaveLength(1);
  });

  it('Escape keeps a newer short draft while an earlier save is uncertain', async () => {
    saveControl.loseNext = true;
    await worldWithTheMouthOpen(); await press(/^save inspiration$/i);
    await act(async () => layout!.container.querySelector<HTMLTextAreaElement>('.jar-mouth-rest')!.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
    const field = layout!.container.querySelector<HTMLTextAreaElement>('.jar-mouth-field')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A newer thought');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(localStorage.getItem(DRAFT_KEY)).toBe('A newer thought');
    expect(saveCalls).toHaveLength(1);
    expect(Object.keys(localStorage).filter((key) => key.includes(':pendingSave:'))).toHaveLength(1);
    /* Nothing to reopen: `.jar-mouth-rest` IS the box, and the newer draft is
       sitting in it. That the words survived an uncertain save is the claim;
       where they survived is no longer a second screen. */
    expect(layout!.container.querySelector<HTMLTextAreaElement>('.jar-mouth-rest')!.value).toBe('A newer thought');
  });
  it("does not assign an unscoped draft or sharing choice to the next account", async () => {
    window.localStorage.setItem("waka.draft", "an unattributed private draft");
    layout = await mountWorld(FACTS);
    expect(layout.container.querySelector("textarea")?.value ?? "").not.toContain("an unattributed private draft");
    expect(window.localStorage.getItem("waka.draft")).toBe("an unattributed private draft");
  });
  /* THE SHARING HALF OF THIS CASE IS GONE; THE DRAFT HALF IS THE POINT.
     It used to assert that switching identity swapped the remembered audience
     as well as the words. There is no audience to swap. What remains is the
     claim that actually protects somebody: one account's unsent words never
     appear in another account's field, and leaving a profile does not take
     the draft with you. */
  it("isolates drafts when identity changes in the same mounted app", async () => {
    await worldWithTheMouthOpen();
    const other = { accountId: "account-2", profileId: "profile-2" };
    const otherDraftKey = profileStorageKey(other, "draft")!;
    window.localStorage.setItem(otherDraftKey, "a separate account's draft");
    Object.assign(IDENTITY, other);
    await layout!.rerender();
    expect(layout!.container.querySelector("textarea")?.value).toBe("a separate account's draft");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe("a thing worth keeping");
    Object.assign(IDENTITY, SCOPE);
    await layout!.rerender();
    expect(layout!.container.querySelector("textarea")?.value).toBe("a thing worth keeping");
    expect(window.localStorage.getItem(otherDraftKey)).toBe("a separate account's draft");
  });

  /* ═══ THE SHARING WIRING IS GONE NOW TOO ══════════════════════════════
     This paragraph used to say the opposite, and the reversal is the point:
     "THE STORAGE KEY AND ITS STATE HAVE NOT BEEN RIPPED OUT, deliberately —
     `keepPublic` still rides on every save and the world still reads the
     key, so if sharing comes back it comes back to a working default rather
     than to a rewrite. What is gone is the surface that asked."

     That was a reasonable call when only the CONTROL had been removed. The
     founder has since ruled on the concept rather than the control:
     "everything regarding public and private should also not be a thing in
     this new experience." Keeping a frozen value that silently decided the
     audience of every save is exactly what that sentence forbids.

     AND IT WAS NOT A WORKING DEFAULT. `setKeepPublic` was handed to the
     composer as `onVisibility`, which the composer declares and never
     calls, so nothing in the product could change the value — the case
     below could only seed `localStorage` by hand to make it true. A test
     that reaches past every door to set a flag is testing the flag, not the
     product. The capability is removed, so the case goes with it. */
});
