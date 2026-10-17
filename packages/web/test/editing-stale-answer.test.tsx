// @vitest-environment jsdom
/**
 * A KEEP'S ANSWER BELONGS TO THE EDIT IT WAS PRESSED ON.
 *
 * `keep` writes, then `done` or `fail` act on the open edit. They read
 * whatever was open WHEN THE ANSWER LANDED — so a person who kept memory A,
 * then opened memory B before the server replied, saw B stamped `saved` on
 * words never written (or B's draft closed, on a 404). This holds the write
 * open, moves to B, lets A land, and checks B is untouched.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s `updateInspiration`, so a
 * case can hold the write open and decide when and how it lands — the race is
 * the subject, and a real request would decide it for us. Everything else in
 * `lib/api` is the real module. `useEditing` itself runs unmocked in a real
 * React root.
 */
import { act, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const WRITE = vi.hoisted(() => ({
  settle: null as null | { resolve: () => void; reject: (error: unknown) => void },
  all: [] as Array<{ resolve: () => void; reject: (error: unknown) => void }>,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    updateInspiration: () =>
      new Promise((resolve, reject) => {
        WRITE.settle = { resolve: () => resolve(null), reject };
        WRITE.all.push(WRITE.settle);
      }),
  };
});

import { ApiError } from "../src/lib/api";
import { useEditing, type Editing, type EditingDeps } from "../src/space/editing";

let editing: Editing;
let host: HTMLDivElement;
let root: Root;

const deps: EditingDeps = {
  offline: { current: false } as MutableRefObject<boolean>,
  details: { current: new Map() } as EditingDeps["details"],
  setInspirations: () => undefined,
  setSignals: () => undefined,
  setNotes: () => undefined,
  setTopOfMind: () => undefined,
  setAdopted: () => undefined,
  setSelectedId: () => undefined,
  reloadReading: async () => undefined,
};

function Harness() {
  editing = useEditing(deps);
  return null;
}

beforeEach(async () => {
  WRITE.settle = null;
  WRITE.all = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function keepAThenOpenB(): Promise<void> {
  await act(async () => editing.begin("memory", "a", "words for a"));
  await act(async () => editing.keep());
  expect(editing.open?.saving).toBe(true);
  await act(async () => editing.begin("memory", "b", "b, half typed"));
}

it("does not stamp `saved` on the edit opened while the last one was writing", async () => {
  await keepAThenOpenB();
  await act(async () => WRITE.settle!.resolve());

  expect(editing.open).toMatchObject({ id: "b", text: "b, half typed", saving: false, saved: false });
});

it("does not close the edit opened while the last one was failing", async () => {
  await keepAThenOpenB();
  await act(async () => WRITE.settle!.reject(new ApiError({ status: 404, message: "gone" })));

  expect(editing.open).toMatchObject({ id: "b", text: "b, half typed", saved: false });
});

it("still answers the edit it was pressed on", async () => {
  await act(async () => editing.begin("memory", "a", "words for a"));
  await act(async () => editing.keep());
  await act(async () => WRITE.settle!.resolve());

  expect(editing.open).toMatchObject({ id: "a", saving: false, saved: true });
});

it("ignores an earlier keep's late answer to the same words, and applies the newer keep's own", async () => {
  /* Keep, leave, reopen the same memory, keep again: kind, id and `saving`
     all match, so only the keep's own number tells the two answers apart. */
  await act(async () => editing.begin("memory", "a", "first words"));
  await act(async () => editing.keep());
  await act(async () => editing.leave());
  await act(async () => editing.begin("memory", "a", "second words"));
  await act(async () => editing.keep());
  const [first, second] = WRITE.all;

  await act(async () => first!.resolve());
  expect(editing.open, "the first keep's answer stamped the second").toMatchObject({ text: "second words", saving: true, saved: false });

  await act(async () => second!.resolve());
  expect(editing.open).toMatchObject({ text: "second words", saving: false, saved: true });
});
