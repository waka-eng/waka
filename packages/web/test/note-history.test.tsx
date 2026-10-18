// @vitest-environment jsdom
/**
 * AN OPEN NOTE IS ONE STEP OF BACK, AND SO IS SWITCHING NOTES (review).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. A real `MemoryRouter` and the
 * archive's own `NoteHistory`; the archive around it is not the subject.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NoteHistory } from "../src/components/SavesOverlay";

let host: HTMLDivElement, root: Root;
let go: ReturnType<typeof useNavigate>, where: ReturnType<typeof useLocation>;
let setOpen!: (id: string | null) => void;
function Harness() {
  go = useNavigate(); where = useLocation();
  const [openId, set] = useState<string | null>(null); setOpen = set;
  // Back closes the note, as the archive's `leaveNote` does when it can.
  return <NoteHistory openId={openId} onBack={() => set(null)} />;
}
const open = (id: string | null) => act(async () => { setOpen(id); });
const mark = () => (where.state as { savesNote?: string } | null)?.savesNote ?? null;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={["/?open=saves"]}><Harness /></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("going from one note straight to another replaces the entry, so one Back reaches the list", async () => {
  await open("note-a");
  expect(mark()).toBe("note-a");
  await open("note-b");
  expect(mark()).toBe("note-b");
  await act(async () => { go(-1); });
  expect(mark(), "Back from B landed on A's entry").toBeNull();
  expect(where.search).toBe("?open=saves");
});
