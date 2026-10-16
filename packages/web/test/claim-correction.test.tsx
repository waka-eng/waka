// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * `lib/api` supplies the claim queue and the feedback write, because those two
 * are the seams the world reads itself through — the claim comes from
 * `listClaims` and the answer leaves through `createFeedback`, and both have
 * to be observable for a press to be checkable at all. `lib/api/conversations`
 * stays mocked because a conversation is still one thing an answer can lead
 * to — now by a second press on the receipt, never by the answer itself — so
 * it has to be watchable to assert both halves. `lib/auth-context` supplies
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
 * What changed, and is asserted below: a no no longer opens a conversation
 * by itself — it offers one, on the receipt, with a second press — and
 * `partly` is not reachable from this slot at all.
 *
 * TOMBSTONES, kept so the next person knows they were considered. The
 * correction textarea (four cases) went on 2026-10-11 when the soft answers
 * started opening a chat; `gives partly the same door` went today when
 * partly left the slot. `correctionText` is still produced by nothing.
 */
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { createFeedback, listClaims } from "../src/lib/api";
import { loadSignal } from "../src/lib/data";
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
afterEach(() => { world?.unmount(); vi.clearAllMocks(); vi.useRealTimers(); });

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
const receiptDoor = () => world.container.querySelector<HTMLButtonElement>(".jar-char-claim-receipt-act");

async function withClaims(...claims: Array<typeof CLAIM>) {
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false });
  world = await mountWorld(FACTS);
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

it("files not true when the slip goes left, opens nothing, and offers the conversation on the receipt", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await drag(card()!, -80);

  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "not_true", targetRevision: "7" });
  /* NOTHING CARRIES A CORRECTION. The field is gone; a `correctionText` here
     would mean some other path had started producing one silently. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).not.toHaveProperty("correctionText");
  /* A NO COSTS WHAT A YES COSTS. The chat is offered, not forced. */
  expect(openedChat(), "letting the slip go left opened a conversation on its own").toBeUndefined();

  const door = receiptDoor();
  expect(door, "the receipt offered no way to say what is true instead").toBeTruthy();
  await act(async () => door!.click());
  /* Seeded with the claim — the shape the other doors into a conversation
     use. The verdict already filed reaches the reply through
     `recentFeedback()`. */
  expect(openedChat()?.[4]).toMatchObject({ content: CLAIM.statement });
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

  await act(async () => direction("Still true").click());
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "true" });
  await cardLeaves();
  expect(statement()).toContain(SECOND.statement);

  await act(async () => direction("Not anymore").click());
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
