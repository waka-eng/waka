# Goal: Genuine cross-member Group Top of Mind synthesis

Status: superseded — genuine cross-member synthesis landed 2026-08-21 on the rebuilt base as refreshTopOfMindForGroup (see docs/generation.md §"The group's top of mind").
Branch: `goal/group-top-of-mind-latest`
PRD story: US-053 (extends US-052)

## Why

US-052 shipped Group Top of Mind boards, but v1 synthesis pooled each member's
*already-generated* personal notes and deduped them. That reads as "everyone's
Top of Mind added together." The product wants the group board to be a genuine
**new synthesis**: pool every member's *shared inspirations* (signals) and run
the same Top of Mind generation pipeline over that combined pool, so a single
group post-it can be grounded in inspirations from several different people.

Two asks, addressed together:

1. **Cross-member synthesis.** Group Top of Mind is generated from the pooled
   shared inspirations of all members, following the existing wow-moment / Top of
   Mind generation flow (embeddings → similar-candidate retrieval → model judge →
   note), but with the candidate pool spanning members.
2. **Evidence ownership.** When viewing which inspirations led to a group note,
   each inspiration is tagged with the member it belongs to.

## How it works

Reuse the existing generation pipeline, generalized to a multi-user candidate
pool:

- **Trigger set:** a bounded set of shared signals across all members (recent /
  high-resonance), each used as a synthesis trigger.
- **Candidate pool:** all members' `shared_to_groups = true` signals that have
  embeddings. Private signals are excluded at the query layer.
- **Retrieval:** for each trigger, rank the pooled candidates by embedding
  similarity + the existing runtime candidate score (cross-member).
- **Judge:** the existing model judge decides whether the trigger + top
  candidates form a real Top of Mind note; it only ever references ids from the
  provided pool.
- **Persist:** results are written to group-scoped tables so the board loads
  fast and deterministically between refreshes. Each evidence row records
  `owner_user_id`, so the board can tag every inspiration with its member.
- **Dedupe:** near-duplicate group notes are collapsed (reusing the existing
  dedupe) so the board stays to a handful of strong post-its.

Generation is triggered explicitly (a refresh) and best-effort on board load
when the board is empty, so the demo works without a manual step. Generation
needs the model provider; the same provider that already powers local
classification/embeddings is used.

## Data model

- `group_top_of_mind_notes`: group-scoped note (no single `user_id`); title,
  kind, why, belief/reflection, locale, wow_score, idempotency_key unique per
  group, timestamps.
- `group_top_of_mind_note_signals`: evidence rows with `signal_id` **and**
  `owner_user_id` (the member who saved that inspiration), role, reason,
  sort_order. Composite FK `(signal_id, owner_user_id) → (signals.id,
  signals.user_id)` so a row can reference any member's signal safely.

The single-user `top_of_mind_notes` composite FKs make it impossible to store
another member's signal against a personal note, which is exactly why group notes
need their own tables.

## API

- `GET  /api/groups/:groupId/top-of-mind` — persisted group notes with
  owner-tagged evidence; best-effort synthesis if empty. Member-only.
- `POST /api/groups/:groupId/top-of-mind/refresh` — regenerate from the current
  shared pool. Member-only.

## Acceptance criteria

See US-053 in `prd.json`. Summary:

- Group notes are generated from the pooled shared inspirations of all members,
  not by concatenating members' personal notes; a group note may cite
  inspirations from multiple members.
- Private inspirations never enter the pool or appear as evidence.
- Every evidence inspiration on a group note is tagged with its owning member.
- Notes persist to group-scoped tables and are deduped; refresh regenerates.
- Reuses the existing embeddings + judge pipeline (no parallel model contract).
- API + web tests; typecheck; live synthesis verified on localhost:3030.
