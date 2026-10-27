// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * `lib/api` supplies the claim queue and the feedback write, because those two
 * are the seams the world reads itself through — the claim comes from
 * `listClaims` and the answer leaves through `createFeedback`, and both have
 * to be observable for a press to be checkable at all. `lib/api/conversations`
 * stays mocked so the suite can assert that no answer opens a conversation —
 * not by itself, and since the receipt went (2026-10-15) not by a second
 * press either. `lib/auth-context` supplies
 * the viewer. `helpers/render-home` and `helpers/canvas-stub` replace time,
 * frames, randomness and drawing, not Home's behavior.
 *
 * ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
 *
 * The confirm loop is the thing the product is built to collect, and
 * `docs/six-laws.md` Law 8 says a control gets a test that presses it and
 * asserts the effect, never that it is on screen. Every case below moves or
 * presses a real control and asserts what reached the server, or that
 * nothing did.
 *
 * ── THE ROW BECAME A CARD, AND THE CASES FOLLOWED ─────────────────────────
 *
 * Founder, 2026-10-15: *"I want this to be feeling like a swipe experience
 * ... swipe the card towards the character up to say yes and swipe it down
 * to say no ... drag on laptop, swipe on mobile."*
 *
 * Three words (yes · partly · not true) became two directions — first up
 * and down, then sideways on a slip, with "Not anymore" and "Still true"
 * named on either side under it and "Chat about it" between them. What the earlier
 * cases guarded is kept where it still applies: the verdict reaches the
 * server IMMEDIATELY, and yes stays on this screen so the sitting can go on.
 * What changed, and is asserted below: a no no longer opens a conversation,
 * and since 2026-10-15 it leaves no receipt either (the "Noted. Say what’s
 * true instead" line and its door went: "remove this flow") — and `partly`
 * is not reachable from this slot at all.
 *
 * TOMBSTONES, kept so the next person knows they were considered. The
 * correction textarea (four cases) went on 2026-10-11 when the soft answers
 * started opening a chat; `gives partly the same door` went today when
 * partly left the slot. `correctionText` is still produced by nothing.
 */
import { act } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, diveIntoReview, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { createFeedback, listClaims } from "../src/lib/api";
import { loadSignal, loadTopOfMind } from "../src/lib/data";
import { createConversation } from "../src/lib/api/conversations";
import { SLIP_LEAVE_MS as LEAVE_MS } from "../src/components/ClaimSlip";

const FACTS = { inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] };
const CLAIM = {
  id: "claim-1",
  statement: "You keep saving products that make the first move for you.",
  status: "emerging" as const,
  confidence: 24,
  evidenceCount: 1,
  lastEvidenceAt: "2026-10-01T00:00:00.000Z",
  locked: false,
  unsupported: false,
  sharedGroupIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  statementRevision: "7",
  from: [{ id: "kept-1", preview: "An original capture" }],
};
const SECOND = { ...CLAIM, id: "claim-2", statement: "You prefer reversible steps." };

/* `FACTS` IS INLINED INTO BOTH FACTORIES, not referenced. `vi.mock` is
   hoisted above every const in the file, so closing over a module-level
   fixture throws at import time. */
vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  ...apiMockFrom({ inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] }),
  listClaims: vi.fn(),
  createFeedback: vi.fn(),
}));
vi.mock("../src/lib/api/conversations", async (original) => ({
  ...await original<typeof import("../src/lib/api/conversations")>(),
  createConversation: vi.fn(),
}));
vi.mock("../src/lib/auth-context", async (original) => ({
  ...await original<typeof import("../src/lib/auth-context")>(),
  useOptionalAuth: () => ({ status: "authenticated", account: { id: "a", email: "owner@example.test" },
    profile: { id: VIEWER_ID, name: "Owner", type: "human" }, profiles: [] }),
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom({ inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] }),
  loadTopOfMind: vi.fn(async () => null),
  /* THE CLAIM'S ROOTS, for the tap that dives deeper: a claim is a signal,
     and its evidence comes from `loadSignal`. */
  loadSignal: vi.fn(async (id: string) => ({
    id, statement: "", status: "emerging", confidence: 24, evidenceCount: 1, lastEvidenceMs: 0, createdMs: 0,
    locked: false, unsupported: false, sharedGroupIds: [], reviewEvidence: [],
    evidence: [{ signalId: id, inspirationId: "kept-1", preview: "An original capture", quote: null, quoteSource: null, reason: null, createdMs: 0 }],
  })),
}));

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub(); setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { world?.unmount(); vi.clearAllMocks(); vi.mocked(loadTopOfMind).mockResolvedValue(null); vi.useRealTimers(); });

