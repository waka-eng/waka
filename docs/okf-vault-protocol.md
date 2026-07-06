# The WAKA Vault as an OKF bundle — the inspiration protocol

> **Status**: Format shipped (serializers, capture dual-write, exporter emit
> OKF markdown). Inbound sync (§7) is specified here but not yet implemented.

WAKA's vault is now a conformant [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF v0.1) bundle: a directory of markdown files with YAML frontmatter,
plus the two OKF reserved files (`index.md`, `log.md`). This single decision
is what turns the vault from *an export format* into *a protocol*:

- **Any filesystem is a transport.** Git, Google Drive, Syncthing, iCloud,
  an Obsidian vault — if it can hold a directory of `.md` files, it can hold
  a person's WAKA memory. No SDK, no API, no account.
- **Any tool is a client.** Obsidian renders the graph, `grep` searches it,
  Google Cloud's Knowledge Catalog ingests it, and any LLM agent can read a
  bundle and converse with it ("read my vault and trace how my thinking
  changed this year").
- **Any producer can inject inspiration.** Because OKF requires only a
  `type` field, a foreign file dropped into a synced vault is a valid
  utterance in the protocol. Syncing a directory *is* the write API (§7).

This document defines the mapping between WAKA's document shapes and OKF,
the memory model the bundle encodes, and the inbound half of the protocol.
It extends [`vault-architecture.md`](./vault-architecture.md), which remains
authoritative for the Vault/Index split, the write path, and the philosophy.

## 1. OKF conformance

| OKF v0.1 requirement | WAKA vault |
| --- | --- |
| Every non-reserved `.md` file has parseable YAML frontmatter | ✅ produced by `toOkfMarkdown` (`packages/api/src/vault/serialize.ts`) |
| Every frontmatter block has a non-empty `type` | ✅ `signal`, `top-of-mind-note`, `context-node`, `context-edge` |
| `index.md` follows §6 (no frontmatter, sections + entries) | ✅ generated at the bundle root by the exporter |
| `log.md` follows §7 (`# Directory Update Log`, `## YYYY-MM-DD`, newest first) | ✅ generated at the bundle root by the exporter |
| Consumers tolerate unknown types/keys, broken links, missing indexes | ✅ waka-specific keys (`schema`, `rev`, `sparks`, …) ride along as producer-defined frontmatter, which OKF §9 explicitly protects |

WAKA keeps its own versioned shape id in the `schema` frontmatter key
(`waka/signal@v2`, …). `type` answers "what is this?" for any OKF consumer;
`schema` answers "exactly which field layout?" for WAKA's own reindexer.

## 2. Bundle layout

```
vault/
  {userId}/                      ← one OKF bundle = one person's memory
    index.md                     ← OKF §6: progressive disclosure of the layers
    log.md                       ← OKF §7: the temporal stream (see §6 below)
    signals/YYYY/MM/{id}.md      ← episodic memory (journal)
    top-of-mind/YYYY/MM/{id}.md  ← sparks (judged connections)
    context/nodes/{slug}.md      ← long-term memory (lexicon)
    context/edges/{slug}.md      ← long-term memory (relations)
```

## 3. Concept documents

Every document splits the same way: **frontmatter = structure, body = the
human core**. The body is what a person (or an agent) would actually read;
the frontmatter is everything the reindexer needs to rebuild the DB index
from files alone.

### `type: signal` (`waka/signal@v2`) — a primal impression

```markdown
---
type: signal
schema: waka/signal@v2
id: 0c8c52cf-…
rev: 1
created_at: 2026-06-10T02:31:00.000Z
kind: note
sparks:
  - text: building a protocol
    what_moved_me: the shift from ownership to connection
    implied_values: [openness, sustainability]
signal_packet:
  spark_text: building a protocol
  packet_text: A signal about preferring open systems over owned platforms.
reflections:
  - question: Why did this matter right now?
    answer: Fatigue with lock-in lately.
---

We should be building a protocol, not a platform…
```

The captured text — the thing that almost slipped away — is the body.
Everything the user or the LLM layered on top of it (sparks, packet,
reflections, attachment references) is frontmatter.

### `type: top-of-mind-note` (`waka/top-of-mind-note@v2`) — a spark

Body = the `why` narrative (the judge's argument for why these thoughts
connect). Frontmatter keeps `title`, `kind`, `related[]` (evidence with
roles and reasons), and `judge` provenance. A note remains a contestable
document: open it, read the argument, disagree with it.

### `type: context-node` (`waka/context-node@v2`) — who I am becoming

Body = the node's description. The node's own taxonomy (`value`, `theme`,
`person`, `tension`, `open_question`, `hypothesis`, …) lives in `node_type`,
because `type` is reserved by OKF for the document type. Evidence (which
signals witnessed this claim, and why) stays embedded in frontmatter.

### `type: context-edge` (`waka/context-edge@v2`) — a relation

All structure (`kind`, `source`, `target`, `evidence_signals`), empty body.

## 4. Canonical serialization

The protocol's determinism rules (unchanged from the YAML era — they are
what make `contentHash` a drift detector):

1. Frontmatter is YAML with fixed key order, pruned of null/empty values,
   ISO-8601 UTC timestamps, no line wrapping (`lineWidth: 0`).
2. The document is `---\n{yaml}---\n`, then — if the body is non-empty —
   one blank line and the body with exactly one trailing newline.
3. `parseOkfMarkdown` reverses `toOkfMarkdown` exactly; re-serializing a
   parsed document is byte-identical. Machine-derived values (scores,
   embeddings, clusters) never appear in files.

### 4.1 The YAML twin

