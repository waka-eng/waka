/**
 * ═══ A NOTE BROUGHT BACK FROM THE SHELF DOES NOT MOVE THE DIAL'S NOW ═══════
 *
 * Review, 2026-10-17. `birthInspiration` is how a note joins the field, and
 * for a NEW note it also moves the dial's `now` to the note's moment — that
 * is what "now moves when something is kept now" means. A note restored from
 * the deleted shelf is not new: born the same way, it moved `now` back to
 * its own old date and every later day fell off the dial.
 *
 * Read from the source rather than driven through the page: the dial's
 * handle only shows once the wall is wound away from now, and reaching that
 * state and a shelf restore in one jsdom world proved brittle. The claim is
 * narrow and exact — the restore path births with `keepClock`, and the
 * function honours it — and a source read states it exactly.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing: it reads `pages/Home.tsx`
 * off disk, as `phone-breakpoints.test.ts` reads the stylesheets.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const HOME = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/pages/Home.tsx"), "utf8");

it("births a restored note without moving the dial's now", () => {
  const restore = HOME.slice(HOME.indexOf("const restoredInspiration = "), HOME.indexOf("const restoredInspirationRef"));
  expect(restore.length, "the restore path was not found").toBeGreaterThan(0);
  expect(restore, "the restore births its note with keepClock = true").toContain("birthInspiration(made.id, detail.preview, Date.parse(made.createdAt), made.id, true)");
  const birth = HOME.slice(HOME.indexOf("const birthInspiration = "), HOME.indexOf("inspirationSaveHandlers.current = {"));
  expect(birth, "and birthInspiration only moves the clock without it").toMatch(/if \(!keepClock\) setClockMs\(atMs\);/);
});