/** The two directions, read by their words rather than by their order. */
function direction(label: string): HTMLButtonElement {
  const found = [...world.container.querySelectorAll<HTMLButtonElement>(".jar-pick-act")]
    .find((node) => node.textContent?.trim() === label);
  if (!found) {
    throw new Error(`no direction named ${label}. The card offers: ` +
      [...world.container.querySelectorAll(".jar-pick-act")].map((n) => n.textContent?.trim()).join(", "));
  }
  return found;
}
const card = () => world.container.querySelector<HTMLDivElement>(".jar-pick-slip");
/* The FRONT slip's sentence: the next claim is previewed behind it. */
const statement = () => world.container.querySelector(".jar-pick-slip .jar-pick-statement")?.textContent ?? "";
/** THE RECEIPT IS GONE (2026-10-15): no line, no "Noted.", no door into a chat. */
function expectNoReceipt(after: string) {
  expect(world.container.querySelector(".jar-char-claim-receipt, .jar-char-claim-receipt-act"), `a receipt line came back after ${after}`).toBeNull();
  const text = world.container.textContent ?? "";
  expect(text, `"Noted." is on screen after ${after}`).not.toContain("Noted.");
  expect(text, `"Say what’s true" is on screen after ${after}`).not.toContain("Say what’s true");
}

async function withClaims(...claims: Array<typeof CLAIM>) {
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false });
  world = await mountWorld(FACTS);
  /* The cards are behind the invitation since 2026-10-15; see `diveIntoReview`. */
  await diveIntoReview(world.container, world.step);
  expect(statement(), "the claim queue is not on screen, so nothing below presses anything").toContain(claims[0]!.statement);
}

/** Lets the card finish its trip so the queue advances. */
async function cardLeaves() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, LEAVE_MS + 30)); });
}

/** The one conversation a press opened, if it opened one. */
const openedChat = () => vi.mocked(createConversation).mock.calls[0];

/** A sideways pointer drag on the slip, in pixels; positive is right (keep).
    jsdom gives the slip no height, so a flick is used — the same release a
    thumb makes. */
async function drag(node: HTMLElement, dx: number) {
  const fire = (type: string, x: number, timeStamp: number) => {
    const event = new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: 300, button: 0, buttons: 1 });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    node.dispatchEvent(event);
  };
  await act(async () => {
    fire("pointerdown", 300, 0);
    fire("pointermove", 300 + dx / 2, 20);
    fire("pointermove", 300 + dx, 40);
    fire("pointerup", 300 + dx, 50);
  });
}

it("files true at once when the slip goes right, and the next claim comes up", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);

  await drag(card()!, 80);

  /* IMMEDIATELY. A judgement about yourself does not wait on the card
     finishing its trip any more than on a round trip. */
  expect(createFeedback).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({
    targetType: "signal", targetId: "claim-1", value: "true", targetRevision: "7",
  });
  expect(openedChat(), "yes should not take anybody anywhere").toBeUndefined();
  await cardLeaves();
  expect(statement(), "the next claim did not come up").toContain(SECOND.statement);
});

