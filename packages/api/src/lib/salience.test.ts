/**
 * Which of the model's words may be attributed to a person.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6)
 *
 * Nothing, and nothing needs replacing. Both functions under test are pure
 * string work — a claimed quote and the text it claims to come from in, a
 * verdict out. No network, no database, no clock. A double here would be a
 * second implementation of the same comparison, and the test would then be
 * checking the double.
 *
 * WHY THIS FILE EXISTS AT ALL. `verifyQuote` was written, correct and
 * documented on 2026-08-01 and then called by nothing for three weeks, while
 * the live path stored unverified model text that the world renders as a lit
 * span of the person's own memory. `docs/known-issues.md` logs that as H2.
 * A judge with no caller and no test is a safety property the codebase
 * believes it has; these assertions are the difference.
 *
 * So the point of the cases below is not that `verifyQuote` computes what it
 * says. It is that deleting either ordering rule inside `quoteForEvidence`
 * turns a test red — because the two ways of getting this wrong both end
 * with words on screen that the person never wrote.
 */

import { describe, expect, it } from "vitest";

import { quoteForEvidence, verifyQuote } from "./salience.js";

const MEMORY = {
  text: "Rebuilt the exporter as a forty-line script tonight, and it outlived the vendor tool it replaced.",
  enrichment: "The article argues that small sharp tools outlast the platforms that market them.",
};

describe("verifying a claimed quote", () => {
  it("keeps a span the person actually wrote, and says whose it is", () => {
    expect(verifyQuote("outlived the vendor tool it replaced", MEMORY)).toEqual({
      quote: "outlived the vendor tool it replaced",
      source: "own",
    });
  });

  /* The refusal is the feature: models paraphrase, and a paraphrase set in a
     highlight is a sentence attributed to someone who never wrote it. */
  it("refuses a paraphrase, however faithful", () => {
    expect(verifyQuote("rebuilt the exporter as a short script", MEMORY)).toBeNull();
  });

  it("forgives re-wrapping and re-spacing, which is all a copy loses", () => {
    expect(
      verifyQuote("outlived   the vendor\n tool it replaced", MEMORY),
    ).toMatchObject({ source: "own" });
  });

  it("tells the page's words apart from the person's", () => {
    expect(verifyQuote("small sharp tools outlast the platforms", MEMORY)).toEqual({
      quote: "small sharp tools outlast the platforms",
      source: "enrichment",
    });
  });

  it.each([null, undefined, "", "   ", "too short"])(
    "reads %j as nothing to attribute",
    (value) => {
      expect(verifyQuote(value, MEMORY)).toBeNull();
    },
  );
});

describe("what reaches the evidence row", () => {
  const MAX = 500;

  it("stores the person's own span", () => {
    expect(quoteForEvidence("outlived the vendor tool it replaced", MEMORY, MAX)).toBe(
      "outlived the vendor tool it replaced",
    );
  });

  /* H2 itself: the invented quote that used to be stored and then rendered
     inside the memory's card as though the person had written it. */
  it("stores nothing when the model invented the span", () => {
    expect(quoteForEvidence("she prefers quiet research rooms", MEMORY, MAX)).toBeNull();
  });

  /* Real, but the article speaking. There is no column recording that and no
     way for the renderer to show it, so it may not be stored as the person's. */
  it("stores nothing when the words are the linked page's", () => {
    expect(
      quoteForEvidence("small sharp tools outlast the platforms", MEMORY, MAX),
    ).toBeNull();
  });

  it("clips a long honest quote instead of rejecting it", () => {
    const long = "Rebuilt the exporter as a forty-line script tonight, and it outlived";
    const stored = quoteForEvidence(long, MEMORY, 20);
    expect(stored).toBe("Rebuilt the exporter");
  });

  /*
    THE PROPERTY THAT ACTUALLY MATTERS, ASSERTED OVER EVERY CASE ABOVE.

    Not "the quote was verified" — that is the implementation describing
    itself — but the thing a reader of the product is owed: if the world is
    going to set these words in a highlight inside this person's memory and
    attribute them to them, the words have to BE in that memory. Anything
    stored is findable in `MEMORY.text`; anything not findable is stored as
    null. Clipping, paraphrase and the linked article are each covered.

    This is the assertion that fails if the verifier is unwired again, and it
    fails without naming `verifyQuote`, so it survives the rule moving.
  */
  it("never stores words the memory does not contain", () => {
    const claims = [
      "outlived the vendor tool it replaced",
      "she prefers quiet research rooms",
      "small sharp tools outlast the platforms",
      "Rebuilt the exporter as a forty-line script tonight, and it outlived",
      "rebuilt the exporter as a short script",
      "",
    ];
    for (const claim of claims) {
      const stored = quoteForEvidence(claim, MEMORY, 20);
      if (stored !== null) expect(MEMORY.text).toContain(stored);
    }
    // ...and it is not vacuous: at least one of them really is stored.
    expect(claims.some((c) => quoteForEvidence(c, MEMORY, 20) !== null)).toBe(true);
  });

  it("keeps a quote that exactly fills the budget whole", () => {
    const exact = "outlived the vendor tool it replaced";
    expect(quoteForEvidence(exact, MEMORY, exact.length)).toBe(exact);
  });

  it("is safe on a memory with no enrichment at all", () => {
    const bare = { text: MEMORY.text, enrichment: null };
    expect(quoteForEvidence("outlived the vendor tool it replaced", bare, MAX)).toBe(
      "outlived the vendor tool it replaced",
    );
    expect(quoteForEvidence("small sharp tools outlast the platforms", bare, MAX)).toBeNull();
  });
});
