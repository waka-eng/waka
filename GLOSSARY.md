# WAKA GLOSSARY — one skeleton, three dialects

Every name in WAKA follows this document. A new concept gets its row here
before it gets a name anywhere else.

> **Language ruling (founder, 2026-08-22): the product speaks English only.**
> The original glossary carried the UI dialect in Korean (world-language +
> plain line, from `docs/craft/revamp-stars-and-roots.md`); that brief remains
> the source of the *world* — stars, roots, seasons, doors — but every line
> the product prints is English now. The Korean original of this table lives
> in the git history of this file.

## Principles

1. **One universe of metaphor.** WAKA's universe is the field and the sky.
   Stars, roots, seasons, campfire, doors, dusk — everything comes from
   there. Never mix in another world's metaphors (vaults, ink, receipts).
2. **Names only for what the user touches.** Internal behavior (e.g.
   latest-fact-wins) stays nameless — "quiet correctness." Too many coined
   words make a riddle, not a poem.
3. **Dialect boundary.** Data & API = boring infrastructure English / UI =
   WAKA world-language (English) + a plain line / sales & docs =
   infrastructure English. The three are different names for the same
   mechanism.
4. **The mom test.** Every metaphor must be explainable in one hover/tap
   line. The "plain line" column below is that line.

## Translation table

| Concept (mechanism) | Data & API (English, boring) | UI (world-language) | UI plain line | Docs & sales (en) | Status |
|---|---|---|---|---|---|
| User-locked sentence | `locked: boolean`, `locked_at` | **star** | your own words — WAKA will not rewrite them | User-locked immutable statement (immutable override) | **today** |
| Evidence links | `sources: SourceRef[]` — `record_id`, `excerpt`, `linked_at` | **roots** | the memories this signal grew from | Provenance (evidence links) | **today** |
| Version keeping | `versions[]` (soft-invalidate, never delete) | **seasons** | who you were last season — kept, never erased | Version history (invalidate-don't-delete) | reserved |
| Shared space | `space`, `membership` | **campfire** | a memory you tend together | Governed shared spaces | reserved |
| Access control | `permissions` | **door** | you decide whose door opens | Access control | reserved |
| Decay / retirement | `dormant_at` | **setting** | a signal long unused sets like dusk | Decay / retirement policy | reserved |
| Suppression (owner-refused pattern) | `dismissed_at`, `suppressions` — `anchor_signal_id`, `candidate_statement` | **refused ground** | the ground will refuse anything this close from now on | Suppression record (logged, reversible, deletes nothing) | **today** |
| Ratified standing (per cited ground) | `citedSignals[].answered` (computed from feedback + locks, never stored) | **agreed light** | what you have answered holds full ink; what only WAKA thinks sits dim | Ratified provenance standing | **today** |
| Activity narration (view of records) | `GET /api/weather` — told sentences derived from stored rows only | **the weather** | what the loop did, told as days — never a number, never a ping | Derived activity narration (no stored summaries) | **today** |
| Suppression log surface | `weather.antechamber[]` — refused candidates + anchors | **the antechamber** | the dim place where what was read but not kept still stands | Suppression log view (delta surface) | **today** |
| Decision attribution | `decision_trace` | **roots of a choice** | which memories this choice came from | Attribution / decision audit | reserved |

## Personal capture vocabulary approved 2026 10 02

The personal experience contract adds the following plain-language concepts.
These are approved names; rows marked planned do not claim shipped storage or UI.

| Concept | Data or API name | UI | Plain line | Status |
| --- | --- | --- | --- | --- |
| Recorded audio attachment | `audio` | Recording | what you recorded | in implementation |
| Machine transcript of recorded audio | `audio_transcription` | Transcript | what was heard in this recording | implemented; deployment pending |
| A person's correction of the transcript | `transcript_correction` | Edit transcript | correct what was heard without replacing the recording | implemented; deployment pending |
| One private review of selected inspirations | `review_session` | Review | revisit a few things you kept | selection implemented; dialogue pending |
| One source and choice in a review | `review_item` | Review item | choose whether to explore this inspiration in this session | implemented; deployment pending |
| One authored answer in a review | `review_answer` | Your thought | one answer, with the inspirations it refers to | in implementation |
| A conversation using the profile's memory | `conversation` | Talk with WAKA | think through a question with your own experiences | planned |
| Exported rendering of selected principle wording | `principle_artifact` | Share a principle | choose the words that leave WAKA | planned |

See [the capture foundation contract](docs/plans/2026-10-02-capture-foundation-contract.md).

## Words banned from the UI

lock, locked, provenance, source (as jargon), version, audit, history.
Exception: legal notices in settings, developer-facing docs. Every exception
carries a comment saying why.

---

*Repo footnote: the "Data & API" column is the destination shape and may
differ from this repo's current canon identifiers (e.g. lock exists as a
`lockedAt` timestamp, evidence links as the `signal_evidence` M:N table).
Where canon and this table disagree, `docs/data-model.md` wins — the table is
the truth of the dialect boundary and the UI language; the schema's truth is
the canon.*