it("files not true when the slip goes left, opens nothing, and leaves no receipt", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await drag(card()!, -80);

  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "not_true", targetRevision: "7" });
  /* NOTHING CARRIES A CORRECTION. The field is gone; a `correctionText` here
     would mean some other path had started producing one silently. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).not.toHaveProperty("correctionText");
  /* A NO COSTS WHAT A YES COSTS. Nothing opens on its own. */
  expect(openedChat(), "a down-swipe opened a conversation on its own").toBeUndefined();
  /* AND NOTHING IS OFFERED AFTER IT. Founder, 2026-10-15: "note * say whats
     true instead -> remove this flow." The verdict is filed; the next card
     comes up. */
  expectNoReceipt("a left swipe");
  await cardLeaves();
  expectNoReceipt("a left swipe, once the card has gone");
  expect(statement(), "the next claim did not come up").toContain(SECOND.statement);
  expect(openedChat(), "something opened a conversation after the no").toBeUndefined();
});

it("files not true on Not true, opens nothing, and leaves no receipt", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => direction("Not true").click());

  expect(createFeedback).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "not_true", targetRevision: "7" });
  expect(openedChat(), "Not true opened a conversation").toBeUndefined();
  expectNoReceipt("Not true");
  await cardLeaves();
  expectNoReceipt("Not true, once the card has gone");
  expect(statement(), "the next claim did not come up").toContain(SECOND.statement);
});

it("settles back and files nothing when the drag stops short", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);

  await drag(card()!, 10);

  expect(createFeedback).not.toHaveBeenCalled();
  expect(statement()).toContain(CLAIM.statement);
  expect(card()?.className).not.toContain("leaving");
});

it("answers the same way from the two named directions, for anyone who does not drag", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => direction("True").click());
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "true" });
  await cardLeaves();
  expect(statement()).toContain(SECOND.statement);

  await act(async () => direction("Not true").click());
  expect(vi.mocked(createFeedback).mock.calls[1]?.[0]).toMatchObject({ targetId: "claim-2", value: "not_true" });
});

it("answers from the keyboard with the card focused", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);

  const node = card()!;
  await act(async () => {
    node.focus();
    node.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "true" });
});

it("does not offer partly from this slot at all", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM);
  const words = [...world.container.querySelectorAll(".jar-pick-act")].map((n) => n.textContent?.trim());
  /* The two answers and nothing else: "partly" is nowhere in the row, and
     neither is a chat (founder, 2026-10-15: "remove chat about it under the
     claim"). */
  expect(words).toEqual(["Not true", "True"]);
});

/* Audit f2afcbe2 (mob): a swipe that began on the creature while reviewing
   walked the world to Principles, leaving "Exit review mode" and no card. */
it("does not walk to Principles when the creature is pulled while reviewing", async () => {
  await withClaims(CLAIM);
  const creature = world.container.querySelector<HTMLElement>(".jar-char-press");
  expect(creature, "the avatar must not intercept a review swipe").toBeNull();
  await act(async () => { await world.step(); });
  expect(world.container.querySelector(".waka-page--timeless"), "the pull walked to Principles mid-review").toBeNull();
  expect(statement()).toContain(CLAIM.statement);
});

/* Audit f2afcbe2: "Not anymore" presumed an earlier yes on a reading asked
   for the first time. "Still" and "anymore" belong to the re-ask alone. */
it("says Still true / Not anymore only when it is asking again", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims({ ...CLAIM, askedAgain: { lastAnsweredAt: "2026-07-01T12:00:00Z" } });
  const words = [...world.container.querySelectorAll(".jar-pick-act")].map((n) => n.textContent?.trim());
  expect(words).toEqual(["Not anymore", "Still true"]);
});

it("offers no chat on the card, by button or by key", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM);
  expect(world.container.querySelector(".jar-pick-act--chat"), "a chat door is back on the claim card").toBeNull();
  const card = world.container.querySelector(".jar-pick") as HTMLElement;
  await act(async () => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(createFeedback, "ArrowDown answered the claim").not.toHaveBeenCalled();
  expect(world.container.querySelector(".jar-pick-statement")?.textContent).toBe(CLAIM.statement);
});

