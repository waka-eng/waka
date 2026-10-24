// @vitest-environment jsdom
/**
 * DELETE AT ONCE, UNDO FOR A MOMENT, THE SHELF FOR A MONTH.
 *
 * Founder, 2026-10-15: "just delete when user clicks on this, but give option
 * to undo it. also create option to see all deleted inspirations in the
 * inspirations list."
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/data` (the archive reader) and
 * `lib/api` (the four inspiration verbs), because the claim is about what the page does with a
 * press — which call it makes, and when — not about the server, whose half
 * is `api/src/routes/inspirations-deleted.db.test.ts` on real SQL. The dock
 * the note's tools portal into is stood up as the bare element `Home`
 * lends, since the world around it is not what is being asserted.
 *
 * `helpers/archive` plays `Home`'s part: the archive's recorder lives in
 * `Home` now (L12), so the archive is mounted with the real
 * `useArchiveRecorder` handed to it, as `Home` mounts it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ deleted: [] as string[], restored: [] as string[], forgotten: [] as string[], scopes: [] as unknown[] }));
const shelf = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const row = (id: string, text: string, daysAgo: number) => ({ id, preview: text, text, capturedMs: Date.now() - daysAgo * 86_400_000, attachments: [], category: null });
  /* The full-text read a note now waits on before it can be edited. */
  const all = [row("b", "Second thing", 1), row("a", "First thing", 2)];
  return { ...actual, loadInspiration: async (id: string) => ({ ...all.find((item) => item.id === id)!, reflections: [] }), loadInspirations: async () => ({ inspirations: [row("b", "Second thing", 1), row("a", "First thing", 2)].reverse(), total: 2, short: false }) };
});
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    deleteInspiration: async (id: string) => { calls.deleted.push(id); },
    restoreInspiration: async (id: string, options: unknown) => { calls.restored.push(id); calls.scopes.push(options); },
    forgetDeletedInspiration: async (id: string) => { calls.forgotten.push(id); },
    listDeletedInspirations: async (options: unknown) => { calls.scopes.push(options); return shelf.rows; },
  };
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let dock: HTMLElement | null = null;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { calls.deleted = []; calls.restored = []; calls.forgotten = []; shelf.rows = []; calls.scopes=[]; });
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); dock?.remove();
  root = null; host = null; dock = null;
});

async function mount(profileId?: string) {
  const { Archive } = await import("./helpers/archive");
  const { DOCK_SLOT } = await import("../src/components/NoteTools");
  dock = document.createElement("span");
  dock.id = DOCK_SLOT;
  document.body.appendChild(dock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Archive, { profileId, locale: "en-US", title: "Your inspirations", onClose: () => undefined })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const leads = () => [...host!.querySelectorAll(".waka-list-lead")].map((node) => node.textContent);
const press = async (node: Element | null | undefined) => {
  expect(node, "nothing to press").toBeTruthy();
  await act(async () => { (node as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const byText = (selector: string, text: string) => [...document.querySelectorAll(selector)].find((node) => node.textContent?.trim() === text);

it("deletes on one press, offers Undo, and Undo puts it back without telling the server", async () => {
  await mount();
  expect(leads()).toEqual(["Second thing", "First thing"]);
  await press(host!.querySelector(".waka-list-row"));
  await press(dock!.querySelector('[aria-label="Delete"]'));
  expect(leads()).toEqual(["First thing"]);
  expect(host!.querySelector(".waka-over-undo")?.textContent).toContain("Deleted.");
  await press(byText(".waka-over-undo button", "Undo"));
  expect(leads()).toEqual(["Second thing", "First thing"]);
  expect(calls.deleted).toEqual([]);
});

it("tells the server when the page is left before Undo's moment passes", async () => {
  await mount();
  await press(host!.querySelector(".waka-list-row"));
  await press(dock!.querySelector('[aria-label="Delete"]'));
  await act(async () => { root!.unmount(); });
  root = null;
  expect(calls.deleted).toEqual(["b"]);
});

it("keeps a Deleted tab while anything is on the shelf, and brings a thing back from it", async () => {
  shelf.rows = [{ id: "z", text: "Something I threw away", kind: null, hadPhoto: true, keptAt: new Date().toISOString(), deletedAt: new Date().toISOString(), goneAt: new Date().toISOString() }];
  await mount();
  await press(byText(".waka-tab", "Deleted"));
  expect(host!.querySelector(".waka-shelf .waka-list-lead")?.textContent).toBe("Something I threw away");
  expect(host!.textContent).toContain("Attachments not kept");
  await press(byText(".waka-shelf-forget", "Delete for good"));
  expect(calls.forgotten, "one press deleted for good").toEqual([]);
  await press(byText(".waka-shelf-back", "Bring back"));
  expect(calls.restored).toEqual(["z"]);
});

it("offers to share the open note", async () => {
  await mount();
  await press(host!.querySelector(".waka-list-row"));
  expect(dock!.querySelector('[aria-label="Share this inspiration"]')).toBeTruthy();
});


it('shows search even for two inspirations and filters without leaving the archive',async()=>{
  await mount();
  const field=host!.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(field).not.toBeNull();
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'Second');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  expect(leads()).toEqual(['Second thing']);
});
it('lists and restores an agent’s media-only inspiration in that same profile',async()=>{
  shelf.rows=[{id:'agent-photo',text:'',kind:'image',hadPhoto:true,attachmentCount:1,attachmentName:'Sunset.jpg',keptAt:new Date().toISOString(),deletedAt:new Date().toISOString(),goneAt:new Date().toISOString()}];
  await mount('noah');
  expect(calls.scopes).toContainEqual({profile:'noah'});
  await press(byText('.waka-tab','Deleted'));
  expect(host!.textContent).toContain('Sunset.jpg');
  expect(host!.querySelector('.jar-saved-count')?.textContent).toBe('(1)');
  expect(host!.textContent).not.toContain('Attachments not kept');
  await press(byText('.waka-shelf-back','Bring back'));
  expect(calls.restored).toEqual(['agent-photo']);
  expect(calls.scopes.at(-1)).toEqual({profile:'noah'});
});
