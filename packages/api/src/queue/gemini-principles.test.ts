/**
 * The layer-4 model calls: request shapes and the reading of answers. Every
 * failure direction is asymmetric — a malformed distillation mints nothing, a
 * malformed/incomplete relation batches are rejected, and a malformed route keeps the words as
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
  buildPrincipleGroundingRequest,parsePrincipleGrounding,PRINCIPLE_GROUNDING_SYSTEM_INSTRUCTION,
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

describe('bounded semantic grounding',()=>{
  const input={preferredLocale:'en-US' as const,signals:[{id:'s',statement:'A saved preference.'}],candidates:[{id:'c1',statement:'A rule.',citedSignalIds:['s']},{id:'c2',statement:'Another rule.',citedSignalIds:['s']}]};
  it('fences data, bounds output, and forbids fluent unsupported trade-offs',()=>{
    const request=buildPrincipleGroundingRequest(input);
    expect(request.generationConfig.maxOutputTokens).toBe(512);
    expect(request.contents[0]!.parts[0]!.text).toContain('<<<grounding data>>>');
    expect(PRINCIPLE_GROUNDING_SYSTEM_INSTRUCTION).toContain('cost');
    expect(PRINCIPLE_GROUNDING_SYSTEM_INSTRUCTION).toContain('If uncertain');
  });
  it('requires each candidate once and restores order',()=>{
    expect(parsePrincipleGrounding({assessments:[{candidateId:'c2',supported:false},{candidateId:'c1',supported:true}]},input).assessments)
      .toEqual([{candidateId:'c1',supported:true},{candidateId:'c2',supported:false}]);
  });
  it.each([null,{}, {assessments:[]},{assessments:[{candidateId:'c1',supported:true}]},
    {assessments:[{candidateId:'c1',supported:true},{candidateId:'c1',supported:false}]},
    {assessments:[{candidateId:'c1',supported:true},{candidateId:'foreign',supported:true}]},
    {assessments:[{candidateId:'c1',supported:'yes'},{candidateId:'c2',supported:false}]},
  ])('rejects incomplete/malformed verdict %j',payload=>expect(()=>parsePrincipleGrounding(payload,input)).toThrow());
});

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
  it('does not turn capture age into a calendar gate for repeated choices',()=>{
    const request=buildPrincipleDistillRequest(DISTILL_INPUT);
    expect(request.contents[0]!.parts[0]!.text).toContain('Current supported signals');
    expect(request.contents[0]!.parts[0]!.text).toContain('Capture dates are not experience dates');
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toContain('An evidence span of zero is not a reason to reject');
    expect(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).toContain('one originating event');
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
  const input={preferredLocale:'en-US' as const,candidateStatement:'A',existingPrinciples:[{id:'p1',statement:'B'},{id:'p2',statement:'C'}]};
  it("asks a three-way comparison at temperature zero", () => {
    const request = buildPrincipleRelationRequest(input);
    expect(request.generationConfig.temperature).toBe(0);
    expect(request.generationConfig.responseSchema.properties?.relations?.items?.properties?.relation?.enum).toEqual([
      "same",
      "independent",
      "conflicting",
    ]);
  });

  it("tells the judge uncertainty means independent", () => {
    expect(PRINCIPLE_RELATION_JUDGE_SYSTEM_INSTRUCTION).toMatch(/uncertain, answer "independent"/);
  });

  it('requires one verdict per supplied ID and restores input order',()=>{
    expect(parsePrincipleRelation({relations:[{principleId:'p2',relation:'conflicting'},{principleId:'p1',relation:'same'}]},input).relations)
      .toEqual([{principleId:'p1',relation:'same'},{principleId:'p2',relation:'conflicting'}]);
  });
  it.each([null,{}, {relations:[]},{relations:[{principleId:'p1',relation:'same'}]},
    {relations:[{principleId:'p1',relation:'same'},{principleId:'p1',relation:'independent'}]},
    {relations:[{principleId:'p1',relation:'same'},{principleId:'foreign',relation:'independent'}]},
    {relations:[{principleId:'p1',relation:'SAME'},{principleId:'p2',relation:'independent'}]},
  ])('refuses incomplete or malformed comparisons %#',payload=>{
    expect(()=>parsePrincipleRelation(payload,input)).toThrow();
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
