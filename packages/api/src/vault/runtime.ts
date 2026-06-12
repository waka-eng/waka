/**
 * Runtime VaultStore resolution.
 *
 * Production/Lambda writes vault documents to S3. Local scripts and tests can
 * opt into a filesystem vault by setting WAKA_VAULT_ROOT.
 */

import { FsVault } from "./fs-vault.js";
import { createS3Vault } from "./s3-vault.js";
import type { VaultStore } from "./vault.js";

let cachedVault: VaultStore | null = null;

export function getRuntimeVault(): VaultStore {
  if (cachedVault) return cachedVault;

  const root = process.env.WAKA_VAULT_ROOT;
  if (root) {
    cachedVault = new FsVault(root);
    return cachedVault;
  }

  if (process.env.VITEST) {
    cachedVault = new FsVault("/tmp/waka-vitest-vault");
    return cachedVault;
  }

  const bucket = process.env.WAKA_VAULT_BUCKET;
  if (!bucket) {
    throw new Error(
      "WAKA_VAULT_BUCKET is not set. Configure the vault bucket before writing file-first documents.",
    );
  }

  cachedVault = createS3Vault({
    bucket,
    prefix: process.env.WAKA_VAULT_PREFIX ?? "vault/",
    region:
      process.env.WAKA_VAULT_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION,
  });
  return cachedVault;
}

export function resetRuntimeVaultForTests(): void {
  cachedVault = null;
}
