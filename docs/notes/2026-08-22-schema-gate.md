# Schema gate, 2026-08-22 — is the signal → evidence-record link stored?

The one question Task 1 of
[`docs/craft/revamp-stars-and-roots.md`](../craft/revamp-stars-and-roots.md)
asks. **Verdict: A — the link is stored, richer than the brief's proposed
shape.** Task 2 (별) and Task 3 (뿌리) proceed in parallel; Task 3 is
surface work, not schema work.

## Evidence

| Brief's proposed field | What the repo already has | Where |
|---|---|---|
| `sources: SourceRef[]` | `signal_evidence` — a first-class M:N table, one row per (signal, inspiration) pair, unique per pair so re-derivation never double-counts | `packages/api/src/db/schema-signals.ts:113` |
| `SourceRef.record_id` | `signal_evidence.inspiration_id` | same |
| `SourceRef.excerpt` | `signal_evidence.quote` — nullable by design ("a missing quote is honest, an invented one is not") plus `reason`, the generated one-line why | same |
| `SourceRef.linked_at` | `signal_evidence.created_at` | same |
| `confidence: number` | Already exists, and is stronger than a stored number: computed live at every read from the evidence rows and the clock (`computeSignalConfidence`) | `packages/api/src/lib/signal-lifecycle.ts` |
| `locked: boolean`, `locked_at` | `signals.lockedAt` — written atomically with the statement in one UPDATE, so no unlocked race window exists | `packages/api/src/routes/signals.ts:342` |

The write path: `attachEvidence` in
`packages/api/src/lib/signal-match-or-mint.ts` records evidence whenever a
capture attaches to or mints a signal — the pipeline already "흘려보내기"s
the id, exactly as the brief hoped. The read path: `GET /api/signals/:id`
serves evidence with quotes today.

## One hazard the roots surface inherits, and its fix

Task 3's acceptance criterion "발췌·날짜가 원본 기록과 일치" is not
currently guaranteed by code: the model-claimed `quote` is stored without
verification, and `verifyQuote` (`packages/api/src/lib/salience.ts:51`) —
written precisely to keep a quote only if it is a literal substring of the
person's own text or the enrichment — has zero callers
(`docs/known-issues.md` H2). A roots panel that renders unverified
excerpts as the person's own words would put words in their mouth at the
exact moment the surface claims to show receipts. **Wiring `verifyQuote`
at the single evidence-write site is therefore part of Task 3's backend**,
not a separate nicety; the known-issues note also warns the 500-char clip
must move after verification.

## What this means for today

- No schema change, no migration, no backfill (per the brief's §7).
- Task 3's backend work shrinks to: wire `verifyQuote` on evidence write.
- The empty state the brief specifies still applies: old evidence rows
  whose quotes fail verification serve honest-null excerpts.