it("says when the last yes was, when a reading is being asked again", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims({ ...CLAIM, askedAgain: { lastAnsweredAt: "2026-06-15T12:00:00.000Z" } } as typeof CLAIM);
  const line = world.container.querySelector(".jar-pick-source")?.textContent ?? "";
  expect(line).toContain("You said this was true in June");
  expect(line, "states render, numerals never").not.toMatch(/\d/);
});

it("says nothing about a last answer on a first ask", async () => {
  await withClaims(CLAIM);
  expect(world.container.querySelector(".jar-pick-source")).toBeNull();
});

it("hints at the next claim with a bare edge, and no back card when it is the last", async () => {
  await withClaims(CLAIM, SECOND);
  const edge = world.container.querySelector(".jar-pick-behind");
  expect(edge, "nothing says another claim is waiting").not.toBeNull();
  expect(edge?.textContent, "the back card previews words; it should only hint").toBe("");
  world.unmount();
  vi.clearAllMocks();
  await withClaims(CLAIM);
  expect(world.container.querySelector(".jar-pick-behind"), "an empty back card with nothing behind it").toBeNull();
});

it("opens the claim's roots when the slip is tapped rather than dragged", async () => {
  await withClaims(CLAIM, SECOND);
  await drag(card()!, 0);
  expect(loadSignal).toHaveBeenCalledWith("claim-1");
  expect(createFeedback, "a tap is not an answer").not.toHaveBeenCalled();
  const room = world.container.querySelector(".jar-prov-room");
  expect(room?.querySelector(".jar-prov-room-lead")?.textContent).toBe(CLAIM.statement);
  expect(room?.textContent).toContain("An original capture");
});

it("does not open the roots after a drag that settles back", async () => {
  await withClaims(CLAIM, SECOND);
  await drag(card()!, 10);
  expect(loadSignal).not.toHaveBeenCalled();
});

/**
 * ═══ REVIEW IS SOMETHING YOU STEP INTO (2026-10-15) ═════════════════════
 *
 * Founder: "the entry point into the card swipe left and right should be the
 * agent should say 'there are x things to review!' and the CTA becomes 'Dive
 * into review' or sth like this, which makes the card swipe be the main
 * action of the page." So the cards are not on home until that press, the
 * invitation counts honestly, Esc steps back out to it, and the sitting ends
 * on its own when there is nothing left to ask.
 *
 * WHETHER THE SITTING IS STILL ON is read through the one thing it changes
 * that is not a card: → on Now walks to Principles only when NOT reviewing
 * (Home.tsx, "PRINCIPLES IS REACHED BY GOING"), so the address after a → is
 * the observable form of the mode.
 */
let where: ReturnType<typeof useLocation>;
let go: ReturnType<typeof useNavigate>;
function Where() { where = useLocation(); go = useNavigate(); return null; }
const invite = () => world.container.querySelector(".jar-char-bubble--review");
const inviteSays = () => invite()?.querySelector(".jar-char-bubble-reading")?.textContent?.trim() ?? "";
const walkedToPrinciples = () => new URLSearchParams(where.search).get("open") === "principles";
async function mountQueue(...claims: Array<typeof CLAIM>) {
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false });
  world = await mountWorld(FACTS, { routerTools: <Where /> });
}
async function press(target: EventTarget, key: string) {
  await act(async () => { target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  await world.step(4);
}

it("counts what waits in the invitation, in the singular and the plural", async () => {
  await mountQueue(CLAIM);
  expect(invite()).toBeNull();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());
  expect(inviteSays()).toBe("There is 1 thing to review!");
  expect(invite()?.querySelector("button.jar-char-bubble-act")?.textContent?.trim()).toBe("Dive into review");
  world.unmount();

  await mountQueue(CLAIM, SECOND, { ...CLAIM, id: "claim-3", statement: "You finish what you start." });
  await act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());
  expect(inviteSays()).toBe("There are 3 things to review!");
});

