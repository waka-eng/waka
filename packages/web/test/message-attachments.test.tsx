// @vitest-environment jsdom
/**
 * A PHOTO OR FILE UNDER WHAT WAS SAID.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` is mocked for
 * `fetchAttachmentUrl` only, the one seam a chat attachment's bytes are read
 * through — a presigned URL the server signs. `window.open` is replaced so a
 * click on a file whose link was not ready can be seen to open it. The
 * component, the catalogue and the locale are real.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MessageAttachments } from "../src/components/MessageAttachments";
import { fetchAttachmentUrl, type ApiMessageAttachment } from "../src/lib/api";
import type { SupportedLocale } from "../src/lib/locales";

vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof import("../src/lib/api")>(), fetchAttachmentUrl: vi.fn() }));

const base = { conversationId: "c-1", messageId: "m-1", staged: false, createdAt: "2026-10-16T00:00:00.000Z" };
const photo = (id: string, name: string | null): ApiMessageAttachment => ({ ...base, id, type: "image", name, contentType: "image/jpeg", size: 52_000 });
const file = (id: string, name: string | null, size: number | null): ApiMessageAttachment => ({ ...base, id, type: "file", name, contentType: "application/pdf", size });

let root: Root, host: HTMLDivElement;
const open = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "open").mockImplementation(open);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function show(attachments: ApiMessageAttachment[], locale: SupportedLocale = "en-US") {
  await act(async () => { root.render(<MessageAttachments attachments={attachments} locale={locale} />); });
  await act(async () => { await Promise.resolve(); });
}

it("renders nothing for a message with no attachments", async () => {
  await show([]);
  expect(host.innerHTML).toBe("");
  expect(fetchAttachmentUrl).not.toHaveBeenCalled();
});

it("shows each photo as a named link to its URL once the URL resolves", async () => {
  let resolve!: (url: string) => void;
  vi.mocked(fetchAttachmentUrl).mockImplementation((id) => id === "p-1"
    ? new Promise<string>((done) => { resolve = done; })
    : Promise.resolve(`https://storage.example.test/${id}.jpg`));
  await act(async () => { root.render(<MessageAttachments attachments={[photo("p-1", "beach.jpg"), photo("p-2", null)]} locale="en-US" />); });

  const waiting = host.querySelector('[aria-label="Photo: beach.jpg"]')!;
  expect(waiting.tagName).toBe("SPAN");
  expect(waiting.getAttribute("aria-busy")).toBe("true");

  await act(async () => { resolve("https://storage.example.test/p-1.jpg"); });
  const links = [...host.querySelectorAll("a")];
  expect(links.map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([
    ["Photo: beach.jpg", "https://storage.example.test/p-1.jpg"],
    ["Photo", "https://storage.example.test/p-2.jpg"],
  ]);
  for (const a of links) {
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.querySelector("img")?.getAttribute("src")).toBe(a.getAttribute("href"));
  }
  expect(host.querySelector(".chat-attachment-photos")?.getAttribute("data-cols")).toBe("2");
});

it("says quietly that a photo couldn’t load when its URL fails", async () => {
  vi.mocked(fetchAttachmentUrl).mockRejectedValue(new Error("nope"));
  await show([photo("p-1", "beach.jpg")]);
  const failed = host.querySelector('[aria-label="Photo: beach.jpg"]')!;
  expect(failed.getAttribute("data-state")).toBe("failed");
  expect(failed.textContent).toBe("Couldn’t load");
  expect(host.querySelector("a")).toBeNull();
});

it("also falls back when the image itself will not decode", async () => {
  vi.mocked(fetchAttachmentUrl).mockResolvedValue("https://storage.example.test/p-1.jpg");
  await show([photo("p-1", "beach.jpg")]);
  await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("Couldn’t load");
});

it("shows a file's name and human size, linked to its URL", async () => {
  vi.mocked(fetchAttachmentUrl).mockImplementation(async (id) => `https://storage.example.test/${id}`);
  await show([file("f-1", "brief.pdf", 245_760), file("f-2", "deck.key", 3_250_000), file("f-3", null, 900)]);
  const tiles = [...host.querySelectorAll(".chat-attachment-file")];
  expect(tiles.map((tile) => [
    tile.tagName,
    tile.querySelector(".chat-attachment-file-name")?.textContent,
    tile.querySelector(".chat-attachment-file-size")?.textContent,
    tile.getAttribute("href"),
  ])).toEqual([
    ["A", "brief.pdf", "240 KB", "https://storage.example.test/f-1"],
    ["A", "deck.key", "3.1 MB", "https://storage.example.test/f-2"],
    ["A", "File", "900 B", "https://storage.example.test/f-3"],
  ]);
  expect((tiles[0] as HTMLAnchorElement).target).toBe("_blank");
  expect((tiles[0] as HTMLAnchorElement).rel).toBe("noopener noreferrer");
});

it("lets a file whose link is not ready yet be pressed, then reads it and opens it", async () => {
  vi.mocked(fetchAttachmentUrl)
    .mockReturnValueOnce(new Promise<string>(() => {}))
    .mockResolvedValueOnce("https://storage.example.test/f-1");
  await show([file("f-1", "brief.pdf", 245_760)]);
  const button = host.querySelector("button.chat-attachment-file")!;
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await act(async () => { (button as HTMLButtonElement).click(); });
  expect(open).toHaveBeenCalledWith("https://storage.example.test/f-1", "_blank", "noopener,noreferrer");
  expect(host.querySelector("a.chat-attachment-file")?.getAttribute("href")).toBe("https://storage.example.test/f-1");
});

it("aborts the read when the message leaves the screen", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(fetchAttachmentUrl).mockImplementation((_id, s) => { signal = s; return new Promise<string>(() => {}); });
  await show([photo("p-1", "beach.jpg")]);
  expect(signal?.aborted).toBe(false);
  act(() => root.unmount());
  expect(signal?.aborted).toBe(true);
  root = createRoot(host);
});

it("speaks Korean", async () => {
  vi.mocked(fetchAttachmentUrl).mockImplementation(async (id) => {
    if (id === "p-2") throw new Error("nope");
    return `https://storage.example.test/${id}`;
  });
  await show([photo("p-1", "바다.jpg"), photo("p-2", null), file("f-1", null, 2048)], "ko-KR");
  expect(host.querySelector(".chat-attachments")?.getAttribute("aria-label")).toBe("첨부");
  expect(host.querySelector("a.chat-attachment-photo")?.getAttribute("aria-label")).toBe("사진: 바다.jpg");
  const failed = host.querySelector('[data-state="failed"]')!;
  expect(failed.getAttribute("aria-label")).toBe("사진");
  expect(failed.textContent).toBe("불러오지 못했어요");
  expect(host.querySelector(".chat-attachment-file-name")?.textContent).toBe("파일");
  expect(host.querySelector(".chat-attachment-file-size")?.textContent).toBe("2 KB");
});
