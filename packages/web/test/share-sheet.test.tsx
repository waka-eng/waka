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
 * blob handles, `navigator` a share sheet and a clipboard, `ClipboardItem`
 * the clipboard's image wrapper, and `fetch` the photo's bytes. For the
 * touch-screen editor, `matchMedia` stands in for a coarse pointer,
 * `getComputedStyle` for the size the stylesheet's 16px floor gives the
 * field, and `getBoundingClientRect` for the card's shown width — jsdom has
 * no pointer, applies no stylesheet and lays nothing out; the floor itself
 * is read off chrome.css. Everything else — the editing, the actions — is
 * real.
 *
 * Founder, 2026-10-16: one design (the first, dark and square), unsigned,
 * no looks row and no name switch; the words edited in the bubble itself
 * rather than in a box under the card; a plain × to close; two plain icons.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ShareSheet, touchEditorScale, type ShareTarget } from "../src/components/ShareSheet";
import { fetchAttachmentUrl } from "../src/lib/api";
import { ArtifactLayoutError, renderShareCard, type ShareCardLayout } from "../src/lib/principle-artifact";

const LAYOUT: ShareCardLayout = {
  width: 1080, height: 1080,
  bubble: { x: 112, y: 300, w: 856, h: 320, radius: 84, fill: "#e9dfcc" },
  text: { x: 176, y: 364, w: 728, size: 44, leading: 1.42, weight: 400, family: "Jost", ink: "#151821", align: "left" },
  edit: { x: 112, y: 300, w: 856, h: 320, padTop: 55, padX: 64, padBottom: 64, radiusTop: 84, radiusBottom: 84, rotation: 0, origin: { x: 540, y: 460 } },
};

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
  vi.mocked(renderShareCard).mockImplementation(async (content) => ({ blob: new Blob([content.items[0]!.text], { type: "image/png" }), width: 1080, height: 1080, fallbackFont: false, layout: LAYOUT }));
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

const mount = (target: ShareTarget = SAVE) => act(async () => root.render(<ShareSheet target={target} locale="en-US" onClose={close} />));
const settle = () => act(async () => vi.advanceTimersByTimeAsync(200));
/* By visible words or, for the icon buttons, by the name they give a screen reader. */
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent === text || row.getAttribute("aria-label") === text);
it("opens on the one design, unsigned, with the kept words and two icon actions", async () => {
  await mount();
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith({ items: [{ text: SAVE.text }], name: "", appearance: "dark", format: "square", kind: "inspiration", proof: SAVE.proof, photo: null });
  expect(host.querySelector("img")?.alt).toContain(SAVE.text);
  /* Save and share are two plain icons, named for screen readers, no text. */
  const save = button("Save image")!, share = button("Share image")!;
  expect(save.disabled).toBe(false);
  expect(save.className).toBe("jar-share-icon");
  expect(share.className).toBe("jar-share-icon");
  expect(save.textContent).toBe("");
  /* No looks, no name switch, no separate wording box. */
  expect(host.querySelector(".jar-share-look"), "one design: no looks row").toBeNull();
  expect(host.querySelector(".jar-share-name"), "always signed: no name switch").toBeNull();
  expect(button("Edit wording"), "the words are edited in the bubble").toBeUndefined();
  expect(host.querySelector("h2")?.textContent).toBe("Share this inspiration, edit as needed");
});

it("closes with a plain × in the corner", async () => {
  await mount();
  await settle();
  const x = host.querySelector<HTMLButtonElement>(".jar-share-x")!;
  expect(x.getAttribute("aria-label")).toBe("Close");
  expect(x.textContent).toBe("");
  await act(async () => x.click());
  expect(close).toHaveBeenCalledOnce();
});

it("edits the words in the bubble itself, laid over the bubble the card reports", async () => {
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-card .jar-share-inline")!;
  expect(area, "the words are a field over the card").not.toBeNull();
  /* Placed on the bubble, in the card's own face, as a share of the card. */
  expect(area.style.left).toBe(`${(112 / 1080) * 100}%`);
  expect(area.style.top).toBe(`${(300 / 1080) * 100}%`);
  expect(area.style.fontFamily).toBe("Jost");
  expect(area.style.fontSize).toBe(`${(44 / 1080) * 100}cqw`);
  expect(area.value).toBe(SAVE.text);
  await act(async () => {
    area.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Small first moves.");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ text: "Small first moves." }] }));
  await act(async () => button("Use original wording")!.click());
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ text: SAVE.text }] }));
});

it("Escape leaves the words and keeps the sheet open", async () => {
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  await act(async () => area.focus());
  await act(async () => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.activeElement).not.toBe(area);
  expect(close).not.toHaveBeenCalled();
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

it("says the top of mind the way the home bubble does, under the top-of-mind date line", async () => {
  await mount({ kind: "topOfMind", text: "Build the place.", proof: "My top of mind · Oct 16, 2026" });
  await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "topOfMind", frame: "This is what’s on your mind right now.", name: "", proof: "My top of mind · Oct 16, 2026" }));
  expect(host.querySelector("h2")?.textContent).toBe("Share what’s on your mind, edit as needed");
});

