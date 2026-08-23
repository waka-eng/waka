import { describe, expect, it } from "vitest";

import { verifyQuote } from "./salience.js";

/*
 * The verifier had no test and no caller. `docs/known-issues.md` H2 recorded
 * both, and checked the behaviour by hand from a copy outside the repo; these
 * are those checks, brought inside so the next reader does not have to.
 */
describe("verifyQuote", () => {
  const memory = {
    text: "I keep gravitating to libraries and empty cafes on weekday mornings",
    enrichment: null,
  };

  it("refuses a paraphrase — the exact case that reached the wall", () => {
    expect(verifyQuote("she prefers quiet research rooms", memory)).toBeNull();
  });

  it("keeps a span the person actually wrote", () => {
    expect(verifyQuote("gravitating to libraries and empty cafes", memory)).toEqual({
      quote: "gravitating to libraries and empty cafes",
      source: "own",
    });
  });

  it("refuses anything absent, empty or not a string", () => {
    expect(verifyQuote(null, memory)).toBeNull();
    expect(verifyQuote(undefined, memory)).toBeNull();
    expect(verifyQuote("", memory)).toBeNull();
  });

  it("refuses a scrap too short to point at anything", () => {
    // present in the text, but a few characters match everywhere
    expect(verifyQuote("libraries", memory)).toBeNull();
  });

  it("survives the re-wrapping a model does to what it copies", () => {
    expect(
      verifyQuote("gravitating to libraries\n  and   empty cafes", memory),
    ).not.toBeNull();
  });

  it("names the page as the source when the quote is the page's", () => {
    const withPage = { text: "worth keeping", enrichment: "the room you work in is the collaborator you never chose" };
    expect(verifyQuote("the room you work in is the collaborator", withPage)).toEqual({
      quote: "the room you work in is the collaborator",
      source: "enrichment",
    });
  });

  it("refuses a quote found in neither author", () => {
    const withPage = { text: "worth keeping", enrichment: "a short page" };
    expect(verifyQuote("something nobody ever wrote here", withPage)).toBeNull();
  });
});
