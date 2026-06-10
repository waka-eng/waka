/**
 * FsVault — VaultStore backed by a local directory.
 *
 * Used by the export CLI and local development. Documents land as plain
 * files under the root directory, so the vault can be inspected, diffed,
 * and version-controlled with ordinary tools.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import {
  assertVaultPath,
  assertVaultPrefix,
  contentHash,
  type VaultPutResult,
  type VaultStore,
} from "./vault.js";

export class FsVault implements VaultStore {
  constructor(private readonly root: string) {}

  async put(path: string, content: string): Promise<VaultPutResult> {
    assertVaultPath(path);
    const target = join(this.root, path);
    await mkdir(dirname(target), { recursive: true });
    // Atomic per-object: write to a sibling temp file, then rename. A crash
    // mid-write leaves the previous version intact, matching S3 PUT
    // semantics where readers never observe a partial object.
    const temp = `${target}.tmp-${process.pid}`;
    await writeFile(temp, content, "utf8");
    await rename(temp, target);
    return { contentHash: contentHash(content) };
  }

  async get(path: string): Promise<string | null> {
    assertVaultPath(path);
    try {
      return await readFile(join(this.root, path), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async *list(prefix: string): AsyncIterable<string> {
    assertVaultPrefix(prefix);
    const paths: string[] = [];
    await this.walk(this.root, paths);
    paths.sort();
    for (const path of paths) {
      if (path.startsWith(prefix)) yield path;
    }
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, out);
      } else if (entry.isFile()) {
        out.push(relative(this.root, full).split(sep).join("/"));
      }
    }
  }
}
