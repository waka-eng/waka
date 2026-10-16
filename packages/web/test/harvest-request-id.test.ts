/** WHAT THIS MOCKS, AND WHY (gate G6): nothing — a pure derivation, checked
 * against the vector the API's own test holds, so the browser and the server
 * cannot drift apart on which save belongs to which candidate. */
import { describe, expect, it } from "vitest";

import { candidateSaveRequestId, harvestSaveRequestId } from "../src/lib/harvest";

describe("a candidate's save request id", () => {
  it("matches the server's derivation, however the words are spaced", async () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    expect(await harvestSaveRequestId(id, " First, cut  right ")).toBe("f6b83865-eaaa-5d4e-acd9-db384f5742e4");
    expect(await harvestSaveRequestId(id, "First, cut right")).toBe("f6b83865-eaaa-5d4e-acd9-db384f5742e4");
  });
  it("is the candidate's own id when the words are unchanged", async () => {
    const candidate = { id: "00000000-0000-4000-8000-0000000000bb", text: "As said." };
    expect(await candidateSaveRequestId(candidate, "As said.")).toBe(candidate.id);
    expect(await candidateSaveRequestId(candidate, "As corrected.")).not.toBe(candidate.id);
  });
});
