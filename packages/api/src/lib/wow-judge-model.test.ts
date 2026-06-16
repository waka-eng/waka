import { describe, expect, it } from "vitest";

import { buildWowGenerateContentUrl } from "./wow-judge.js";

describe("wow judge Gemini model endpoint", () => {
  it("uses the configured Gemini flash-lite model endpoint", () => {
    expect(buildWowGenerateContentUrl()).toContain(
      "/models/gemini-3.1-flash-lite:generateContent",
    );
  });
});
