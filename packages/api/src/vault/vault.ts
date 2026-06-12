/**
 * VaultStore — the storage seam between WAKA and its YAML vault.
 *
 * The vault is the canonical home for *meaning* documents (signals,
 * top-of-mind notes, context graph claims); the database keeps machine
 * signals and a rebuildable index.
 * See docs/vault-architecture.md for the full design.
 *
 * Implementations:
 *   - FsVault (./fs-vault.ts) — local directory; used by the exporter CLI
 *     and local development. Output is git-diffable.
 *   - S3Vault (./s3-vault.ts) — S3 prefix; the production vault, since
 *     Lambda has no durable filesystem.
 *
 * The interface is deliberately string-in/string-out: serialization to YAML
 * is a separate concern (./serialize.ts), so stores never need to know what
 * a document means.
 */

import { createHash } from "node:crypto";

export interface VaultPutResult {
  /** sha256 hex digest of the exact bytes written. */
  contentHash: string;
}

export interface VaultStore {
  /**
   * Write `content` at the vault-relative `path`, overwriting any previous
   * version. Must be atomic per-object (S3 PUT is; FsVault writes via a
   * temp file + rename).
   */
  put(path: string, content: string): Promise<VaultPutResult>;

  /** Read the document at `path`, or null when it does not exist. */
  get(path: string): Promise<string | null>;

  /** Delete the document at `path`. Missing documents are treated as success. */
  delete(path: string): Promise<void>;

  /** Yield every stored path under `prefix`, in lexicographic order. */
  list(prefix: string): AsyncIterable<string>;
}

/**
 * sha256 hex digest of a document body. The same function is used by every
 * store so a hash computed against one backend is comparable with another
 * (drift detection between file and index relies on this).
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Validate a vault-relative path. Rejects absolute paths and any `.`/`..`
 * segment so a hostile or buggy caller can never escape the vault root on
 * the filesystem backend (S3 keys are flat, but we keep the two backends
 * behaviorally identical).
 */
export function assertVaultPath(path: string): void {
  if (path.length === 0 || path.startsWith("/")) {
    throw new Error(`Invalid vault path: ${JSON.stringify(path)}`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid vault path segment in: ${JSON.stringify(path)}`);
    }
  }
}

/**
 * Validate a list() prefix. Same rules as assertVaultPath except a trailing
 * slash is allowed ("u1/" is the natural way to scope to one user) and the
 * empty prefix means "everything".
 */
export function assertVaultPrefix(prefix: string): void {
  if (prefix === "") return;
  assertVaultPath(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}
