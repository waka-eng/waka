import { describe, expect, it } from "vitest";

import { verifyQuote } from "./salience.js";

const save = {
  text: "Deployment is the new product frontier.\nThe model stopped being the hard part a while ago.",
  enrichment: "The article argues that context, not capability, decides what ships.",
};

describe("verifyQuote", () => {
  it("keeps a span the person actually wrote", () => {
    expect(verifyQuote("Deployment is the new product frontier", save)).toEqual({
      quote: "Deployment is the new product frontier",
      source: "own",
    });
  });

  it("forgives re-wrapping, because a model always re-wraps what it copies", () => {
    expect(
      verifyQuote("the model stopped being   the hard part", save)?.source,
    ).toBe("own");
  });

  it("names the page as the author when the words came from the page", () => {
    /**
     * The distinction that matters: a quote from the enrichment is the article
     * speaking, and attributing its argument to the member would be a claim
     * about them nobody made.
     */
    expect(verifyQuote("context, not capability, decides what ships", save)).toEqual({
      quote: "context, not capability, decides what ships",
      source: "enrichment",
    });
  });

  it("refuses a paraphrase, however close", () => {
    expect(verifyQuote("Deployment is the new frontier for products", save)).toBeNull();
  });

  it("refuses a span stitched from separate places", () => {
    expect(verifyQuote("Deployment is the hard part", save)).toBeNull();
  });

  it("refuses a fragment too short to point at anything", () => {
    expect(verifyQuote("the model", save)).toBeNull();
  });

  it("refuses an absent or empty quote without complaint", () => {
    expect(verifyQuote(null, save)).toBeNull();
    expect(verifyQuote(undefined, save)).toBeNull();
    expect(verifyQuote("   ", save)).toBeNull();
  });

  it("does not invent an enrichment match when there is no enrichment", () => {
    expect(verifyQuote("decides what ships", { text: save.text, enrichment: null })).toBeNull();
  });
});
