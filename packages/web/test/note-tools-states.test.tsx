// @vitest-environment jsdom
/**
 * ═══ THE BAR KEEPS A FAILURE LINE THROUGH A LOADING STATE ═══════════════════
 *
 * Review, 2026-10-17: while a saved note's full text was loading (or had
 * failed to load) the bar showed only that state and Delete — and an
 * earlier save, upload or recording failure line vanished with the tools,
 * news nobody had read yet. Both lines are kept now.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing in the product: `NoteTools` is
 * rendered directly with plain props into the dock slot it portals into, and
 * the recorder prop is a plain idle object, because the claim is about what
 * the bar renders for a combination of states, not about how they arose.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DOCK_SLOT, NoteTools } from "../src/components/NoteTools";

let host: HTMLDivElement, root: Root, slot: HTMLSpanElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  slot = document.createElement("span");
  slot.id = DOCK_SLOT;
  document.body.append(slot);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); slot.remove(); });

const idle = { phase: "idle", seconds: 0, error: "", notice: "", start: vi.fn(), stop: vi.fn(), cancel: vi.fn() };

async function bar(extra: Partial<Parameters<typeof NoteTools>[0]>): Promise<string[]> {
  await act(async () => root.render(
    <NoteTools attaching={false} saving={false} recording={idle as never} failed="" uploading="Uploading…"
      recordLabel="Record" stopLabel="Stop" addLabel="Add" photoLabel="Add photo" fileLabel="Add file"
      keepLabel="Save" canKeep={false} onKeep={vi.fn()} eraseLabel="Delete" onErase={vi.fn()} onFile={vi.fn()}
      retryLabel="Try again" onRetry={vi.fn()} {...extra} />,
  ));
  await act(async () => { await Promise.resolve(); });
  return [...slot.querySelectorAll(".waka-dock-state")].map((node) => node.textContent ?? "");
}

it("keeps an earlier save failure beside the loading line", async () => {
  expect(await bar({ reading: "Opening…", failed: "That didn’t save." })).toEqual(["Opening…", "That didn’t save."]);
});

it("keeps Stop in the bar while another note is still loading", async () => {
  await bar({ reading: "Opening…", recording: { ...idle, phase: "recording", seconds: 12 } as never, stopLabel: "Stop recording" });
  expect(slot.querySelector('[aria-label="Stop recording"]')?.textContent, "a recording running into the next note's loading can still be stopped").toBe("0:12");
});

it("keeps Stop in the bar while a delete is armed during a recording", async () => {
  await bar({
    recording: { ...idle, phase: "recording", seconds: 7 } as never,
    erasePending: true, eraseQuestion: "Delete this for good?", eraseConfirmLabel: "Delete it anyway",
    cancelEraseLabel: "Not now", onCancelErase: vi.fn(), stopLabel: "Stop recording",
  });
  expect(slot.querySelector('[aria-label="Stop recording"]')?.textContent, "the way to stop the microphone stayed").toBe("0:07");
  expect(slot.querySelector('[aria-label="Delete it anyway"]')).not.toBeNull();
});

it("keeps a recorder failure beside a failed read, and Try again and Delete stay", async () => {
  /* the recorder's error reaches the bar already said, inside `failed` (dev, #443) */
  const lines = await bar({ readFailed: "Didn’t open.", failed: "The microphone stopped." });
  expect(lines).toEqual(["Didn’t open.", "The microphone stopped."]);
  expect(slot.querySelector(".waka-dock-retry")?.textContent).toBe("Try again");
  expect(slot.querySelector('[aria-label="Delete"]')).not.toBeNull();
});