Every vault document also has a plain-YAML representation: the frontmatter
mapping with the markdown body appended under a trailing `body` key
(`toVaultYaml` / `fromVaultYaml`). The two forms are losslessly
interconvertible — they are views of the same `VaultDocument`, and both
round-trip through the same canonical markdown bytes.

Rules that keep this from becoming a second source of truth:

- **The `.md` file is canonical.** A `.yaml` twin is never written into the
  canonical tree; it exists at the edges — YAML-first tools reading an
  export, or `.yaml` files arriving through the inbox (§7).
- OKF conformance is unaffected: the spec constrains only `.md` files, so
  OKF consumers simply ignore any `.yaml` they encounter.

## 5. The memory model — weak signals, strong sparks

The bundle's three layers are deliberately brain-shaped:

- **Episodic memory** — `signals/` is an append-only journal of impressions,
  partitioned by when they happened. One signal alone carries little force;
  that is by design. Capture is cheap so that nothing is lost.
- **Consolidation into sparks** — the system's "unconscious" (embeddings,
  similarity, surprise ≈ 0.62, time distance — all DB-side, see
  [`wow-moment-algorithm.md`](./wow-moment-algorithm.md)) continuously holds
  new impressions against old ones. When individually weak signals combine
  into something that clears the judge, a **top-of-mind note is born as a
  document**: the spark, with its evidence and its reasoning. The file layer
  only ever sees the conclusion, never the arithmetic.
- **Long-term memory** — `context/` is the lexicon distilled from repeated
  sparks: durable claims about values, tastes, tensions, and directions,
  each carrying the evidence trail that justifies it.

## 6. The temporal layer — inner time-consciousness

Husserl's analysis of time-consciousness gives the bundle its third axis.
Every moment of consciousness is a *primal impression* fringed by
*retention* (the just-past still held) and *protention* (the about-to-come
already anticipated). The vault materializes all three:

- **Primal impression** — each `signals/YYYY/MM/{id}.md` is one now-point,
  fixed at its `created_at` and never rewritten into a feed.
- **Retention** — `log.md` is the retentional stream made readable: one
  file, newest day first, in which captures (**Capture**), sparks
  (**Spark**), the surfacing of durable claims (**Emergence**), and new
  relations (**Relation**) interleave. Reading it top to bottom is reading
  "how I changed over time". Evidence trails inside nodes and notes are
  retention at document granularity: every present claim holds onto the
  past signals that constitute it.
- **Protention** — `node_type: open_question` and `node_type: hypothesis`
  nodes, and the `reflection_question` on every top-of-mind note, are the
  bundle leaning forward: what this person is *about to* think.

No new machinery was needed for this — OKF's reserved `log.md` is already
a temporal document. The protocol simply commits to writing it.

## 7. Inbound sync — inspiration injection (design, next phase)

The outbound half (WAKA → files) is shipped. The inbound half makes the
sync bidirectional: **dropping a file into the synced directory injects an
inspiration.**

### The contract

A foreign document is ingestible when:

1. It is a `.md` or `.yaml` file under `{userId}/inbox/` (one reserved
   ingestion directory keeps foreign writes from racing WAKA's canonical
   writers). Markdown is parsed with `parseOkfMarkdown`, YAML with
   `fromVaultYaml` (§4.1) — both yield the same `VaultDocument`.
2. It has `type: signal` in its frontmatter (or top-level YAML mapping) —
   or no recognized type at all, in which case its whole body is treated
   as captured text (the permissive OKF stance: never reject what you can
   still read).
3. Its body is non-empty. `created_at` is honored when present and sane;
   otherwise ingestion time is used. A foreign `id` is preserved in
   `source_metadata` provenance, never trusted as a primary key.
4. **It passes the secret gate.** Foreign files are scanned for secrets
   (API keys, tokens, private keys, passwords) at the ingestion boundary
   — pattern adopted from zep-ia/brain's hippocampus gate. A vault is a
   *portable* bundle the user will sync and hand to agents; a leaked
   credential ingested once would replicate to every synced copy. Files
   that trip the detector are quarantined in place with a warning stub,
   never ingested.

### The flow

```
watcher/scanner (reconciler extension)
  → parseOkfMarkdown(inbox file)
  → POST-equivalent capture: signal row + canonical vault document at
    signals/YYYY/MM/{new-id}.md   (file first, index second, as always)
  → background classify/embed/judge pipeline — the foreign impression now
    competes and combines with native ones; a synced note from another
    tool can be the missing half of the next spark
  → inbox file replaced by a stub linking to the canonical document
```

Unknown `type` values are left untouched where they are (OKF consumers
MUST NOT reject unknown types); they simply are not ingested as signals.

### Why `inbox/` and not "watch everything"

The canonical tree is WAKA's write surface; the reconciler treats file/index
divergence there as drift to heal, not as user intent. A single ingestion
directory makes the protocol unambiguous: *canonical tree = WAKA speaking,
inbox = the world speaking.*

## 8. Migration notes (`.yaml` → `.md`, schema v1 → v2)

- Field changes: `text`/`why`/`description` moved from frontmatter to the
  body; context-node `type` renamed to `node_type`; every document gained
  the OKF `type` key. Hence the `schema` bump to `@v2`.
- `materializeSignalDocument` deletes the previously indexed path when the
  canonical path moves, so live-edited signals clean up their `.yaml`
  predecessors one by one.
- A full re-export (`pnpm vault:export`) rewrites every document at the new
  paths; stale `.yaml` files in existing vault prefixes can be removed by
  prefix filter (`*.yaml`) once a re-export has been verified.
- The `documents` index is a projection; `reindex` remains the single
  recovery path and now reads frontmatter + body via `parseOkfMarkdown`.
