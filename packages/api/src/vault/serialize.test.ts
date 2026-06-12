import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type {
  Attachment,
  ContextEdge,
  ContextEvidence,
  ContextNode,
  Reflection,
  Signal,
  SignalPacket,
  SignalSpark,
  TopOfMindNote,
  TopOfMindNoteSignal,
} from "../db/index.js";
import {
  CONTEXT_EDGE_SCHEMA,
  CONTEXT_NODE_SCHEMA,
  SIGNAL_SCHEMA,
  TOP_OF_MIND_NOTE_SCHEMA,
  buildContextEdgeDoc,
  buildContextNodeDoc,
  buildSignalDoc,
  buildTopOfMindNoteDoc,
  contextEdgeVaultPath,
  contextNodeSlug,
  contextNodeVaultPath,
  signalVaultPath,
  topOfMindNoteVaultPath,
  toYaml,
} from "./serialize.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SIGNAL_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const CONTEXT_NODE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTEXT_NODE_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTEXT_EDGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = new Date("2026-06-10T02:31:00.000Z");

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: SIGNAL_ID,
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

function makeSpark(overrides: Partial<SignalSpark> = {}): SignalSpark {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER_ID,
    inspirationId: SIGNAL_ID,
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

function makePacket(overrides: Partial<SignalPacket> = {}): SignalPacket {
  return {
    id: "12121212-1212-4212-8212-121212121212",
    userId: USER_ID,
    inspirationId: SIGNAL_ID,
    primarySparkId: null,
    sparkText: "building a protocol",
    artifactExcerpt: "protocol, not a platform",
    packetText: "A signal about preferring open systems over owned platforms.",
    sourceMetadata: { persistedAs: "signal_packets" },
    classifierSnapshot: { cluster: "bridge" },
    inputFingerprint: "fingerprint",
    tokenEstimate: 42,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    inspirationId: SIGNAL_ID,
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
    inspirationId: SIGNAL_ID,
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

function makeTopOfMindNote(overrides: Partial<TopOfMindNote> = {}): TopOfMindNote {
  return {
    id: NOTE_ID,
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
  overrides: Partial<TopOfMindNoteSignal> = {},
): TopOfMindNoteSignal {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    userId: USER_ID,
    wowMomentId: NOTE_ID,
    inspirationId: SIGNAL_ID,
    role: "trigger",
    reason: "",
    sortOrder: 0,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeContextNode(overrides: Partial<ContextNode> = {}): ContextNode {
  return {
    id: CONTEXT_NODE_ID,
    userId: USER_ID,
    type: "value",
    label: "Curiosity Driven Building",
    description: "Building things to find out, not just to ship.",
    status: "active",
    source: "meaning_graph_writer",
    weight: 90,
    confidence: 80,
    evidenceCount: 1,
    firstSeenAt: CREATED_AT,
    lastReinforcedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeContextEvidence(
  overrides: Partial<ContextEvidence> = {},
): ContextEvidence {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    userId: USER_ID,
    meaningNodeId: CONTEXT_NODE_ID,
    inspirationId: SIGNAL_ID,
    packetId: "12121212-1212-4212-8212-121212121212",
    reason: "The signal prefers protocol-shaped ownership.",
    weight: 90,
    confidence: 80,
    source: "meaning_graph_writer",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeContextEdge(overrides: Partial<ContextEdge> = {}): ContextEdge {
  return {
    id: CONTEXT_EDGE_ID,
    userId: USER_ID,
    sourceNodeId: CONTEXT_NODE_ID,
    targetNodeId: CONTEXT_NODE_B_ID,
    kind: "supports",
    weight: 50,
    confidence: 70,
    evidenceCount: 1,
    evidenceInspirationIds: [SIGNAL_ID],
    status: "active",
    source: "meaning_graph_writer",
    lastReinforcedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe("vault paths", () => {
  it("partitions by UTC month of created_at", () => {
    expect(signalVaultPath(USER_ID, SIGNAL_ID, CREATED_AT)).toBe(
      `${USER_ID}/signals/2026/06/${SIGNAL_ID}.yaml`,
    );
    expect(topOfMindNoteVaultPath(USER_ID, NOTE_ID, CREATED_AT)).toBe(
      `${USER_ID}/top-of-mind/2026/06/${NOTE_ID}.yaml`,
    );
  });

  it("uses the UTC month even when local time crosses a month boundary", () => {
    const edge = new Date("2026-05-31T23:59:59.000Z");
    expect(signalVaultPath(USER_ID, SIGNAL_ID, edge)).toContain(
      "/signals/2026/05/",
    );
  });

  it("uses stable context graph paths derived from readable slugs", () => {
    const node = makeContextNode();
    const targetNode = makeContextNode({
      id: CONTEXT_NODE_B_ID,
      type: "project",
      label: "WAKA Launch",
    });
    expect(contextNodeVaultPath(node)).toBe(
      `${USER_ID}/context/nodes/${contextNodeSlug(node)}.yaml`,
    );
    expect(
      contextEdgeVaultPath({
        edge: makeContextEdge(),
        sourceNode: node,
        targetNode,
      }),
    ).toBe(
      `${USER_ID}/context/edges/value--curiosity-driven-buildin--${CONTEXT_NODE_ID}--supports--project--waka-launch--${CONTEXT_NODE_B_ID}--${CONTEXT_EDGE_ID}.yaml`,
    );
  });
});

describe("buildSignalDoc", () => {
  it("captures meaning fields and round-trips through YAML", () => {
    const doc = buildSignalDoc({
      signal: makeSignal(),
      sparks: [makeSpark()],
      packet: makePacket(),
      reflections: [makeReflection()],
      attachments: [makeAttachment()],
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(SIGNAL_SCHEMA);
    expect(parsed.id).toBe(SIGNAL_ID);
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
    expect(parsed.signal_packet).toMatchObject({
      spark_text: "building a protocol",
      packet_text: "A signal about preferring open systems over owned platforms.",
      source_metadata: { persistedAs: "signal_packets" },
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
      buildSignalDoc({
        signal: makeSignal(),
        sparks: [],
        packet: makePacket(),
        reflections: [],
        attachments: [],
      }),
    );
    expect(yaml).not.toMatch(/score/i);
    expect(yaml).not.toMatch(/cluster/i);
    expect(yaml).not.toMatch(/classified/i);
    expect(yaml).not.toMatch(/fingerprint/i);
    expect(yaml).not.toMatch(/token_estimate/i);
  });

  it("prunes nulls and empty collections", () => {
    const doc = buildSignalDoc({
      signal: makeSignal({ kind: null, category: null }),
      sparks: [makeSpark({ note: null, worldviewClaims: [], isPrimary: false })],
      packet: null,
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
      signal: makeSignal(),
      sparks: [makeSpark()],
      packet: makePacket(),
      reflections: [makeReflection()],
      attachments: [makeAttachment()],
    };
    expect(toYaml(buildSignalDoc(input))).toBe(
      toYaml(buildSignalDoc(input)),
    );
  });
});

describe("buildTopOfMindNoteDoc", () => {
  it("orders related signals by sortOrder with the trigger first", () => {
    const related = makeLink({
      id: "88888888-8888-4888-8888-888888888888",
      inspirationId: "99999999-9999-4999-8999-999999999999",
      role: "related",
      reason: "unexpected bridge",
      sortOrder: 1,
    });
    const doc = buildTopOfMindNoteDoc({
      note: makeTopOfMindNote(),
      links: [related, makeLink()],
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(TOP_OF_MIND_NOTE_SCHEMA);
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
    const yaml = toYaml(buildTopOfMindNoteDoc({ note: makeTopOfMindNote(), links: [] }));
    expect(yaml).not.toMatch(/score/i);
  });
});

describe("buildContextNodeDoc", () => {
  it("captures durable graph claims without machine strength fields", () => {
    const doc = buildContextNodeDoc({
      node: makeContextNode(),
      evidence: [makeContextEvidence()],
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(CONTEXT_NODE_SCHEMA);
    expect(parsed.id).toBe(CONTEXT_NODE_ID);
    expect(parsed.type).toBe("value");
    expect(parsed.evidence[0]).toEqual({
      signal: SIGNAL_ID,
      reason: "The signal prefers protocol-shaped ownership.",
    });
    const yaml = toYaml(doc);
    expect(yaml).not.toMatch(/confidence/i);
    expect(yaml).not.toMatch(/weight/i);
    expect(yaml).not.toMatch(/evidence_count/i);
  });
});

describe("buildContextEdgeDoc", () => {
  it("captures graph relationships with signal evidence ids", () => {
    const sourceNode = makeContextNode();
    const targetNode = makeContextNode({
      id: CONTEXT_NODE_B_ID,
      type: "project",
      label: "WAKA Launch",
    });
    const doc = buildContextEdgeDoc({
      edge: makeContextEdge(),
      sourceNode,
      targetNode,
    });
    const parsed = parse(toYaml(doc));

    expect(parsed.schema).toBe(CONTEXT_EDGE_SCHEMA);
    expect(parsed.id).toBe(CONTEXT_EDGE_ID);
    expect(parsed.source).toEqual({
      id: CONTEXT_NODE_ID,
      node: `value--curiosity-driven-buildin--${CONTEXT_NODE_ID}`,
    });
    expect(parsed.target).toEqual({
      id: CONTEXT_NODE_B_ID,
      node: `project--waka-launch--${CONTEXT_NODE_B_ID}`,
    });
    expect(parsed.evidence_signals).toEqual([SIGNAL_ID]);
  });
});
