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

function Host(props: { offline: boolean; attachments: number; profile?: string }) {
  const [, setInspirations] = useState<null | Array<{ id: string; preview: string; attachments: Array<{ type: "image"; label: string }> }>>([{
    id: "m1", preview: "old words",
    attachments: Array.from({ length: props.attachments }, () => ({ type: "image" as const, label: "IMG_0001.jpg" })),
  }]);
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
    onMemoryKept: (id, text) => { kept.push({ id, text }); order.push("kept"); },
    memoryAttachmentCount: () => props.attachments,
    memoryProfile: () => props.profile,
  } as EditingDeps);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  W.calls.length = 0; kept.length = 0; previews.length = 0; order.length = 0;
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
  expect(previews.at(-1), "and the list shows them").toBe("kept offline");
});

/* THE LIST'S PREVIEW AFTER A KEEP IS THE ARCHIVE'S PREVIEW (review,
   2026-10-17): a photo-only memory whose words were cleared reads "Photo",
   never an empty row. */
it("previews a wordless memory by its attachment after a keep", async () => {
  await keepWords({ attachments: 1 }, "");
  expect(previews.at(-1)).toBe("Photo");
});