it("shows no card until the dive, and the first card has the keys once in", async () => {
  await mountQueue(CLAIM, SECOND);
  expect(card(), "a claim card is lying on home before anyone asked for review").toBeNull();
  expect(world.container.querySelector(".jar-pick"), "a pick is lying on home before anyone asked for review").toBeNull();

  await diveIntoReview(world.container, world.step);
  expect(invite(), "the invitation stayed up over the cards").toBeNull();
  expect(statement()).toContain(CLAIM.statement);
  /* THE SLIP, not the card's wrapper: `.jar-pick-slip` is the element with
     `tabIndex` and the key handler, so it is what "← and → answer at once"
     needs to be holding focus. */
  expect(document.activeElement, "the first card's slip does not have focus on the way in, so ← and → do not answer it")
    .toBe(world.container.querySelector(".jar-pick-slip"));
});

it("steps back out to Top of Mind on Escape", async () => {
  await mountQueue(CLAIM, SECOND);
  await diveIntoReview(world.container, world.step);
  expect(card()).toBeTruthy();
  await press(document.body, "Escape");
  expect(card(), "Escape left the cards up").toBeNull();
  expect(invite(), "Escape should return to the reading, not another review invitation").toBeNull();
});

it("makes the bar one way out while reviewing: Exit review mode", async () => {
  /* Founder, 2026-10-15: "in the review mode, bottom bar should say exit
     review mode." */
  const bar = () => [...world.container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")].map((n) => n.textContent?.trim());
  await mountQueue(CLAIM, SECOND);
  expect(bar(), "the bar before review").toEqual(["Home", "Inspirations", "Chats"]);
  await diveIntoReview(world.container, world.step);
  expect(bar(), "the bar while reviewing").toEqual(["Exit review mode"]);
  const exit = [...world.container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")].find((n) => n.textContent?.trim() === "Exit review mode")!;
  await act(async () => { exit.click(); });
  expect(card(), "Exit review mode left the cards up").toBeNull();
  expect(invite(), "Exit review mode should return to the reading").toBeNull();
  expect(bar(), "the bar after review").toEqual(["Home", "Inspirations", "Chats"]);
});

it("keeps → for the card while reviewing, and gives it back to Principles when the last card is answered", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await mountQueue(CLAIM);
  await diveIntoReview(world.container, world.step);

  /* ON THE FOCUSED CARD, → IS THE CARD'S: it answers, and nobody walks. */
  const node = card()!;
  node.focus();
  await press(node, "ArrowRight");
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "true" });
  expect(walkedToPrinciples(), "→ on a claim card walked to Principles").toBe(false);

  /* AND THE SITTING ENDS ON ITS OWN once nothing is left to ask: no card,
     no invitation (there is nothing to count), and → walks again. */
  await cardLeaves(); await world.step(4);
  expect(card(), "a card is still up after the last answer").toBeNull();
  expect(invite(), "the invitation came back with nothing to count").toBeNull();
  await press(document.body, "ArrowRight");
  expect(walkedToPrinciples(), "the review never ended, so → still does not walk").toBe(true);
});

it("does not walk to Principles on → off the card while reviewing", async () => {
  await mountQueue(CLAIM, SECOND);
  await diveIntoReview(world.container, world.step);
  await press(document.body, "ArrowRight");
  expect(walkedToPrinciples(), "→ walked away in the middle of a review").toBe(false);
  expect(card(), "the review was dropped").toBeTruthy();
  /* And after Escape, the same key walks — so the case above is the mode,
     not a dead listener. */
  await press(document.body, "Escape");
  await press(document.body, "ArrowRight");
  expect(walkedToPrinciples(), "→ on Now does not walk to Principles out of review").toBe(true);
});

/* ═══ AN OLD `?open=claims` LINK OPENS REVIEW (2026-10-17) ═══════════════
   The claims page is gone; its address hands over to review. Three cases,
   because the queue may already be here, still loading, or empty — and the
   address keeps the wall it named while losing only `open`. */
