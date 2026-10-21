/**
 * ═══ ONE ATTACH, TWO CALLERS ═════════════════════════════════════════════
 * Review of `claude/recorder-in-home` (2026-10-21): the archive's photo door
 * (`SavesOverlay`'s `attach`) and the archive's recorder (`Home`'s, in
 * `lib/archive-recorder.ts`) each wrote presign → upload → finalize, so the
 * two could drift on which profile the presign names or what the finalize
 * sends. Both call `attachToNote` now; this holds what it sends and that
 * neither caller grows its own copy again.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/api` — the three HTTP calls are
 * the subject, so they are recorded where the helper makes them.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  presignAttachment: async (input: unknown, _signal: unknown, options?: { profile?: string }) => {
    calls.push(["presign", { input, profile: options?.profile }]);
    return { uploadUrl: "https://bucket.test/put", key: "k/1", headers: { a: "b" }, profileId: options?.profile ?? "me", expiresAt: "" };
  },
  uploadToPresignedUrl: async (url: string) => { calls.push(["upload", url]); },
  finalizeAttachment: async (input: unknown) => { calls.push(["finalize", input]); return { id: "att" }; },
}));

import { attachToNote } from "../src/lib/attach-to-note";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
beforeEach(() => { calls.length = 0; });

it("presigns under the note's owner, uploads, and finalizes onto that note", async () => {
  const file = new File(["x"], "Recording.webm", { type: "audio/webm" });
  await attachToNote(file, { noteId: "note-1", profileId: "agent-1", type: "file" });
  expect(calls.map(([what]) => what)).toEqual(["presign", "upload", "finalize"]);
  expect(calls[0]![1]).toEqual({ input: { filename: "Recording.webm", contentType: "audio/webm", size: 1 }, profile: "agent-1" });
  expect(calls[2]![1]).toEqual({ type: "file", inspirationId: "note-1", key: "k/1", name: "Recording.webm", contentType: "audio/webm" });
});

it("presigns as the signed-in profile when no owner is named", async () => {
  await attachToNote(new File(["x"], "p.png", { type: "image/png" }), { noteId: "n", profileId: null, type: "image" });
  expect((calls[0]![1] as { profile?: string }).profile).toBeUndefined();
  expect((calls[2]![1] as { type: string }).type).toBe("image");
});

it("is the only attach either archive door writes", () => {
  for (const file of ["components/SavesOverlay.tsx", "lib/archive-recorder.ts"]) {
    const source = readFileSync(resolve(SRC, file), "utf8");
    expect(source, `${file} calls presign itself`).not.toMatch(/presignAttachment\(/);
    expect(source, `${file} does not use the shared attach`).toMatch(/attachToNote\(/);
  }
});
