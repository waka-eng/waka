// @vitest-environment jsdom
/**
 * ═══ KEEPING A MEMORY'S WORDS: THE RULES THE CARD'S EDIT OWES THE ARCHIVE ══
 *
 * Review, 2026-10-17. `space/editing.ts` is the memory card's edit act, and
 * three of its rules have to match the archive's note page, which edits the
 * same stored notes:
 *
 *   - EMPTY WORDS: allowed only beside an attachment (`lib/note-words.ts`,
 *     the create rule) — refused otherwise, at the press.
 *   - THE WRITE NAMES THE PROFILE THE CARD WAS READ WITH, or an agent's
 *     memory is written to the signed-in human and misses.
 *   - A FIXTURE (OFFLINE) KEEP STILL TELLS THE CARD, so the shown words and
 *     the next edit's seed are the kept words, not the old ones.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/api` — spread through, with
 * `updateInspiration` recording the write and answering a server-shaped
 * row, because the claim is about what the act SENDS and what it tells the
 * page; nothing here needs a network. The real `useEditing` runs inside a
 * one-line host component.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useEditing, type Editing, type EditingDeps } from "../src/space/editing";

const W = vi.hoisted(() => ({ calls: [] as Array<{ id: string; text: string; profile?: string }> }));
vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  updateInspiration: async (id: string, input: { text: string }, options: { profile?: string } = {}) => {
    W.calls.push({ id, text: input.text, ...(options.profile ? { profile: options.profile } : {}) });
    order.push("write");
    return { id, text: input.text, attachments: [], reflections: [] };
  },
}));

let host: HTMLDivElement, root: Root, edit: Editing;
const kept: Array<{ id: string; text: string }> = [];
const previews: string[] = [];
/** the page's callbacks and the write, in the order they happened */
const order: string[] = [];
/** the page refuses the card's row as older than words it already holds */
let refuse = false;

function Host(props: { offline: boolean; attachments: number; profile?: string }) {
  const [, setInspirations] = useState<null | Array<{ id: string; preview: string }>>([{ id: "m1", preview: "old words" }]);
  edit = useEditing({
    offline: { current: props.offline },
    details: { current: new Map() },
    setInspirations: ((update: unknown) => setInspirations((prev) => {
      const next = typeof update === "function" ? (update as (p: unknown) => typeof prev)(prev) : update as typeof prev;
      const row = next?.find((item) => item.id === "m1");
      if (row) previews.push(row.preview);
      return next;
    })) as EditingDeps["setInspirations"],
    setSignals: vi.fn(), setNotes: vi.fn(), setTopOfMind: vi.fn(), setAdopted: vi.fn(), setSelectedId: vi.fn(),
    onMemoryKept: (id, text) => { kept.push({ id, text }); order.push("kept"); return refuse ? false : undefined; },
    onMemoryWriteSettled: (id) => { order.push(`settled ${id}`); },
    onMemoryWriting: (id) => { order.push(`writing ${id}`); },
    memoryAttachmentCount: () => props.attachments,
    memoryProfile: () => props.profile,
  } as EditingDeps);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  W.calls.length = 0; kept.length = 0; previews.length = 0; order.length = 0; refuse = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function keepWords(props: { offline?: boolean; attachments?: number; profile?: string }, text: string) {
  await act(async () => root.render(<Host offline={props.offline ?? false} attachments={props.attachments ?? 0} profile={props.profile} />));
  await act(async () => edit.begin("memory", "m1", "old words"));
  await act(async () => edit.retype(text));
  await act(async () => { edit.keep(); await Promise.resolve(); await Promise.resolve(); });
}

it("refuses to empty a memory that holds nothing else", async () => {
  await keepWords({ attachments: 0 }, "   ");
  expect(W.calls).toEqual([]);
  expect(edit.open?.saving).toBe(false);
});

it("keeps a memory wordless beside an attachment — the archive's rule", async () => {
  await keepWords({ attachments: 1 }, "");
  expect(W.calls).toEqual([{ id: "m1", text: "" }]);
});

it("writes with the profile the card was read with", async () => {
  await keepWords({ profile: "agent-7" }, "new words");
  expect(W.calls).toEqual([{ id: "m1", text: "new words", profile: "agent-7" }]);
  expect(kept).toEqual([{ id: "m1", text: "new words" }]);
});

it("tells the card about a fixture keep, so its words and the next edit are the kept ones", async () => {
  await keepWords({ offline: true }, "kept offline");
  expect(W.calls, "a fixture world asks no server").toEqual([]);
  expect(kept).toEqual([{ id: "m1", text: "kept offline" }]);
  /* the page that listens writes the list itself — see the next case */
  expect(previews).toEqual([]);
});

/* THE PAGE'S FRESHNESS VERDICT DECIDES (review, 2026-10-17). A card write
   older than an archive write the page already accepted must change
   nothing — so with a listener, the act no longer writes the list's preview
   or drops the cache before asking; and it says a write is going out first,
   so reads already in flight are marked older than it. */
it("leaves the list and the cache to the page, and announces the write before it goes", async () => {
  await keepWords({}, "new words");
  expect(order).toEqual(["writing m1", "write", "kept", "settled m1"]);
  expect(previews, "no preview written behind the page's back").toEqual([]);
});

/* REFUSED AS OLDER (review, 2026-10-17): another door stored newer words
   first, so the card's own write is not what is stored. It must not play
   the "saved" beat over them — the edit stays open, unsaved, and the page
   asks which words to keep. */
it("does not say saved when the page refuses the card's write as older", async () => {
  refuse = true;
  await keepWords({}, "new words");
  expect(edit.open?.saved, "no saved beat").toBe(false);
  expect(edit.open?.saving).toBe(false);
  expect(edit.open?.text, "and the person's words are still open").toBe("new words");
  expect(order.at(-1), "the write is settled either way").toBe("settled m1");
});
