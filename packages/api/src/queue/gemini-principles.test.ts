/**
 * The layer-4 model calls: request shapes and the reading of answers. Every
 * failure direction is asymmetric — a malformed distillation mints nothing, a
 * malformed relation lands on independent (the visible duplicate over the
 * silent merge or phantom conflict), and a malformed route keeps the words as
 * a capture rather than wrongly enshrining them.
 */

import { describe, expect, it } from "vitest";

import {
  buildDeclarationRouteRequest,
  buildPrincipleDistillRequest,
  buildPrincipleRelationRequest,
  DECLARATION_ROUTE_SYSTEM_INSTRUCTION,
  parseDeclarationRoute,
  parseDistilledPrinciples,
  parsePrincipleRelation,
  PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION,
  PRINCIPLE_RELATION_JUDGE_SYSTEM_INSTRUCTION,
} from "./gemini.js";

const DISTILL_INPUT = {
  profileId: "profile-1",
  preferredLocale: "en-US" as const,
  signals: [
    {
      id: "s1",
      statement: "You keep choosing small sharp tools.",
      evidenceCount: 4,
      firstEvidenceAt: new Date("2026-06-01T00:00:00Z"),
      lastEvidenceAt: new Date("2026-08-01T00:00:00Z"),
      tomAppearances: 6,
    },
  ],
  currentPrinciples: [{ id: "p1", statement: "Working before spending.", state: "held" }],
  currentEntries: [{ body: "Small tools are on your mind." }],
};

describe("distillation request", () => {
  it("runs at temperature zero with the candidates schema", () => {
    const request = buildPrincipleDistillRequest(DISTILL_INPUT);
    expect(request.generationConfig.temperature).toBe(0);
    expect(request.generationConfig.responseSchema).toMatchObject({
      type: "OBJECT",
      required: ["candidates"],
    });
  });

  it("fences signals, standing principles, and current entries as data", () => {
    const prompt = buildPrincipleDistillRequest(DISTILL_INPUT).contents[0]!.parts[0]!.text!;
    expect(prompt).toContain("<<<signal>>>");
    expect(prompt).toContain("<<<principle>>>");
    expect(prompt).toContain("<<<entry>>>");
    expect(prompt).toContain("You keep choosing small sharp tools.");
  });

  it("tells the model the five tests and that zero is a right answer", () => {
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toMatch(/Context-free/);
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toMatch(/Never completes/i);
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toMatch(/Zero candidates is a correct answer/);
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toMatch(/never echo/i);
  });
});

describe("reading distillation", () => {
  it("accepts a clean candidate and defaults an unknown type to maxim", () => {
    const parsed = parseDistilledPrinciples({
      candidates: [
        { statement: " Prefer X over Y. ", type: "banana", citedSignalIds: ["s1", 2, "s2"] },
      ],
    });
    expect(parsed.candidates).toEqual([
      { statement: "Prefer X over Y.", type: "maxim", citedSignalIds: ["s1", "s2"] },
    ]);
  });

  it.each([null, "nope", {}, { candidates: "x" }, { candidates: [{}] }])(
    "reads %j as no candidates",
    (payload) => {
      expect(parseDistilledPrinciples(payload).candidates).toEqual([]);
    },
  );
});

describe("the relation judge", () => {
  it("asks a three-way comparison at temperature zero", () => {
    const request = buildPrincipleRelationRequest({
      preferredLocale: "en-US",
      candidateStatement: "A",
      existingStatement: "B",
    });
    expect(request.generationConfig.temperature).toBe(0);
    expect(request.generationConfig.responseSchema.properties?.relation?.enum).toEqual([
      "same",
      "independent",
      "conflicting",
    ]);
  });

  it("tells the judge uncertainty means independent", () => {
    expect(PRINCIPLE_RELATION_JUDGE_SYSTEM_INSTRUCTION).toMatch(/uncertain, answer "independent"/);
  });

  it.each([
    [{ relation: "same" }, "same"],
    [{ relation: "conflicting" }, "conflicting"],
    [{ relation: "INDEPENDENT" }, "independent"],
    [{ relation: 3 }, "independent"],
    [{}, "independent"],
    [null, "independent"],
  ])("reads %j as %s", (payload, expected) => {
    expect(parsePrincipleRelation(payload).relation).toBe(expected);
  });
});

describe("declaration routing", () => {
  it("applies context, directive, and completion — never evidence or time", () => {
    expect(DECLARATION_ROUTE_SYSTEM_INSTRUCTION).toMatch(/Context-free/);
    expect(DECLARATION_ROUTE_SYSTEM_INSTRUCTION).toMatch(/Never completes/i);
    expect(DECLARATION_ROUTE_SYSTEM_INSTRUCTION).not.toMatch(/45|three signals/i);
  });

  it("fences the declaration", () => {
    const prompt = buildDeclarationRouteRequest({
      preferredLocale: "en-US",
      statement: "Ship it by June",
    }).contents[0]!.parts[0]!.text!;
    expect(prompt).toContain("<<<declaration>>>");
    expect(prompt).toContain("Ship it by June");
  });

  /** A routing failure keeps the words as a capture, never enshrines them. */
  it.each([
    [{ route: "principle", type: "value" }, "principle", "value"],
    [{ route: "inspiration", type: "stance" }, "inspiration", "stance"],
    [{ route: "PRINCIPLE" }, "inspiration", "maxim"],
    [{}, "inspiration", "maxim"],
    [null, "inspiration", "maxim"],
  ])("reads %j as %s/%s", (payload, route, type) => {
    expect(parseDeclarationRoute(payload)).toEqual({ route, type });
  });
});
