// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * `lib/api` supplies the claim queue and the feedback write, because those two
 * are the seams the world reads itself through — the claim comes from
 * `listClaims` and the answer leaves through `createFeedback`, and both have
 * to be observable for a press to be checkable at all. `lib/auth-context`
 * supplies the viewer. `helpers/render-home` and `helpers/canvas-stub` replace
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
 * WHAT IT IS GUARDING, SPECIFICALLY. The correction field replaced five
 * components (`ReviewPanel`, `ReviewDialogue`, `ReviewResult`,
 * `ReflectionFlow`, and the review's own evidence surface) on the founder's
 * instruction: *"Collapse all five into 'correct a claim' — one text field,
 * reached only after 'not quite'."* Those five carried a draft store, so a
 * half-written answer survived a reload. This field deliberately does not —
 * the draft lifecycle is the thing that was cut. What replaces that
 * protection is the last case here: a correction that does not land keeps the
 * words on screen and says so, rather than closing over them.
 */
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { createFeedback, listClaims } from "../src/lib/api";

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
const field = () => world.container.querySelector<HTMLTextAreaElement>("textarea.jar-char-claim-edit");
/* TYPED THROUGH THE NATIVE SETTER, as every other suite here types. Assigning
   `.value` on a controlled textarea leaves React's own tracker holding the old
   string, so the change event is treated as a no-op and the state never moves
   — a test that does it the obvious way passes an empty correction and proves
   nothing. */
const correct = (words: string) => act(async () => {
  const box = field()!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, words);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});

async function withClaims(...claims: Array<typeof CLAIM>) {
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false });
  world = await mountWorld(FACTS);
  expect(statement(), "the claim queue is not on screen, so nothing below presses anything").toContain(claims[0]!.statement);
}

it("records a correction and the verdict it belongs to in one write, and only on Save", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);

  await act(async () => answer("Not true").click());
  /* NOTHING IS ON THE RECORD YET, and that is the whole reason this answer
     costs a second press. The field below may still change what gets filed,
     and a verdict sent now would be a second row for one answer. */
  expect(createFeedback).not.toHaveBeenCalled();
  expect(field(), "saying not true opens the one field this product types into").not.toBeNull();

  await correct("It is more about not starting from nothing.");
  await act(async () => answer("Save").click());

  expect(createFeedback).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({
    targetType: "signal", targetId: "claim-1", value: "not_true",
    correctionText: "It is more about not starting from nothing.",
    targetRevision: "7",
  });
  /* AND THE CLAIM LEAVES ONLY ONCE THE WORDS ARE FILED. Advancing first would
     pull the sentence out from under the field being typed into. */
  expect(statement()).toContain(SECOND.statement);
  expect(field()).toBeNull();
});

it("files not true with no correction when the field is left empty", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM);
  await act(async () => answer("Not true").click());
  await act(async () => answer("Save").click());
  /* OPTIONAL ON PURPOSE. The verdict is a complete answer without a sentence
     beside it, and a product that refused to accept "no" without an essay
     would teach people to pick a different answer. `correctionText` is absent
     rather than empty: the route rejects an empty string, and an empty
     correction is not a thing a person said. */
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "not_true" });
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).not.toHaveProperty("correctionText");
});

it("leaves the claim unanswered when the correction is abandoned", async () => {
  await withClaims(CLAIM);
  await act(async () => answer("Not true").click());
  await act(async () => answer("Leave it").click());
  /* THE WAY OUT RECORDS NOTHING, which is the truth: the person opened an
     answer and did not give one, so the claim is still being asked. Law 2
     wants this press to exist; Law 1 wants it to mean what it says. */
  expect(createFeedback).not.toHaveBeenCalled();
  expect(field()).toBeNull();
  expect(statement()).toContain(CLAIM.statement);
  expect(answer("Not true")).toBeTruthy();
});

it("keeps yes and partly at one press, with no field between them and the record", async () => {
  vi.mocked(createFeedback).mockResolvedValue({} as Awaited<ReturnType<typeof createFeedback>>);
  await withClaims(CLAIM, SECOND);
  await act(async () => answer("Partly").click());
  /* PARTLY USED TO OPEN A REWRITE OF THE CLAIM'S OWN WORDING HERE. The
     founder's instruction put the one text field behind "not quite" only, so
     partly is now exactly as cheap as yes — and it is still read, by the
     generator, which is told a partly verdict is an invitation to sharpen
     rather than an arbitration (`docs/six-laws.md`, Law 10). Rewriting a
     signal in your own words survives on the reading's ground rows. */
  expect(field()).toBeNull();
  expect(vi.mocked(createFeedback).mock.calls[0]?.[0]).toMatchObject({ targetId: "claim-1", value: "partly" });
  expect(statement()).toContain(SECOND.statement);
  await act(async () => answer("Yes").click());
  expect(vi.mocked(createFeedback).mock.calls[1]?.[0]).toMatchObject({ targetId: "claim-2", value: "true" });
});

it("keeps the words and says so when the correction does not land", async () => {
  vi.mocked(createFeedback).mockRejectedValue(new Error("The write was lost"));
  await withClaims(CLAIM);
  await act(async () => answer("Not true").click());
  await correct("It is more about not starting from nothing.");
  await act(async () => answer("Save").click());

  /* THE REPLACEMENT FOR THE DRAFT STORE THAT WAS DELETED. There is no
     localStorage behind this field, so the only thing standing between a
     failed write and lost writing is that the field does not close and the
     failure is stated in words. A silent close here would be the one failure
     this product refuses — see Law 8's note on a dead press reading as the
     product being broken. */
  expect(field()?.value).toBe("It is more about not starting from nothing.");
  expect(world.container.querySelector('.jar-char-claim-mine [role="alert"]')?.textContent)
    .toBe("That didn’t save. Your words are still here.");
  expect(statement(), "a claim whose answer did not land is still being asked").toContain(CLAIM.statement);
  /* and it can be pressed again rather than needing a reload */
  expect(answer("Save").disabled).toBe(false);
});
