// @vitest-environment jsdom
/**
 * A SAVE OR THE TOP OF MIND, MADE INTO A CARD AND SENT.
 *
 * Founder, 2026-10-15: "an extremely streamlined, intuitive experience the
 * user would want to share something ... a preview, save it to share as an
 * image, like how Strava and other products really make that sharing
 * experience nice."
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/principle-artifact` is mocked for
 * `renderShareCard` only, because a canvas cannot draw in jsdom and what
 * matters here is what the sheet ASKS the renderer for. `lib/api` is mocked
 * for `fetchAttachmentUrl`, the seam a photo is read through. `URL` supplies
 * blob handles, `navigator` a share sheet, and `fetch` the photo's bytes.
 * Everything else — the look store, the editing, the actions — is real.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ShareSheet, type ShareTarget } from "../src/components/ShareSheet";
import { fetchAttachmentUrl } from "../src/lib/api";
import { renderShareCard } from "../src/lib/principle-artifact";
import { readShareLook } from "../src/lib/share-look";

vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof import("../src/lib/api")>(), fetchAttachmentUrl: vi.fn() }));
vi.mock("../src/lib/principle-artifact", async (original) => ({ ...await original<typeof import("../src/lib/principle-artifact")>(), renderShareCard: vi.fn() }));

const SAVE: ShareTarget = { kind: "inspiration", text: "Make the first move small.", proof: "Kept Oct 3, 2026" };
const nativeShare = vi.fn(), nativeCanShare = vi.fn(), close = vi.fn();
const priorShare = Object.getOwnPropertyDescriptor(navigator, "share"), priorCanShare = Object.getOwnPropertyDescriptor(navigator, "canShare");
let root: Root, host: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(renderShareCard).mockImplementation(async (content) => ({ blob: new Blob([content.items[0]!.text], { type: "image/png" }), width: 1080, height: 1080, fallbackFont: false }));
  const BaseURL = URL;
  vi.stubGlobal("URL", class extends BaseURL { static createObjectURL = vi.fn(() => `blob:fixture-${crypto.randomUUID()}`); static revokeObjectURL = vi.fn(); });
  Object.defineProperty(navigator, "share", { configurable: true, value: nativeShare });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: nativeCanShare });
  nativeCanShare.mockReturnValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (priorShare) Object.defineProperty(navigator, "share", priorShare); else Reflect.deleteProperty(navigator, "share");
  if (priorCanShare) Object.defineProperty(navigator, "canShare", priorCanShare); else Reflect.deleteProperty(navigator, "canShare");
});

const mount = (target: ShareTarget = SAVE, name = "Agi") => act(async () => root.render(<ShareSheet target={target} name={name} locale="en-US" onClose={close} />));
const settle = () => act(async () => vi.advanceTimersByTimeAsync(200));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent === text);
const look = (label: string) => host.querySelector<HTMLButtonElement>(`.jar-share-look[aria-label="${label}"]`)!;

it("opens on the finished card, with the kept words, no name, and one action", async () => {
  await mount();
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith({ items: [{ text: SAVE.text }], name: "", appearance: "dark", format: "square", kind: "inspiration", proof: SAVE.proof, photo: null });
  expect(host.querySelector("img")?.alt).toContain(SAVE.text);
  /* Without a native share sheet the one action is saving the image, and it
     is the primary. */
  const save = button("Save image")!;
  expect(save.disabled).toBe(false);
  expect(save.className).toContain("jar-share-primary");
  expect(button("Share image")).toBeUndefined();
  expect(host.querySelector("textarea"), "the words should be a link away, not open").toBeNull();
});

it("changes the look in one press and remembers it for the next card", async () => {
  await mount();
  await settle();
  await act(async () => look("Light · Story").click());
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: "light", format: "portrait" }));
  expect(look("Light · Story").getAttribute("aria-pressed")).toBe("true");
  expect(readShareLook()).toMatchObject({ appearance: "light", format: "portrait" });
});

it("puts the name on only when asked, and remembers that too", async () => {
  await mount();
  await settle();
  await act(async () => host.querySelector<HTMLInputElement>(".jar-share-name input")!.click());
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Agi" }));
  expect(readShareLook().showName).toBe(true);
});

it("edits the card's words only, and can go back to the kept words", async () => {
  await mount();
  await settle();
  await act(async () => button("Edit wording")!.click());
  const area = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Small first moves.");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ text: "Small first moves." }] }));
  await act(async () => button("Use original wording")!.click());
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ text: SAVE.text }] }));
});

it("sends only the image through the native sheet, and never says it was posted", async () => {
  nativeCanShare.mockReturnValue(true);
  nativeShare.mockResolvedValue(undefined);
  await mount();
  await settle();
  await act(async () => button("Share image")!.click());
  expect(Object.keys(nativeShare.mock.calls[0]![0])).toEqual(["files"]);
  expect(host.textContent).toContain("Share sheet closed.");
  expect(host.textContent).not.toMatch(/posted|published/i);
});

it("keeps the card and says nothing when the native sheet is cancelled", async () => {
  nativeCanShare.mockReturnValue(true);
  nativeShare.mockRejectedValue(new DOMException("Canceled", "AbortError"));
  await mount();
  await settle();
  await act(async () => button("Share image")!.click());
  expect(host.querySelector("[role=status]")?.textContent ?? "").not.toContain("Share sheet closed.");
  expect(host.querySelector("img")).not.toBeNull();
});

it("makes a words-only card and says so when the photo cannot be read", async () => {
  vi.mocked(fetchAttachmentUrl).mockResolvedValue("https://storage.example.test/photo.jpg");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("blocked by CORS"); }));
  await mount({ ...SAVE, photoId: "photo-1" });
  await settle();
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ text: SAVE.text }], photo: null }));
  expect(host.textContent).toContain("The photo couldn’t go on this card");
  expect(button("Save image")!.disabled).toBe(false);
});

it("offers no name switch when there is no name to show", async () => {
  await mount(SAVE, "");
  await settle();
  expect(host.querySelector(".jar-share-name")).toBeNull();
});
