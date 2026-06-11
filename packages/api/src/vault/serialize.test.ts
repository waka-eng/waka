import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type {
  Attachment,
  Inspiration,
  InspirationSpark,
  Reflection,
  WowMoment,
  WowMomentInspiration,
} from "../db/index.js";
import {
  INSPIRATION_SCHEMA,
  WOW_MOMENT_SCHEMA,
  buildInspirationDoc,
  buildWowMomentDoc,
  inspirationVaultPath,
  toYaml,
  wowMomentVaultPath,
} from "./serialize.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INSPIRATION_ID = "22222222-2222-4222-8222-222222222222";
const MOMENT_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = new Date("2026-06-10T02:31:00.000Z");

function makeInspiration(overrides: Partial<Inspiration> = {}): Inspiration {
  return {
    id: INSPIRATION_ID,
    userId: USER_ID,
    text: "We should be building a protocol, not a platform.",
    kind: "note",
    category: 2,
    importanceScore: 73,
    wowScore: 81,
    cluster: "bridge",
    classifiedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeSpark(overrides: Partial<InspirationSpark> = {}): InspirationSpark {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER_ID,
    inspirationId: INSPIRATION_ID,
    text: "building a protocol",
    source: "user_selected",
    startOffset: 19,
    endOffset: 38,
    confidence: 100,
    isPrimary: true,
    note: null,
    whatMovedUser: "the shift from ownership to connection",
    impliedValues: ["openness"],
    worldviewClaims: [],
    tensions: [],
    decisionRelevance: [],
    emotionalCharge: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    inspirationId: INSPIRATION_ID,
    userId: USER_ID,
    question: "Why did this matter right now?",
    answer: "Fatigue with lock-in lately.",
    skipped: false,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    inspirationId: INSPIRATION_ID,
    type: "image",
    url: "https://example.com/diagram.png",
    name: "structure sketch",
    s3Key: "attachments/abc/diagram.png",
    contentType: "image/png",
    size: 48213,
    createdAt: CREATED_AT,
    ...overrides,
  } as Attachment;
}

function makeMoment(overrides: Partial<WowMoment> = {}): WowMoment {
  return {
    id: MOMENT_ID,
    userId: USER_ID,
    title: "Protocol thinking bridges your standards memo",
    kind: "surprise_bridge",
    idempotencyKey: "v1:user:trigger:surprise_bridge:abc",
    why: "Why this is a WOW moment.",
    beliefStatement: null,
    reflectionQuestion: null,
    reflectionGuide: null,
    locale: "en-US",
    wowScore: 88,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeLink(
  overrides: Partial<WowMomentInspiration> = {},
): WowMomentInspiration {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    userId: USER_ID,
    wowMomentId: MOMENT_ID,
    inspirationId: INSPIRATION_ID,
    role: "trigger",
    reason: "",
    sortOrder: 0,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("vault paths", () => {
  it("partitions by UTC month of created_at", () => {
    expect(inspirationVaultPath(USER_ID, INSPIRATION_ID, CREATED_AT)).toBe(
      `${USER_ID}/inspirations/2026/06/${INSPIRATION_ID}.yaml`,
    );
    expect(wowMomentVaultPath(USER_ID, MOMENT_ID, CREATED_AT)).toBe(
      `${USER_ID}/moments/2026/06/${MOMENT_ID}.yaml`,
    );
  });

  it("uses the UTC month even when local time crosses a month boundary", () => {
    const edge = new Date("2026-05-31T23:59:59.000Z");
    expect(inspirationVaultPath(USER_ID, INSPIRATION_ID, edge)).toContain(
      "/inspirations/2026/05/",
    );
  });
});

describe("buildInspirationDoc", () => {
  it("captures meaning fields and round-trips through YAML", () => {
    const doc = buildInspirationDoc({
      inspiration: makeInspiration(),
      sparks: [makeSpark()],
      reflections: [makeReflection()],
      attachments: [makeAttachment()],
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(INSPIRATION_SCHEMA);
    expect(parsed.id).toBe(INSPIRATION_ID);
    expect(parsed.rev).toBe(1);
    expect(parsed.created_at).toBe("2026-06-10T02:31:00.000Z");
    expect(parsed.text).toBe("We should be building a protocol, not a platform.");
    expect(parsed.sparks).toHaveLength(1);
    expect(parsed.sparks[0]).toMatchObject({
      text: "building a protocol",
      is_primary: true,
      what_moved_me: "the shift from ownership to connection",
      implied_values: ["openness"],
    });
    expect(parsed.reflections[0]).toEqual({
      question: "Why did this matter right now?",
      answer: "Fatigue with lock-in lately.",
    });
    expect(parsed.attachments[0]).toMatchObject({
      type: "image",
      s3_key: "attachments/abc/diagram.png",
      size: 48213,
    });
  });

  it("never includes machine-derived signals", () => {
    const yaml = toYaml(
      buildInspirationDoc({
        inspiration: makeInspiration(),
        sparks: [],
        reflections: [],
        attachments: [],
      }),
    );
    expect(yaml).not.toMatch(/score/i);
    expect(yaml).not.toMatch(/cluster/i);
    expect(yaml).not.toMatch(/classified/i);
  });

  it("prunes nulls and empty collections", () => {
    const doc = buildInspirationDoc({
      inspiration: makeInspiration({ kind: null, category: null }),
      sparks: [makeSpark({ note: null, worldviewClaims: [], isPrimary: false })],
      reflections: [makeReflection({ answer: null, skipped: true })],
      attachments: [],
    });
    expect(doc).not.toHaveProperty("kind");
    expect(doc).not.toHaveProperty("category");
    expect(doc).not.toHaveProperty("attachments");
    const spark = (doc.sparks as Record<string, unknown>[])[0];
    expect(spark).not.toHaveProperty("note");
    expect(spark).not.toHaveProperty("worldview_claims");
    expect(spark).not.toHaveProperty("is_primary");
    const reflection = (doc.reflections as Record<string, unknown>[])[0];
    expect(reflection).toEqual({
      question: "Why did this matter right now?",
      skipped: true,
    });
  });

  it("is deterministic for identical input", () => {
    const input = {
      inspiration: makeInspiration(),
      sparks: [makeSpark()],
      reflections: [makeReflection()],
      attachments: [makeAttachment()],
    };
    expect(toYaml(buildInspirationDoc(input))).toBe(
      toYaml(buildInspirationDoc(input)),
    );
  });
});

describe("buildWowMomentDoc", () => {
  it("orders related inspirations by sortOrder with the trigger first", () => {
    const related = makeLink({
      id: "88888888-8888-4888-8888-888888888888",
      inspirationId: "99999999-9999-4999-8999-999999999999",
      role: "related",
      reason: "unexpected bridge",
      sortOrder: 1,
    });
    const doc = buildWowMomentDoc({
      moment: makeMoment(),
      links: [related, makeLink()],
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(WOW_MOMENT_SCHEMA);
    expect(parsed.kind).toBe("surprise_bridge");
    expect(parsed.related.map((r: { role: string }) => r.role)).toEqual([
      "trigger",
      "related",
    ]);
    expect(parsed.related[1].reason).toBe("unexpected bridge");
    expect(parsed.judge.idempotency_key).toBe(
      "v1:user:trigger:surprise_bridge:abc",
    );
  });

  it("excludes the persisted wow score", () => {
    const yaml = toYaml(buildWowMomentDoc({ moment: makeMoment(), links: [] }));
    expect(yaml).not.toMatch(/score/i);
  });
});
