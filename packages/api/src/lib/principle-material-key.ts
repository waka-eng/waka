import {createHash} from 'node:crypto';
import type {loadPrincipleMaterial} from './principle-generation.js';

/** Stable evidence identity: opening a page cannot purchase another model pass. */
export function principleMaterialKey(material: Awaited<ReturnType<typeof loadPrincipleMaterial>>): string {
  return createHash("sha256").update(JSON.stringify({
    // The new distinct-wording/semantic checks deserve one scheduled pass;
    // an old completed empty result must not permanently suppress them.
    policy: material.groupId ? "principles-v3" : "principles-v4", groupId: material.groupId, locale: material.preferredLocale,
    signals: material.activeSignals.map((signal) => ({
      id: signal.id, statement: signal.statement,
      evidence: material.evidence.get(signal.id)?.evidenceAt.map((at) => at.toISOString()).sort(),
      supportKey: material.evidence.get(signal.id)?.supportKey,
      versions: material.evidence.get(signal.id)?.tomVersionIds.slice().sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
}
