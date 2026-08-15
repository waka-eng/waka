# Old Schema To New Schema Cutover

This documents the persistence vocabulary cutover from the old inspiration /
meaning / wow-moment table names to the new signal / context / top-of-mind
schema.

## Table Mapping

```mermaid
flowchart LR
  subgraph Old["Old physical schema"]
    O1["inspirations"]
    O2["inspiration_sparks"]
    O3["meaning_packets"]
    O4["meaning_nodes"]
    O5["meaning_edges"]
    O6["meaning_evidence"]
    O7["wow_moments"]
    O8["wow_moment_inspirations"]
    O9["inspiration_embeddings"]
    O10["inspiration_revisit_events"]
  end

  subgraph New["New physical schema"]
    N1["signals"]
    N2["signal_sparks"]
    N3["signal_packets"]
    N4["context_nodes"]
    N5["context_edges"]
    N6["context_evidence"]
    N7["top_of_mind_notes"]
    N8["top_of_mind_note_signals"]
    N9["signal_embeddings"]
    N10["signal_revisit_events"]
  end

  O1 --> N1
  O2 --> N2
  O3 --> N3
  O4 --> N4
  O5 --> N5
  O6 --> N6
  O7 --> N7
  O8 --> N8
  O9 --> N9
  O10 --> N10
```

## New Relationship Shape

```mermaid
erDiagram
  users ||--o{ signals : owns
  signals ||--o{ signal_sparks : has
  signals ||--o| signal_packets : interpreted_as
  signals ||--o{ context_evidence : supports
  signals ||--o{ signal_embeddings : embedded_as
  signals ||--o{ signal_revisit_events : revisited_by

  users ||--o{ context_nodes : owns
  context_nodes ||--o{ context_evidence : backed_by
  context_nodes ||--o{ context_edges : source
  context_nodes ||--o{ context_edges : target

  users ||--o{ top_of_mind_notes : owns
  top_of_mind_notes ||--o{ top_of_mind_note_signals : composed_of
  signals ||--o{ top_of_mind_note_signals : included_in
```

## Column Mapping

| Old | New |
| --- | --- |
| `inspiration_id` | `signal_id` |
| `packet_id` | `signal_packet_id` |
| `meaning_node_id` | `context_node_id` |
| `source_node_id` | `source_context_node_id` |
| `target_node_id` | `target_context_node_id` |
| `evidence_inspiration_ids` | `evidence_signal_ids` |
| `wow_moment_id` | `top_of_mind_note_id` |

## Compatibility Layer

```mermaid
flowchart TB
  Client["Client"]
  API["/api/inspirations<br/>compat API path"]
  Alias["Drizzle aliases<br/>inspirations = signals<br/>meaningPackets = signalPackets<br/>wowMoments = topOfMindNotes"]
  DB["Physical DB tables<br/>signals / signal_packets / context_nodes / top_of_mind_notes"]

  Client --> API --> Alias --> DB
```

The client-facing `/api/inspirations` path remains for compatibility. The
physical database writes now go through the new `signals` table and related
signal/context/top-of-mind tables.

## DB To Vault Export

```mermaid
flowchart LR
  DB["Postgres physical tables<br/>signals / signal_packets / context_nodes / context_edges / context_evidence / top_of_mind_notes"]
  Source["VaultExportSource<br/>listSignals / listTopOfMindNotes / listContextNodes / listContextEdges"]
  Serializer["Vault serializers<br/>waka/signal@v1<br/>waka/top-of-mind-note@v1<br/>waka/context-node@v1<br/>waka/context-edge@v1"]
  Store["VaultStore<br/>FsVault or S3Vault"]

  DB --> Source --> Serializer --> Store
```

Current vault paths:

| Document | Path |
| --- | --- |
| Signal | `{userId}/signals/YYYY/MM/{signalId}.yaml` |
| Top-of-mind note | `{userId}/top-of-mind/YYYY/MM/{noteId}.yaml` |
| Context node | `{userId}/context/nodes/{type}--{slug}--{contextNodeId}.yaml` |
| Context edge | `{userId}/context/edges/{sourceSlug}--{kind}--{targetSlug}--{contextEdgeId}.yaml` |

This is still the export/backfill side of file SSOT. The full SSOT flip needs
the next phases: dual-write file first, add the `documents` index, add reindex,
then flip reads.