it("opens review from a cold ?open=claims link once the claims arrive, and keeps the wall", async () => {
  vi.mocked(listClaims).mockResolvedValue({ claims: [CLAIM], more: false });
  world = await mountWorld(FACTS, { routerTools: <Where />, initialEntries: ["/w/me?open=claims"] });
  await world.step(4);
  expect(card(), "the old claims link did not open review").toBeTruthy();
  expect(where.pathname, "the wall the link named was dropped").toBe("/w/me");
  expect(new URLSearchParams(where.search).get("open")).toBeNull();
});

it("opens review at once when the claims are already waiting, and Back/Forward do not reopen a dead page", async () => {
  await mountQueue(CLAIM);
  expect(card(), "review was open before anybody asked").toBeNull();
  await act(async () => { go("/?open=claims"); });
  await world.step(4);
  expect(card(), "claims were waiting and review did not open").toBeTruthy();
  expect(new URLSearchParams(where.search).get("open")).toBeNull();
  await act(async () => { go(-1); }); await world.step(4);
  await act(async () => { go(1); }); await world.step(4);
  expect(new URLSearchParams(where.search).get("open"), "history still holds the dead page").toBeNull();
});

it("stays home when nothing is waiting, and the request does not linger", async () => {
  vi.mocked(listClaims).mockResolvedValue({ claims: [], more: false });
  world = await mountWorld(FACTS, { routerTools: <Where />, initialEntries: ["/?open=claims"] });
  await world.step(4);
  expect(card()).toBeNull();
  expect(new URLSearchParams(where.search).get("open")).toBeNull();
  /* a queue that turns up later, from another load, is not an invitation
     the link made: review stays closed until somebody dives in */
  vi.mocked(listClaims).mockResolvedValue({ claims: [CLAIM], more: false });
  await act(async () => { go("/w/me"); }); await world.step(6);
  await act(async () => { go("/"); }); await world.step(6);
  expect(card(), "review popped open long after the link was answered").toBeNull();
});


it('shows Top of Mind before pending reviews and cycles only on avatar presses', async () => {
  const body = 'Small experiments help me find a clearer direction.';
  vi.mocked(loadTopOfMind).mockResolvedValue({ id: 'reading', version: 1, reason: 'initial', createdMs: Date.now(), entries: [{
    id: 'entry', type: 'pattern', body, belief: null, prompt: null, locked: false, pinned: false, dismissed: false,
    sortOrder: 0, citedSignals: [], createdMs: Date.now(),
  }] });
  await mountQueue(CLAIM, SECOND);
  const bubbleText = () => world.container.querySelector('.jar-char-bubble')?.textContent;
  const tap = () => act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());
  expect(bubbleText()).toContain(body);
  expect(invite()).toBeNull();
  await tap(); expect(inviteSays()).toBe('There are 2 things to review!');
  await tap(); expect(invite()).toBeNull(); expect(bubbleText()).not.toContain(body);
  await tap(); expect(bubbleText()).toContain('Which principles are guiding you lately?');
  await tap(); expect(bubbleText()).toContain(body);
  expect(world.container.querySelectorAll('.jar-char-bubble')).toHaveLength(1);
  // A complete cycle in one event turn must still end on the reading.
  await act(async () => { for (let i = 0; i < 4; i++) world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click(); });
  expect(bubbleText()).toContain(body);
  await diveIntoReview(world.container, world.step);
  await press(document.body, 'Escape');
  expect(bubbleText()).toContain(body);
});

it('skips review when nothing waits and opens the selected principles flow', async () => {
  await mountQueue();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());
  expect(invite()).toBeNull();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());
  expect(world.container.querySelector('.jar-char-bubble')?.textContent).toContain('Which principles are guiding you lately?');
  await act(async () => world.container.querySelector<HTMLButtonElement>('.jar-char-bubble-act')!.click());
  expect(walkedToPrinciples()).toBe(true);
});
