/**
 * What the keyword ontology may and may not promote.
 *
 * These exist because of a bug that ran in production and could not be seen:
 * `buildSignalPacket` stamps `WHY_IT_MATTERS` into every packet, the matcher
 * lowercased the whole packet and asked `String.includes`, and the life/why
 * bucket looks for "why" and "matter". So one hardcoded `open_question` node —
 * "what kind of life would make this work worth it?" — attached to 100% of
 * saves, in every language, whatever the person wrote. Because `evidenceCount`
 * drives ranking and `MIN_EVIDENCE_PER_NOTE` is 3, the first reading almost
 * every user ever received was derived from it.
 *
 * The property that catches this class of bug is not "does the right save
 * promote the right node". It is: **a save with none of these words in it
 * promotes nothing.** A matcher that always fires cannot pass that.
 */

import { describe, expect, it } from "vitest";

import { buildMeaningSignals } from "./meaning-graph-writer.js";
import { buildSignalPacket, stripSignalPacketScaffold } from "./signal-packets.js";

const AT = new Date("2026-08-05T00:00:00.000Z");

/** A packet row shaped like the one the judge hands the writer. */
function rowFor(signalText: string, options: { sparkText?: string } = {}) {
  const built = buildSignalPacket({
    signal: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      text: signalText,
      kind: "note",
      category: null,
      cluster: null,
      classifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
    sparks: [],
    reflections: [],
  } as never) as { packetText: string; sparkText: string; artifactExcerpt: string };

  return {
    inspiration: {
      id: "11111111-1111-4111-8111-111111111111",
      cluster: null,
      importanceScore: 0,
      wowScore: 0,
    },
    packet: {
      id: "33333333-3333-4333-8333-333333333333",
      sparkText: options.sparkText ?? "",
      artifactExcerpt: built.artifactExcerpt,
      packetText: built.packetText,
    },
  } as never;
}

describe("signal packet scaffolding", () => {
  it("is present in every packet, which is why readers must strip it", () => {
    const packet = buildSignalPacket({
      signal: {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        text: "a bare note",
        kind: "note",
        category: null,
        cluster: null,
        classifiedAt: null,
        createdAt: AT,
        updatedAt: AT,
      },
      sparks: [],
      reflections: [],
    } as never) as { packetText: string };

    expect(packet.packetText).toContain("WHY_IT_MATTERS");
    // The exact collision: lowercased, the marker carries two live needles.
    expect("WHY_IT_MATTERS".toLowerCase()).toContain("why");
    expect("WHY_IT_MATTERS".toLowerCase()).toContain("matter");
  });

  it("strips the markers, the cluster line and the none placeholders", () => {
    const stripped = stripSignalPacketScaffold(
      [
        "waka.signal_packet.v1",
        "WHAT_HIT",
        "none",
        "WHY_IT_MATTERS",
        "cluster=convergence",
        "REFLECTIONS",
        "none",
        "CONTEXT_EXCERPT",
        "the sentence the person actually wrote",
      ].join("\n"),
    );

    expect(stripped).toBe("the sentence the person actually wrote");
  });

  it("keeps reflections and sparks, which are content and not scaffolding", () => {
    const stripped = stripSignalPacketScaffold(
      [
        "WHAT_HIT",
        "primary: the line that hit (user_selected, confidence=100)",
        "REFLECTIONS",
        "reflection_1: what drew you here?",
        "answer_1: it named something I had not",
        "CONTEXT_EXCERPT",
        "excerpt",
      ].join("\n"),
    );

    expect(stripped).toContain("the line that hit");
    expect(stripped).toContain("it named something I had not");
    expect(stripped).not.toContain("REFLECTIONS");
  });
});

describe("buildMeaningSignals", () => {
  it("promotes nothing from a save that contains none of the ontology's words", () => {
    // No spark, no scores, and deliberately none of the needles.
    expect(buildMeaningSignals(rowFor("the kettle boiled and I poured it out"))).toEqual([]);
  });

  // `normalizeLabel` lowercases and strips trailing punctuation, so the stored
  // label loses the question mark the ontology writes.
  const LIFE_QUESTION = "what kind of life would make this work worth it";
  const promotesLifeQuestion = (text: string) =>
    buildMeaningSignals(rowFor(text)).some((s) => s.label === LIFE_QUESTION);

  it("does not promote the existential question from the packet header alone", () => {
    expect(promotesLifeQuestion("the kettle boiled and I poured it out")).toBe(false);
  });

  it("still promotes it when the save genuinely asks why", () => {
    expect(promotesLifeQuestion("why does any of this matter if I never say it out loud")).toBe(
      true,
    );
  });

  it("promotes it for a save about a life, not only one containing the word why", () => {
    expect(promotesLifeQuestion("I want a life I would not trade on my last day")).toBe(true);
  });

  describe("word boundaries, not fragments", () => {
    // Each of these fired a bucket under String.includes.
    const falseFriends: Array<[string, string]> = [
      ["said", "ai"],
      ["email", "ai"],
      ["detailed", "ai"],
      ["capacity", "city"],
      ["simplicity", "city"],
      ["replace", "place"],
      ["breakfast", "fast"],
      ["lifestyle", "style"],
      ["bedroom", "room"],
    ];

    for (const [word, needle] of falseFriends) {
      it(`"${word}" no longer matches the "${needle}" needle`, () => {
        expect(buildMeaningSignals(rowFor(`I ${word} nothing else`))).toEqual([]);
      });
    }
  });

  describe("stems still reach their inflections", () => {
    it("accelerat* reaches accelerating", () => {
      const signals = buildMeaningSignals(rowFor("everything is accelerating past us"));
      expect(signals.some((s) => s.type === "tension")).toBe(true);
    });

    it("build* reaches builds and building", () => {
      expect(
        buildMeaningSignals(rowFor("she builds things nobody asked for")).length,
      ).toBeGreaterThan(0);
      expect(
        buildMeaningSignals(rowFor("building something worth the years")).length,
      ).toBeGreaterThan(0);
    });
  });

  it("still matches Hangul needles as substrings", () => {
    // `\b` never asserts beside a Hangul syllable, so these stay substring matches.
    const signals = buildMeaningSignals(rowFor("이걸 왜 만들어야 하는지 계속 생각한다"));
    expect(signals.length).toBeGreaterThan(0);
  });

  it("matches a standalone ai but not the letters inside another word", () => {
    expect(buildMeaningSignals(rowFor("ai keeps changing what is worth doing")).length)
      .toBeGreaterThan(0);
    expect(buildMeaningSignals(rowFor("he raised a chair by email"))).toEqual([]);
  });
});
