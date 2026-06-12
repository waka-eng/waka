import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsVault } from "./fs-vault.js";
import { contentHash } from "./vault.js";

let root: string;
let vault: FsVault;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "waka-vault-"));
  vault = new FsVault(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FsVault", () => {
  it("round-trips a document and reports its content hash", async () => {
    const content = "schema: waka/signal@v1\ntext: hello\n";
    const { contentHash: hash } = await vault.put("u1/signals/2026/06/a.yaml", content);

    expect(hash).toBe(contentHash(content));
    expect(await vault.get("u1/signals/2026/06/a.yaml")).toBe(content);
  });

  it("returns null for a missing document", async () => {
    expect(await vault.get("u1/signals/2026/06/missing.yaml")).toBeNull();
  });

  it("overwrites an existing document atomically", async () => {
    await vault.put("u1/a.yaml", "v: 1\n");
    await vault.put("u1/a.yaml", "v: 2\n");
    expect(await vault.get("u1/a.yaml")).toBe("v: 2\n");
  });

  it("lists documents under a prefix in sorted order", async () => {
    await vault.put("u1/top-of-mind/2026/06/b.yaml", "b\n");
    await vault.put("u1/signals/2026/06/a.yaml", "a\n");
    await vault.put("u2/signals/2026/06/c.yaml", "c\n");

    const all: string[] = [];
    for await (const path of vault.list("u1/")) all.push(path);
    expect(all).toEqual([
      "u1/signals/2026/06/a.yaml",
      "u1/top-of-mind/2026/06/b.yaml",
    ]);
  });

  it("rejects path traversal", async () => {
    await expect(vault.put("../escape.yaml", "x")).rejects.toThrow(/Invalid vault path/);
    await expect(vault.get("/etc/passwd")).rejects.toThrow(/Invalid vault path/);
  });
});
