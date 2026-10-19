/**
 * The pure halves of match-or-mint: which similarities attach, which ask the
 * judge, which mint — and what evidence makes confidence move. The judge call
 * itself and the DB paths are exercised end to end by tools/e2e/signals.ts;
 * what belongs here is the arithmetic no live run can pin down exactly.
 */

import { describe, expect, it } from "vitest";

import {
  classifyMatch,
  computeSignalConfidence,
  CONFIDENCE_AFFIRMED_BONUS,
  CONFIDENCE_SOURCE_DIVERSITY_BONUS,
  resolveRelatedEvidence,
  SIGNAL_MATCH_MIN_COSINE,
  SIGNAL_MERGE_JUDGE_MIN_COSINE,
} from "./signal-derivation.js";
import {
  MAX_RELATED_INSPIRATION_CITATIONS,
  parseSignalCandidates,
} from "../queue/gemini.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function evidence(daysAgo: number, source: "app" | "agent" = "app") {
  return { createdAt: new Date(NOW.getTime() - daysAgo * DAY), source };
}

describe("classifyMatch", () => {
  it("attaches at and above the match bar", () => {
    expect(classifyMatch(SIGNAL_MATCH_MIN_COSINE)).toBe("attach");
    expect(classifyMatch(0.99)).toBe("attach");
  });

  it("asks the judge inside the band", () => {
    expect(classifyMatch(SIGNAL_MERGE_JUDGE_MIN_COSINE)).toBe("judge");
    expect(classifyMatch(0.8)).toBe("judge");
    expect(classifyMatch(SIGNAL_MATCH_MIN_COSINE - 0.0001)).toBe("judge");
  });

  it("mints below the band", () => {
    expect(classifyMatch(SIGNAL_MERGE_JUDGE_MIN_COSINE - 0.0001)).toBe("mint");
    expect(classifyMatch(0)).toBe("mint");
  });

  /**
   * Null means the vectors could not be compared — a missing embedding must
   * not look like a confident decision, and the visible mistake is the mint.
   */
  it("mints when similarity is unknowable", () => {
    expect(classifyMatch(null)).toBe("mint");
  });

  it("keeps the band ordered, whatever the tuning", () => {
    expect(SIGNAL_MERGE_JUDGE_MIN_COSINE).toBeLessThan(SIGNAL_MATCH_MIN_COSINE);
  });
});

