import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type {
  ContextEdge,
  ContextEvidence,
  ContextNode,
  Signal,
  TopOfMindNote,
  TopOfMindNoteSignal,
} from "../db/index.js";
import { exportUserVault, type VaultExportSource } from "./exporter.js";
import {
  contentHash,
  type VaultPutResult,
  type VaultStore,
} from "./vault.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = new Date("2026-06-10T02:31:00.000Z");

const SIGNAL_A = "22222222-2222-4222-8222-222222222222";
const SIGNAL_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_A = "33333333-3333-4333-8333-333333333333";
const CONTEXT_NODE_A = "44444444-4444-4444-8444-444444444444";
const CONTEXT_NODE_B = "55555555-5555-4555-8555-555555555555";
const CONTEXT_EDGE_A = "66666666-6666-4666-8666-666666666666";

class MemoryVault implements VaultStore {
  readonly files = new Map<string, string>();

  async put(path: string, content: string): Promise<VaultPutResult> {
    this.files.set(path, content);
    return { contentHash: contentHash(content) };
  }

  async get(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async *list(prefix: string): AsyncIterable<string> {
    for (const path of [...this.files.keys()].sort()) {
      if (path.startsWith(prefix)) yield path;
    }
  }
}

function makeSignal(id: string, text: string): Signal {
  return {
    id,
    userId: USER_ID,
    text,
    kind: "note",
    category: null,
    importanceScore: 0,
    wowScore: 0,
    cluster: null,
    classifiedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeTopOfMindNote(id: string): TopOfMindNote {
  return {
    id,
    userId: USER_ID,
    title: "A bridge",
    kind: "bridge",
    idempotencyKey: `v1:${USER_ID}:${id}`,
    why: "Because.",
    beliefStatement: null,
    reflectionQuestion: null,
    reflectionGuide: null,
    locale: "en-US",
    wowScore: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeLink(momentId: string, inspirationId: string): TopOfMindNoteSignal {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    userId: USER_ID,
    wowMomentId: momentId,
    inspirationId,
    role: "trigger",
    reason: "",
    sortOrder: 0,
    createdAt: CREATED_AT,
  };
}

function makeContextNode(
  id: string,
  type: string,
  label: string,
): ContextNode {
  return {
    id,
    userId: USER_ID,
    type,
    label,
    description: `${label} description`,
    status: "active",
    source: "meaning_graph_writer",
    weight: 0,
    confidence: 0,
    evidenceCount: 1,
    firstSeenAt: CREATED_AT,
    lastReinforcedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeContextEvidence(): ContextEvidence {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    userId: USER_ID,
    meaningNodeId: CONTEXT_NODE_A,
    inspirationId: SIGNAL_A,
    packetId: "99999999-9999-4999-8999-999999999999",
    reason: "source-grounded reason",
    weight: 0,
    confidence: 0,
    source: "meaning_graph_writer",
    createdAt: CREATED_AT,
  };
}

function makeContextEdge(): ContextEdge {
  return {
    id: CONTEXT_EDGE_A,
    userId: USER_ID,
    sourceNodeId: CONTEXT_NODE_A,
    targetNodeId: CONTEXT_NODE_B,
    kind: "supports",
    weight: 0,
    confidence: 0,
    evidenceCount: 1,
    evidenceInspirationIds: [SIGNAL_A],
    status: "active",
    source: "meaning_graph_writer",
    lastReinforcedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeSource(): VaultExportSource {
  return {
    async listUserIds() {
      return [USER_ID];
    },
    async listSignals() {
      return [
        {
          signal: makeSignal(SIGNAL_A, "first"),
          sparks: [],
          packet: null,
          reflections: [],
          attachments: [],
        },
        {
          signal: makeSignal(SIGNAL_B, "second"),
          sparks: [],
          packet: null,
          reflections: [],
          attachments: [],
        },
      ];
    },
    async listTopOfMindNotes() {
      return [
        { note: makeTopOfMindNote(NOTE_A), links: [makeLink(NOTE_A, SIGNAL_A)] },
      ];
    },
    async listContextNodes() {
      return [
        {
          node: makeContextNode(
            CONTEXT_NODE_A,
            "value",
            "Curiosity Driven Building",
          ),
          evidence: [makeContextEvidence()],
        },
      ];
    },
    async listContextEdges() {
      return [
        {
          edge: makeContextEdge(),
          sourceNode: makeContextNode(
            CONTEXT_NODE_A,
            "value",
            "Curiosity Driven Building",
          ),
          targetNode: makeContextNode(CONTEXT_NODE_B, "project", "WAKA Launch"),
        },
      ];
    },
  };
}

describe("exportUserVault", () => {
  it("writes every document at its canonical path and reports hashes", async () => {
    const vault = new MemoryVault();
    const summary = await exportUserVault({
      source: makeSource(),
      vault,
      userId: USER_ID,
    });

    expect(summary.signals.map((d) => d.path)).toEqual([
      `${USER_ID}/signals/2026/06/${SIGNAL_A}.yaml`,
      `${USER_ID}/signals/2026/06/${SIGNAL_B}.yaml`,
    ]);
    expect(summary.topOfMindNotes.map((d) => d.path)).toEqual([
      `${USER_ID}/top-of-mind/2026/06/${NOTE_A}.yaml`,
    ]);
    expect(summary.contextNodes.map((d) => d.path)).toEqual([
      `${USER_ID}/context/nodes/value--curiosity-driven-building--${CONTEXT_NODE_A}.yaml`,
    ]);
    expect(summary.contextEdges.map((d) => d.path)).toEqual([
      `${USER_ID}/context/edges/value--curiosity-driven-buildin--${CONTEXT_NODE_A}--supports--project--waka-launch--${CONTEXT_NODE_B}--${CONTEXT_EDGE_A}.yaml`,
    ]);

    for (const doc of [
      ...summary.signals,
      ...summary.topOfMindNotes,
      ...summary.contextNodes,
      ...summary.contextEdges,
    ]) {
      const stored = vault.files.get(doc.path);
      expect(stored).toBeDefined();
      expect(contentHash(stored!)).toBe(doc.contentHash);
    }

    const note = parse(vault.files.get(summary.topOfMindNotes[0]!.path)!);
    expect(note.related[0].id).toBe(SIGNAL_A);

    const node = parse(vault.files.get(summary.contextNodes[0]!.path)!);
    expect(node.evidence[0].signal).toBe(SIGNAL_A);
  });

  it("is idempotent: re-export writes byte-identical documents", async () => {
    const source = makeSource();
    const first = new MemoryVault();
    const second = new MemoryVault();

    const a = await exportUserVault({ source, vault: first, userId: USER_ID });
    const b = await exportUserVault({ source, vault: second, userId: USER_ID });

    expect(a.signals.map((d) => d.contentHash)).toEqual(
      b.signals.map((d) => d.contentHash),
    );
    expect(a.topOfMindNotes.map((d) => d.contentHash)).toEqual(
      b.topOfMindNotes.map((d) => d.contentHash),
    );
    expect(a.contextNodes.map((d) => d.contentHash)).toEqual(
      b.contextNodes.map((d) => d.contentHash),
    );
    expect(a.contextEdges.map((d) => d.contentHash)).toEqual(
      b.contextEdges.map((d) => d.contentHash),
    );
  });
});
