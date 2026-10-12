// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * `lib/api` supplies the claim queue and the feedback write, because those two
 * are the seams the world reads itself through — the claim comes from
 * `listClaims` and the answer leaves through `createFeedback`, and both have
 * to be observable for a press to be checkable at all. `lib/api/conversations`
 * joined them when the two soft answers started opening a chat: that is now
 * a third thing a press DOES, so it is a third thing that has to be
 * watchable. `lib/auth-context` supplies the viewer. `helpers/render-home` and `helpers/canvas-stub` replace
 * time, frames, randomness and drawing, not Home's behavior; the simulation,
 * the layout and every state transition under test are the shipped ones.
 *
 * ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
 *
 * The confirm loop — the thing the founder's workflow design puts at the
 * centre of the product — had NO suite that pressed it. Three buttons under a
 * sentence about you, the one interaction the whole pipeline is built to
 * collect, and nothing anywhere asserted that pressing one recorded anything.
 * `docs/six-laws.md` Law 8 is about exactly that gap: *"a new control gets a
 * test that presses it and asserts the effect — never that it is on screen"*,
 * and the reason the law exists is a control that rendered, read correctly,
 * was enabled, and did nothing.
 *
 * So every case below presses a real button and asserts what reached the
 * server, or asserts that nothing did. None of them check that anything is
 * visible for its own sake.
 *
 * ── THE CORRECTION FIELD IS GONE, AND FOUR CASES WENT WITH IT ─────────────
 *
 * Founder, 2026-10-11: *"the yes / partly / not true button is a little bit
 * weird. And then when the user clicks on partly and not true, can we open a
 * chat experience rather than asking user to answer in that small space?"*
 *
 * TOMBSTONED RATHER THAN DELETED, because what they guarded was real and the
 * next person should know it was considered. `records a correction and the
 * verdict it belongs to in one write, and only on Save`, `files not true
 * with no correction when the field is left empty`, `leaves the claim
 * unanswered when the correction is abandoned`, and `keeps the words and
 * says so when the correction does not land` all pressed a two-row textarea
 * that opened under the claim when you said "Not true". That field had
 * itself replaced five components on an earlier instruction — *"Collapse all
 * five into 'correct a claim' — one text field, reached only after 'not
 * quite'"* — and the last of the four was the replacement for the draft
 * store those five carried: a failed write kept the words on screen rather
 * than closing over them.
 *
 * None of that protection is lost, it has MOVED. The words a person wants to
 * say now go into a conversation, which has its own draft store, its own
 * failure sentence and its own history — all of it stronger than a textarea
 * with no localStorage behind it. What IS given up is `correctionText`:
 * nothing writes one any more. `ReviewEvidence` still quotes the ones
 * already on record and the server still accepts the field, so the loss is a
 * source, not a reader — see the note at the answer row in `Home.tsx`.
 *
 * So the cases below press the same three buttons and assert the two things
 * that now have to be true: the verdict reaches the server IMMEDIATELY for
 * all three, and the two soft answers carry on into a conversation seeded
 * with the claim.
 */
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { createFeedback, listClaims } from "../src/lib/api";
import { createConversation } from "../src/lib/api/conversations";

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
/* THE SEAM THE TWO SOFT ANSWERS LEAVE THROUGH. `talkAbout` creates a
   conversation and then navigates to it, so a press is only checkable if
   this is observable — same argument as `createFeedback` above. */
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
}));

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub(); setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { world?.unmount(); vi.clearAllMocks(); });

/** The answer row, read by its words rather than by its order. */
function answer(label: string): HTMLButtonElement {
  const found = [...world.container.querySelectorAll<HTMLButtonElement>(".jar-char-claim-answers button")]
    .find((node) => node.textContent?.trim() === label);
  if (!found) {
    throw new Error(`no answer named ${label}. The claim offers: ` +
      [...world.container.querySelectorAll(".jar-char-claim-answers button")].map((n) => n.textContent?.trim()).join(", "));
  }
  return found;
}
const statement = () => world.container.querySelector(".jar-char-claim-statement")?.textContent ?? "";
/* `field` AND `correct` WENT WITH THE TEXTAREA. They read and typed into
   `textarea.jar-char-claim-edit`, which no surface renders — see the
   tombstone in this file's header. */
async function withClaims(...claims: Array<typeof CLAIM>) {
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false });
  world = await mountWorld(FACTS);
  expect(statement(), "the claim queue is not on screen, so nothing below presses anything").toContain(claims[0]!.statement);
}

/** The one conversation this press opened, if it opened one. */
const openedChat = () => vi.mocked(createConversation).mock.calls[0];

it("files not true at once and carries it into a conversation about the claim", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => answer("Not true").click());

  /* IMMEDIATELY, which is the reversal. This answer used to send nothing on
     the first press, because a two-row field below it could still change
     what got filed. A conversation is not a row, so there is nothing to
     wait for — and an answer that depended on finishing a chat would be an
     answer lost whenever somebody closed the tab. */
  expect(createFeedback).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({
    targetType: "signal", targetId: "claim-1", value: "not_true", targetRevision: "7",
  });
  /* AND NOTHING CARRIES A CORRECTION ANY MORE. Asserted rather than assumed:
     the field is gone, so a `correctionText` appearing here would mean some
     other path had started producing one silently. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).not.toHaveProperty("correctionText");

  /* THE WORDS GO SOMEWHERE A PERSON CAN SAY THEM. Seeded with the claim —
     the same shape the other two doors into a conversation use — and the
     verdict just filed reaches the reply on its own, because
     `recentFeedback()` passes every value into the generation payload. */
  const chat = openedChat();
  expect(chat, "saying not true opened no conversation").toBeTruthy();
  expect(chat?.[4]).toMatchObject({ content: CLAIM.statement });
});

it("gives partly the same door, which it never had at all", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => answer("Partly").click());

  /* THE ANSWER WITH THE MOST LEFT UNSAID WAS THE ONE GIVEN NOWHERE TO SAY
     IT. "Partly" filed in silence and advanced; only "not true" earned a
     field. Both soft answers open the same door now. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "partly" });
  expect(openedChat()?.[4], "partly still files in silence").toMatchObject({ content: CLAIM.statement });
});

it("keeps yes at one press and on this screen, so the sitting can continue", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  vi.mocked(createConversation).mockResolvedValue({} as Awaited<ReturnType<typeof createConversation>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => answer("Yes").click());

  /* AGREEING IS FINISHED THE MOMENT IT IS PRESSED — there is nothing to add
     to it — so it is the one answer that does not leave. Taking somebody to
     a conversation after "yes" would end a sitting they had not finished,
     which is the opposite of the terminal beat the queue is built around. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "true" });
  expect(openedChat(), "yes should not take anybody anywhere").toBeUndefined();
  expect(statement(), "the next claim did not come up").toContain(SECOND.statement);
});