it("without a device share sheet, sharing puts the image on the clipboard", async () => {
  const write = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
  vi.stubGlobal("ClipboardItem", class { constructor(readonly items: Record<string, Blob>) {} });
  await mount();
  await settle();
  await act(async () => button("Share image")!.click());
  expect(write).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Image copied. Paste it anywhere.");
  Reflect.deleteProperty(navigator, "clipboard");
});

it("without a share sheet or a clipboard, sharing saves the image", async () => {
  Reflect.deleteProperty(navigator, "clipboard");
  await mount();
  await settle();
  await act(async () => button("Share image")!.click());
  expect(URL.createObjectURL).toHaveBeenCalled();
  expect(host.textContent).toContain("Image download started.");
});

/* NO FOCUS-ZOOM IN THE BUBBLE. iOS zooms the page when a field under 16px
   takes focus; on a phone the card's words are drawn at ~11px. */
it("scales the editor so its text can sit at the 16px floor and still match the drawn words", () => {
  expect(touchEditorScale(16, 16)).toBe(1);
  expect(touchEditorScale(10, 16)).toBeCloseTo(1.6);
  expect(touchEditorScale(20, 16), "shown above the floor (a tablet): laid out smaller, scaled up").toBeCloseTo(0.8);
  expect(touchEditorScale(0, 16), "nothing measured: no scale").toBe(1);
  expect(touchEditorScale(10, Number.NaN)).toBe(1);
});

const pointer = (coarse: boolean) => vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
  matches: coarse && query === "(pointer: coarse)", media: query, addEventListener() {}, removeEventListener() {},
})));

it("on a touch screen, lays the editor out at the floor and scales it back to the card's size", async () => {
  pointer(true);
  const realStyle = window.getComputedStyle.bind(window);
  /* On a coarse pointer the stylesheet's floor wins over the field's inline size. */
  const style = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const computed = realStyle(el, pseudo);
    return el.classList.contains("jar-share-inline") ? ({ ...computed, fontSize: "16px" } as CSSStyleDeclaration) : computed;
  });
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains("jar-share-card") ? 270 : 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
  });
  try {
    await mount();
    await settle();
    const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
    /* 44 card px on a card shown 270 wide is 11px; 16 / 11 is the factor. */
    const f = 16 / 11;
    expect(Number(area.dataset.touchScale)).toBeCloseTo(f, 3);
    expect(area.style.transform).toBe(`scale(${1 / f})`);
    expect(area.style.transformOrigin).toBe("0 0");
    const [pct, px] = /calc\(([\d.]+)% \+ ([\d.]+)px\)/.exec(area.style.width)!.slice(1).map(Number);
    expect(pct).toBeCloseTo((856 / 1080) * 100 * f, 2);
    /* the 2px wrap slack, laid out f times larger like everything else */
    expect(px).toBeCloseTo(2 * f, 6);
    /* Laid out at the floor (44·f card px on a 270px card is 16px)… */
    expect((parseFloat(area.style.fontSize) / 100) * 270).toBeCloseTo(16, 6);
    /* …and seen at the drawn size once scaled back. */
    expect((parseFloat(area.style.fontSize) / 100) * 270 / f).toBeCloseTo(11, 6);
  } finally {
    rect.mockRestore();
    style.mockRestore();
  }
});

it("with a mouse, the editor is the card's own size and not scaled", async () => {
  pointer(false);
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  expect(area.dataset.touchScale).toBeUndefined();
  expect(area.style.transform).toBe("");
  expect(area.style.fontSize).toBe(`${(44 / 1080) * 100}cqw`);
});

