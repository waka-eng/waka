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
/* which step answers with what, when a case says */
const fails = vi.hoisted(() => ({ step: null as null | "presign" | "upload" | "finalize", status: 404, message: "" }));
vi.mock("../src/lib/api", async (original) => {
  const actual = await original<typeof import("../src/lib/api")>();
  const refuse = (step: string) => { if (fails.step === step) throw new actual.ApiError({ status: fails.status, message: fails.message }); };
  return {
  ...actual,
  presignAttachment: async (input: unknown, _signal: unknown, options?: { profile?: string }) => {
    refuse("presign");
    calls.push(["presign", { input, profile: options?.profile }]);
    return { uploadUrl: "https://bucket.test/put", key: "k/1", headers: { a: "b" }, profileId: options?.profile ?? "me", expiresAt: "" };
  },
  uploadToPresignedUrl: async (url: string) => { refuse("upload"); calls.push(["upload", url]); },
  finalizeAttachment: async (input: unknown) => { refuse("finalize"); calls.push(["finalize", input]); return { id: "att" }; },
  };
});

import { ApiError } from "../src/lib/api";
import { attachToNote, NoteGoneError } from "../src/lib/attach-to-note";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
beforeEach(() => { calls.length = 0; Object.assign(fails, { step: null, status: 404, message: "" }); });

it("presigns under the note's owner, uploads, and finalizes onto that note", async () => {
  const file = new File(["x"], "Recording.webm", { type: "audio/webm" });
  await attachToNote(file, { noteId: "note-1", profileId: "agent-1", type: "audio" });
  expect(calls.map(([what]) => what)).toEqual(["presign", "upload", "finalize"]);
  expect(calls[0]![1]).toEqual({ input: { filename: "Recording.webm", contentType: "audio/webm", size: 1 }, profile: "agent-1" });
  expect(calls[2]![1]).toEqual({ type: "audio", inspirationId: "note-1", key: "k/1", name: "Recording.webm", size: 1, contentType: "audio/webm" });
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

/* ═══ ONLY THE NOTE'S OWN ABSENCE IS "THE NOTE IS GONE" (review, 2026-10-22)
   Every 404 used to read as a deleted note, and the clip was dropped. Only
   finalize's parent lookup ("Inspiration not found") and a 410 are about the
   note; a 404 from presign, from the bucket's PUT, or finalize's own "S3
   object not found" is an upload that failed and can be tried again. */
const clip = () => new File(["x"], "Recording.webm", { type: "audio/webm" });
const to = { noteId: "note-1", profileId: null, type: "file" as const };
const thrown = async () => { try { await attachToNote(clip(), to); return null; } catch (reason) { return reason; } };

it.each([
  ["finalize", 404, "Inspiration not found"],
  ["finalize", 410, "This inspiration was deleted."],
] as const)("says the note is gone when %s answers %i %s", async (step, status, message) => {
  Object.assign(fails, { step, status, message });
  expect(await thrown()).toBeInstanceOf(NoteGoneError);
});

it.each([
  ["presign", 404, "Not found"],
  ["upload", 404, "Upload failed"],
  ["finalize", 404, "S3 object not found at the supplied key. Did the PUT succeed?"],
] as const)("keeps a %s %i (%s) a failed upload, not a gone note", async (step, status, message) => {
  Object.assign(fails, { step, status, message });
  const reason = await thrown();
  expect(reason).toBeInstanceOf(ApiError);
  expect(reason).not.toBeInstanceOf(NoteGoneError);
});
