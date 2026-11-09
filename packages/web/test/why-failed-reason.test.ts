/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. `whyOf` is a pure function of
 * an error and a locale; the errors are the API client's own `ApiError`. */
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/lib/api";
import { whyOf } from "../src/lib/why-failed";

/* CODE REVIEW, 2026-11-09: the language pass turned every refusal into
   "Something went wrong. Try again." — so a 413 (too large), a 422 (not
   valid) or a 409 (changed elsewhere) told the person to retry the one thing
   retrying cannot fix, and hid the reason the server gave. */
describe("a refusal says the server's reason, and offers a retry only when one can help", () => {
  it("passes on the reason for a refusal retrying cannot fix, with no Try again", () => {
    for (const status of [400, 409, 413, 422]) {
      const said = whyOf(new ApiError({ status, message: "That file is too large" }), "en-US");
      expect(said, `${status}`).toContain("That file is too large");
      expect(said, `${status} offered a retry that cannot help`).not.toMatch(/try again/i);
      expect(said, `${status} printed its status code`).not.toMatch(/\d{3}/);
    }
  });
  it("asks for another try when the trouble may pass", () => {
    for (const status of [429, 500, 502, 503]) {
      const said = whyOf(new ApiError({ status, message: "Busy" }), "en-US");
      expect(said, `${status}`).toContain("Busy");
      expect(said, `${status}`).toMatch(/Try again/);
      expect(said).not.toMatch(/\d{3}/);
    }
  });
  it("with no reason given, adds nothing to a refusal and still asks for another try when one can help", () => {
    expect(whyOf(new ApiError({ status: 422, message: "" }), "en-US")).toBe("");
    expect(whyOf(new ApiError({ status: 500, message: "" }), "ko-KR")).toMatch(/다시 시도/);
    expect(whyOf(new ApiError({ status: 503, message: "" }), "en-US")).toMatch(/Try again/);
  });
  it("uses no dashes", () => {
    for (const status of [409, 500]) expect(whyOf(new ApiError({ status, message: "x" }), "en-US")).not.toMatch(/—|–| - /);
  });
});