it("keeps the bubble's editor under the stylesheet's 16px coarse-pointer floor", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/chrome.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /* The editor is a textarea in the share sheet, so the restated floor reaches it… */
  expect(css).toMatch(/@media \(pointer: coarse\) \{[^@]*body \.jar-thing-share textarea[^{]*\{\s*font-size:\s*var\(--t-lead\)\s*!important/);
  /* …and nothing sizes it at a strength that could out-rank that floor. */
  expect(css).not.toMatch(/\.jar-share-inline[^{]*\{[^}]*font-size[^;}]*!important/);
});

const typeInto = (area: HTMLTextAreaElement, text: string) => act(async () => {
  area.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
  area.dispatchEvent(new Event("input", { bubbles: true }));
});

/* THE FIELD NEVER GOES AWAY ON A FAILURE: the words are fixed in place. */
it("keeps the field over the last good card when the words stop fitting, and says why beneath", async () => {
  await mount();
  await settle();
  vi.mocked(renderShareCard).mockRejectedValue(new ArtifactLayoutError("too_long"));
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  await typeInto(area, "far too many words ".repeat(40));
  await settle();
  const still = host.querySelector<HTMLTextAreaElement>(".jar-share-card .jar-share-inline");
  expect(still, "the field stays where the words are").toBe(area);
  expect(document.activeElement).toBe(area);
  expect(still!.classList.contains("jar-share-inline--live"), "shown solid over the stale card").toBe(true);
  expect(host.querySelector(".jar-share-card img"), "the last good card stays").not.toBeNull();
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Shorten the words so they fit on the card.");
  expect(button("Save image")!.disabled).toBe(true);
  /* Shortened in place, the card draws again and the field goes back to clear. */
  vi.mocked(renderShareCard).mockImplementation(async (content) => ({ blob: new Blob([content.items[0]!.text], { type: "image/png" }), width: 1080, height: 1080, fallbackFont: false, layout: LAYOUT }));
  await typeInto(area, "Short again.");
  await settle();
  expect(host.querySelector("[role=alert]")).toBeNull();
  expect(area.classList.contains("jar-share-inline--live")).toBe(false);
  expect(button("Save image")!.disabled).toBe(false);
});

it("opens on a blank bubble with the field when the kept words cannot be drawn at all", async () => {
  vi.mocked(renderShareCard).mockRejectedValue(new ArtifactLayoutError("too_long"));
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-card--blank .jar-share-inline");
  expect(area, "a field to fix the words in").not.toBeNull();
  expect(area!.value).toBe(SAVE.text);
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Shorten the words");
});

it("keeps the blank bubble's field mounted and focused through every keystroke of the fix", async () => {
  vi.mocked(renderShareCard).mockRejectedValue(new ArtifactLayoutError("too_long"));
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  for (const text of [`${SAVE.text}!`, `${SAVE.text}!!`, `${SAVE.text}!!!`]) {
    await typeInto(area, text);
    /* mid-redraw (the error is cleared while the next attempt runs) and after it */
    expect(host.querySelector(".jar-share-inline"), "the same field, still there").toBe(area);
    expect(document.activeElement).toBe(area);
    expect(area.classList.contains("jar-share-inline--live")).toBe(true);
    await settle();
    expect(host.querySelector(".jar-share-inline")).toBe(area);
    expect(document.activeElement).toBe(area);
  }
});

it("when the clipboard refuses the image, sharing saves it instead", async () => {
  const write = vi.fn(async () => { throw new DOMException("Denied", "NotAllowedError"); });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
  vi.stubGlobal("ClipboardItem", class { constructor(readonly items: Record<string, Blob>) {} });
  try {
    await mount();
    await settle();
    await act(async () => button("Share image")!.click());
    expect(write).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(host.textContent).toContain("Image download started.");
    expect(host.textContent).not.toContain("Sharing isn’t available here.");
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("turns the kept note's field with the note, about the note's centre", async () => {
  const tilted: ShareCardLayout = { ...LAYOUT, edit: { ...LAYOUT.edit, rotation: -0.026, origin: { x: 540, y: 460 } } };
  vi.mocked(renderShareCard).mockImplementation(async (content) => ({ blob: new Blob([content.items[0]!.text], { type: "image/png" }), width: 1080, height: 1080, fallbackFont: false, layout: tilted }));
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  expect(area.style.transform).toContain("rotate(-0.026rad)");
  expect(area.style.transformOrigin).toBe("0 0");
  /* about the note's centre: (540 - 112, 460 - 300) card px from the field's corner */
  const [dx, dy] = /^translate\(([\d.]+)cqw, ([\d.]+)cqw\)/.exec(area.style.transform)!.slice(1).map(Number);
  expect(dx).toBeCloseTo((428 / 1080) * 100, 3);
  expect(dy).toBeCloseTo((160 / 1080) * 100, 3);
});

it("gives the field's lines a little slack so the widest one never wraps early", async () => {
  await mount();
  await settle();
  const area = host.querySelector<HTMLTextAreaElement>(".jar-share-inline")!;
  const [pct, px] = /calc\(([\d.]+)% \+ ([\d.]+)px\)/.exec(area.style.width)!.slice(1).map(Number);
  expect(pct).toBeCloseTo((856 / 1080) * 100, 2);
  expect(px).toBe(2);
});

it("wraps the field as the canvas does, with no scrollbar unless the words failed to fit", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/chrome.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => css.split("\n").find((line) => line.startsWith(`${sel} {`)) ?? "";
  const base = rule(".jar-thing-share .jar-share-inline");
  expect(base).toMatch(/text-wrap:wrap;/);
  /* at spaces only, so a Korean word is never split; inside a word only when it is wider than the line */
  expect(base).toMatch(/word-break:keep-all;/);
  expect(base).toMatch(/overflow-wrap:anywhere;/);
  expect(base).toMatch(/hyphens:none;/);
  expect(base).toMatch(/overflow:hidden;/);
  expect(rule(".jar-thing-share .jar-share-inline:focus")).toMatch(/overflow:hidden;/);
  /* after a failed draw, all the words can be seen, to know what to cut — and only then */
  expect(rule(".jar-thing-share .jar-share-inline.jar-share-inline--live")).toMatch(/overflow:auto;/);
  const scrolling = [...css.matchAll(/([^{}\n]*\.jar-share-inline[^{]*)\{[^}]*overflow:(auto|scroll)/g)].map((m) => m[1]!.trim());
  expect(scrolling).toEqual([".jar-thing-share .jar-share-inline.jar-share-inline--live"]);
});
