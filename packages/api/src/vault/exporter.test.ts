import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { Inspiration, WowMoment, WowMomentInspiration } from "../db/index.js";
import { exportUserVault, type VaultExportSource } from "./exporter.js";
import {
  contentHash,
  type VaultPutResult,
  type VaultStore,
} from "./vault.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = new Date("2026-06-10T02:31:00.000Z");

class MemoryVault implements VaultStore {
  readonly files = new Map<string, string>();

  async put(path: string, content: string): Promise<VaultPutResult> {
    this.files.set(path, content);
    return { contentHash: contentHash(content) };
  }

  async get(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async *list(prefix: string): AsyncIterable<string> {
    for (const path of [...this.files.keys()].sort()) {
      if (path.startsWith(prefix)) yield path;
    }
  }
}

function makeInspiration(id: string, text: string): Inspiration {
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

function makeMoment(id: string): WowMoment {
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

function makeLink(momentId: string, inspirationId: string): WowMomentInspiration {
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

const INSPIRATION_A = "22222222-2222-4222-8222-222222222222";
const INSPIRATION_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MOMENT_A = "33333333-3333-4333-8333-333333333333";

function makeSource(): VaultExportSource {
  return {
    async listUserIds() {
      return [USER_ID];
    },
    async listInspirations() {
      return [
        {
          inspiration: makeInspiration(INSPIRATION_A, "first"),
          sparks: [],
          reflections: [],
          attachments: [],
        },
        {
          inspiration: makeInspiration(INSPIRATION_B, "second"),
          sparks: [],
          reflections: [],
          attachments: [],
        },
      ];
    },
    async listWowMoments() {
      return [
        { moment: makeMoment(MOMENT_A), links: [makeLink(MOMENT_A, INSPIRATION_A)] },
      ];
    },
  };
}

describe("exportUserVault", () => {
  it("writes every document at its canonical path and reports hashes", async () => {
    const vault = new MemoryVault();
    const summary = await exportUserVault({ source: makeSource(), vault, userId: USER_ID });

    expect(summary.inspirations.map((d) => d.path)).toEqual([
      `${USER_ID}/inspirations/2026/06/${INSPIRATION_A}.yaml`,
      `${USER_ID}/inspirations/2026/06/${INSPIRATION_B}.yaml`,
    ]);
    expect(summary.wowMoments.map((d) => d.path)).toEqual([
      `${USER_ID}/moments/2026/06/${MOMENT_A}.yaml`,
    ]);

    for (const doc of [...summary.inspirations, ...summary.wowMoments]) {
      const stored = vault.files.get(doc.path);
      expect(stored).toBeDefined();
      expect(contentHash(stored!)).toBe(doc.contentHash);
    }

    const moment = parse(vault.files.get(summary.wowMoments[0].path)!);
    expect(moment.related[0].id).toBe(INSPIRATION_A);
  });

  it("is idempotent: re-export writes byte-identical documents", async () => {
    const source = makeSource();
    const first = new MemoryVault();
    const second = new MemoryVault();

    const a = await exportUserVault({ source, vault: first, userId: USER_ID });
    const b = await exportUserVault({ source, vault: second, userId: USER_ID });

    expect(a.inspirations.map((d) => d.contentHash)).toEqual(
      b.inspirations.map((d) => d.contentHash),
    );
    expect(a.wowMoments.map((d) => d.contentHash)).toEqual(
      b.wowMoments.map((d) => d.contentHash),
    );
  });
});
