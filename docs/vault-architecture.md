# Vault & Index architecture

> **Status**: Phase 1 (Exporter + Vault interface) implemented. Phases 2–4 are design-only.

WAKA currently stores both the *meaning* a user captured (inspiration text, sparks,
reflections, WOW judgments) and the *machine signals* derived from it (scores,
embeddings, revisit events, jobs) in one Postgres database. This document defines
the target split:

> **Vault (YAML files) = source of truth for meaning. Index (DB) = a rebuildable
> projection on top of it.**

The analogy is Git: an object store holds the canonical content; the index exists
only to make queries fast and can always be rebuilt from the objects.

## AS-IS

All content and derived data live in Neon Postgres (Drizzle ORM):

**Content layer** (human/LLM-authored meaning)

| Table | Holds |
| --- | --- |
| `inspirations` | captured inspiration text |
| `inspiration_sparks` | excerpts + LLM interpretation (values, worldview, tensions) |
| `reflections` | the user's reflection Q&A |
| `meaning_packets` | per-inspiration meaning summaries |
| `wow_moments` + `wow_moment_inspirations` | judged WOW moments and their evidence links |
| `meaning_nodes` / `meaning_edges` / `meaning_evidence` | personal context graph |

**Signal/ops layer** (machine-generated, hot, mutable)

`inspiration_embeddings`, `importance_score` / `wow_score` columns,
`inspiration_revisit_events`, `background_jobs`, `users` / `sessions`,
`attachments` (binary payloads already in S3).

Pipeline: capture → `background_jobs` enqueue → Gemini classify/embed → bounded
candidate retrieval → WOW judge → idempotent persist. See
[`wow-moment-algorithm.md`](./wow-moment-algorithm.md).

**Structural tension**: the user's memory and the system's computation share one
store. Data is not portable, LLM judgments are not auditable/replayable as
documents, and no human or agent can read or refine an inspiration as a file.

## Principles

1. **Files hold meaning, the DB holds signals.** If a record is meaningful to the
   user and worth re-reading, it belongs in the Vault. If it is machine-made,
   machine-read, or changes by the second, it stays in the DB.
2. **The Vault is canonical.** The DB index must be reconstructible from the
   Vault with a single `reindex` operation. The Vault must be a complete,
   human-readable export without the DB.
3. **Machine-derived values never enter files.** No scores, no embeddings, no
   cluster labels inside YAML. WOW judgment *outputs* (kind, why, related
   evidence) are meaning and do go to files; the judge provenance (model,
   timestamp, idempotency key) rides along for auditability.
4. **Hot queries never touch files.** Candidate retrieval, ranking, and list
   views run entirely on the DB index — read performance is unchanged from AS-IS.

## What goes where

| Vault (YAML) | Index (DB) |
| --- | --- |
| inspiration text + sparks + reflections | `importance_score`, `wow_score` (worker-updated) |
| meaning packets | embeddings (binary, hot) |
| WOW moment judgments (kind, related, why, provenance) | revisit events (append-heavy log) |
| context-graph node/edge meaning | `background_jobs`, `users`, `sessions` |
| | `documents` index table (path, content_hash, rev, query projections) |

## Vault layout

```
vault/
  {userId}/
    inspirations/
      2026/06/
        {inspirationId}.yaml
    moments/
      2026/06/
        {wowMomentId}.yaml
    graph/                      # later phase
      nodes/{slug}.yaml
      edges.yaml
    manifest.yaml               # later phase: vault + schema versions, last reindex
```

IDs are the existing UUIDs; the `YYYY/MM` partition comes from the row's
`created_at` in UTC, so listing a month is a single prefix scan.

### Inspiration document (`waka/inspiration@v1`)