describe("computeSignalConfidence", () => {
  it("is zero with no evidence", () => {
    expect(computeSignalConfidence([], NOW)).toBe(0);
  });

  it("grows with support and spread", () => {
    const thin = computeSignalConfidence([evidence(0)], NOW);
    const spread = computeSignalConfidence(
      [evidence(30), evidence(20), evidence(10), evidence(0)],
      NOW,
    );
    expect(spread).toBeGreaterThan(thin);
  });

  it("fades as a signal goes quiet", () => {
    const fresh = computeSignalConfidence([evidence(10), evidence(0)], NOW);
    const stale = computeSignalConfidence([evidence(100), evidence(90)], NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  /**
   * The person's own saves and an agent's observations agreeing is evidence
   * neither could supply alone — corroboration adds.
   */
  it("credits corroboration across capture sources", () => {
    const solo = computeSignalConfidence([evidence(10), evidence(0)], NOW);
    const corroborated = computeSignalConfidence(
      [evidence(10, "app"), evidence(0, "agent")],
      NOW,
    );
    expect(corroborated - solo).toBe(CONFIDENCE_SOURCE_DIVERSITY_BONUS);
  });

  /** A weight would cap every solo human below 100 forever; a bonus must not. */
  it("lets a single-source profile still reach full confidence", () => {
    const saturated = computeSignalConfidence(
      Array.from({ length: 8 }, (_, i) => evidence(i * 5)),
      NOW,
    );
    expect(saturated).toBeGreaterThanOrEqual(97);
  });

  it("never exceeds 100 even with the bonus", () => {
    const maxed = computeSignalConfidence(
      Array.from({ length: 10 }, (_, i) => evidence(i * 4, i % 2 ? "agent" : "app")),
      NOW,
    );
    expect(maxed).toBeLessThanOrEqual(100);
  });

  /** "An answer weighs": the owner's standing "yes, this is me" adds — and
      only adds. Unanswered subtracts nothing, and the clamp still holds. */
  it("credits the owner's affirmation, exactly one bonus", () => {
    const rows = [evidence(10), evidence(0)];
    const unanswered = computeSignalConfidence(rows, NOW);
    const affirmed = computeSignalConfidence(rows, NOW, { affirmed: true });
    expect(affirmed - unanswered).toBe(CONFIDENCE_AFFIRMED_BONUS);

    const maxed = computeSignalConfidence(
      Array.from({ length: 10 }, (_, i) => evidence(i * 4, i % 2 ? "agent" : "app")),
      NOW,
      { affirmed: true },
    );
    expect(maxed).toBeLessThanOrEqual(100);
  });
});

describe("decay is real: the same evidence scores lower as it ages", () => {
  /**
   * The bug this pins against: confidence used to be served from a snapshot
   * written the moment evidence landed — recency term at its peak, frozen
   * there forever. Reads now recompute with the current clock, so this
   * property is what a user actually observes.
   */
  it("fades a signal that goes quiet, without any write", () => {
    const evidence = [40, 27, 12, 0].map((daysAgo) => ({
      createdAt: new Date(NOW.getTime() - daysAgo * DAY),
      source: "app" as const,
    }));

    const atWrite = computeSignalConfidence(evidence, NOW);
    const after45quiet = computeSignalConfidence(
      evidence,
      new Date(NOW.getTime() + 45 * DAY),
    );
    const after180quiet = computeSignalConfidence(
      evidence,
      new Date(NOW.getTime() + 180 * DAY),
    );

    expect(after45quiet).toBeLessThan(atWrite);
    expect(after180quiet).toBeLessThan(after45quiet);
    // Support and spread do not decay, so it floors instead of vanishing:
    // dormant patterns stay reachable rather than deleted by arithmetic.
    expect(after180quiet).toBeGreaterThan(0);
  });
});

describe("resolveRelatedEvidence — which citations code lets stand", () => {
  const OFFERED = [
    {
      id: "old-1",
      text: "Quit piano this spring; practice had started feeling like performance.",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    {
      id: "old-2",
      text: "A note about something else entirely.",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  it("keeps a citation whose quote is genuinely in the cited capture", () => {
    const kept = resolveRelatedEvidence(
      {
        relatedEvidence: [
          { inspirationId: "old-1", quote: "practice had started feeling like performance" },
        ],
      },
      OFFERED,
      500,
    );
    expect(kept).toEqual([
      { inspirationId: "old-1", quote: "practice had started feeling like performance" },
    ]);
  });

  /* The model cannot conjure evidence from a capture it was never shown —
     an id outside the offered set is dropped no matter how good the quote. */
  it("drops a citation of a capture that was not offered", () => {
    expect(
      resolveRelatedEvidence(
        { relatedEvidence: [{ inspirationId: "unoffered-9", quote: "anything at all here" }] },
        OFFERED,
        500,
      ),
    ).toEqual([]);
  });

  /* "These two share a theme" is not "this capture witnesses this pattern".
     The verbatim quote is the proof, and a paraphrase fails it — same rule,
     same verifier, as the primary quote. */
  it("drops a citation whose quote is a paraphrase of the cited capture", () => {
    expect(
      resolveRelatedEvidence(
        {
          relatedEvidence: [
            { inspirationId: "old-1", quote: "gave up piano because practicing felt performative" },
          ],
        },
        OFFERED,
        500,
      ),
    ).toEqual([]);
  });

  it("drops a citation whose quote lives in a DIFFERENT offered capture", () => {
    expect(
      resolveRelatedEvidence(
        {
          relatedEvidence: [
            { inspirationId: "old-2", quote: "practice had started feeling like performance" },
          ],
        },
        OFFERED,
        500,
      ),
    ).toEqual([]);
  });

  it("is empty-safe in both directions", () => {
    expect(resolveRelatedEvidence({ relatedEvidence: [] }, OFFERED, 500)).toEqual([]);
    expect(
      resolveRelatedEvidence(
        { relatedEvidence: [{ inspirationId: "old-1", quote: "feeling like performance" }] },
        [],
        500,
      ),
    ).toEqual([]);
  });
});

describe("parseSignalCandidates — a malformed payload is not an empty answer", () => {
  /* Zero statements marks a capture derived-with-nothing for good. A reply
     that does not have the shape asked for is the road failing, not the model
     finding nothing — it must fail the attempt so the queue retries. */
  it.each([
    ["statements is not a list", { statements: "none" }],
    ["a statement is not text", { statements: [{ statement: 42 }] }],
    ["the payload is not an object", "I could not find anything"],
  ])("throws when %s", (_why, payload) => {
    expect(() => parseSignalCandidates(payload)).toThrow("signal extraction");
  });

  it("parses a valid reply whose optional fields are null", () => {
    const result = parseSignalCandidates({
      statements: [{ statement: "I keep commitments small.", reason: null, quote: null, relatedEvidence: null }],
      category: null,
    });
    expect(result.statements).toEqual([
      { statement: "I keep commitments small.", reason: undefined, quote: undefined, relatedEvidence: undefined },
    ]);
    expect(parseSignalCandidates({ statements: null, category: null })).toEqual({ statements: [], category: null });
  });

  it("still returns a genuinely empty answer as no candidates", () => {
    expect(parseSignalCandidates({ statements: [], category: null })).toEqual({ statements: [], category: null });
  });
});

describe("parseSignalCandidates — related-citation shape discipline", () => {
  const earlier='a3689f1e-0000-4000-8000-000000000001';
  const input={profileId:'profile',preferredLocale:'en-US' as const,
    inspiration:{id:'00000000-0000-4000-8000-000000000002',text:'I keep commitments small enough to honor existing promises.',source:'app' as const,createdAt:new Date()},
    /* `existingCategories` is this branch's, and it is REQUIRED on the input
       type — the shelf labels already in use, so the prompt can reuse a name
       rather than inventing a synonym of it. dev's cases (#366) predate it;
       empty is the honest value here, since none of them are about the shelf. */
    reflections:[],attachments:[],existingStatements:[],existingCategories:[],relatedInspirations:[{id:earlier,text:'An earlier promise.',createdAt:new Date()}]};
  it.each([earlier,earlier.slice(0,8)])('refuses internal context IDs in visible pattern text: %s',id=>{
    expect(()=>parseSignalCandidates({statements:[{statement:`I keep commitments small. The earlier capture ${id} shows the same.`}]},input)).toThrow('signal extraction');
    expect(()=>parseSignalCandidates({statements:[{statement:'I keep commitments small.',reason:`Earlier capture ${id} supports this.`}]},input)).toThrow('signal extraction');
  });
  it('keeps metadata in citations and permits technical IDs genuinely present in authored material',()=>{
    const payload={statements:[{statement:'I keep commitments small enough to honor existing promises.',relatedEvidence:[{inspirationId:earlier,quote:'An earlier promise.'}]}]};
    expect(parseSignalCandidates(payload,input).statements[0]?.relatedEvidence?.[0].inspirationId).toBe(earlier);
    const text=`I review the code revision ${earlier.slice(0,8)} before deploying.`;
    expect(parseSignalCandidates({statements:[{statement:text}]},{...input,inspiration:{...input.inspiration,text}}).statements[0]?.statement).toBe(text);
  });
  it('refuses oversized generated prose before it can be truncated into an unfinished statement',()=>{
    expect(()=>parseSignalCandidates({statements:[{statement:'x'.repeat(501)}]},input)).toThrow('signal extraction');
  });
  it("collapses duplicate ids, drops blanks, and enforces the cap", () => {
    const parsed = parseSignalCandidates({
      statements: [
        {
          statement: "You keep abandoning practices once they feel like performances.",
          relatedEvidence: [
            { inspirationId: "a", quote: "first quote" },
            { inspirationId: "a", quote: "second quote for the same capture" },
            { inspirationId: " ", quote: "blank id" },
            { inspirationId: "b", quote: " " },
            { inspirationId: "c", quote: "third distinct capture" },
            { inspirationId: "d", quote: "fourth distinct capture" },
          ],
        },
      ],
    });
    const cited = parsed.statements[0]!.relatedEvidence!;
    expect(cited.map((row) => row.inspirationId)).toEqual(["a", "c"]);
    expect(cited).toHaveLength(MAX_RELATED_INSPIRATION_CITATIONS);
  });

  it("leaves relatedEvidence absent when nothing was cited", () => {
    const parsed = parseSignalCandidates({
      statements: [{ statement: "A pattern with no earlier witnesses." }],
    });
    expect(parsed.statements[0]!.relatedEvidence).toBeUndefined();
  });
});