```yaml
schema: waka/inspiration@v1
id: 0c8c52cf-…
rev: 1
created_at: 2026-06-10T02:31:00.000Z

text: |
  We should be building a protocol, not a platform…

kind: note
category: 2

sparks:
  - text: "building a protocol"
    what_moved_me: the shift from ownership to connection
    implied_values: [openness, sustainability]

reflections:
  - question: Why did this matter right now?
    answer: Fatigue with lock-in lately.

attachments:
  - type: image
    url: https://…/diagram.png
    name: structure sketch
    s3_key: attachments/…/diagram.png
    content_type: image/png
    size: 48213

# Machine-derived values are deliberately absent: no scores, no cluster,
# no embeddings. Those live only in the DB index.
```

### WOW moment document (`waka/wow-moment@v1`)

```yaml
schema: waka/wow-moment@v1
id: 7d20c1b4-…
rev: 1
created_at: 2026-06-10T02:33:11.000Z

title: Protocol thinking bridges your standards memo
kind: surprise_bridge
why: |
  Why this is a WOW moment …
belief_statement: …
reflection_question: …
reflection_guide: …
locale: en-US

related:
  - id: 0c8c52cf-…          # trigger at sort 0, role "trigger"
    role: trigger
    reason: ""
  - id: 9a11e0d2-…
    role: related
    reason: unexpected bridge to the "power of standards" memo

judge:
  idempotency_key: v1:user:trigger:kind:…
```

## Index: the `documents` table (Phase 3)

One denormalized index row per Vault document:

```ts
documents = pgTable("documents", {
  id: uuid().primaryKey(),       // same id as the file
  userId: uuid().notNull(),
  docType: text().notNull(),     // 'inspiration' | 'wow_moment' | 'meaning_node'
  path: text().notNull(),        // vault-relative path
  contentHash: text().notNull(), // sha256 — drift detection + idempotency
  rev: integer().notNull(),
  // query/ranking projections only:
  searchText: text(),
  cluster: clusterEnum(),
  importanceScore: integer(),
  wowScore: integer(),
  createdAt: timestamptz(),
  indexedAt: timestamptz(),
});
```

Embedding / revisit / job tables keep their current shape and reference
`documents.id`.

## Write path & consistency

In production the Vault is an **S3 prefix** (Lambda has no durable filesystem);
local development uses a directory on disk (git-diffable). The storage is
abstracted behind one interface:

```ts
interface VaultStore {
  put(path: string, content: string): Promise<{ contentHash: string }>;
  get(path: string): Promise<string | null>;
  list(prefix: string): AsyncIterable<string>;
}
// S3Vault (prod) | FsVault (local dev / export target)
```

Writes are always **file first, index second**:

1. Serialize to YAML → `VaultStore.put()` (S3 PUT is atomic).
2. Upsert the `documents` row (optimistic lock on `rev`; the DB owns concurrency).
3. If step 2 fails the file is newer than the index — a background reconciler
   compares `contentHash` and self-heals. Because the file is canonical the
   repair direction is always one-way; no distributed transaction needed.

The same machinery gives us `waka reindex {userId}` for free: scan the Vault,
rebuild the index from scratch. Schema changes, score-formula overhauls, and
disaster recovery all converge on that one command.

## Migration phases

1. **Exporter (this phase, shipped)** — read-only backfill of existing DB
   content into Vault YAML. Zero risk to the live system; nothing in the
   serving path changes.
   - `packages/api/src/vault/` — `VaultStore` interface, `FsVault`, `S3Vault`,
     document serializers, exporter.
   - `tools/export-vault.ts` — CLI (`pnpm vault:export -- --user <id> --out ./vault`).
2. **Dual-write** — capture/edit paths also call `VaultStore.put()`; reads stay
   on the existing tables.
3. **Read flip** — detail views read from files (lists stay on the index, so
   nothing changes there). Add the `documents` table + reconciler + `reindex`.
4. **Retire content columns** — only after extended verification.

## Why this is worth it

- **Data sovereignty**: the vault directory *is* the export — every inspiration
  leaves as YAML.
- **Agent-native**: agents can read and refine vault documents directly.
- **Auditable judgments**: every WOW judgment is an immutable document with
  provenance, replayable at will.
- **The DB becomes a disposable cache** — the operational center of gravity
  drops a level.
