# The three-layer data model

**Status: canonical.** Decided 2026-08-15, revised same day to make
**profiles** first-class (owner + assistant review of the waka/waka-mcp
integration). This document is the vocabulary of record for WAKA's data
system. When code and this document disagree, the code is wrong — either
fix the code or amend this document first. New concepts land here before
they land in a schema.

Breaking changes are currently acceptable: no backward compatibility, no
legacy aliases. One name per concept, everywhere — DB, code identifiers,
API surface, MCP tools.

---

## Accounts and profiles

An **account** is the auth identity: one login (email/Google), one person.

A **profile** is the unit that owns memory. Every profile — human or
agent — owns a full three-layer stack: inspirations → signals → top of
mind. There is exactly one top of mind **per profile**.

- Each account has one **human profile**: the person's own memory.
- Each account can have **agent profiles**: separate stacks that agents
  use as *their own* memory (observations, lessons, working knowledge).
  The schema supports N agent profiles per account (each typed and named);
  the product starts by offering one.
- The human is admin of every profile in their account: they can see and
  edit everything, including an agent profile's memory.

Agent separation is **structural, not a lens**: an agent's own memory
lives in its own profile, not as filtered views over the human's data.
(The earlier lens-board design is superseded by this.)

### Credentials bind to a profile

Every session acts *as* exactly one profile:

- The browser session acts as the human profile (admin over the account).
- A CLI/MCP credential is minted **bound to one profile**, chosen during
  the loopback login's consent step. An agent using WAKA as its own memory
  logs in bound to its agent profile; audit and revocation are
  per-profile.

### What an agent session may do

A session bound to an agent profile gets:

| Target | Allowed |
|---|---|
| Its own agent profile | Full read/write: capture, curate signals, edit its top of mind |
| The account's human profile | **Read + capture only**: read top of mind and signals (the conditioning use case), and capture inspirations into it — never edit or delete the human's signals or top of mind |
| Other accounts | Nothing |

The human-profile session can do everything in every profile of the
account. Enforcement is server-side, keyed off the session's bound
profile — this is the concrete shape of the CLI-session scoping planned in
the auth-hardening track.

---

## The three layers

| | Layer 1 — **Inspiration** | Layer 2 — **Signal** | Layer 3 — **Top of mind** |
|---|---|---|---|
| What | Raw capture: text, links, images | Distilled, durable pattern derived from inspirations | The synthesized artifact: what currently matters |
| Created by | Humans and agents (per the permission matrix) | WAKA server (background generation) | WAKA server (generated from signals) |
| Modified by | Owner-profile admin; captures are editable and deletable | Curated/edited by the profile's admin; mainly machine-made | Edited by the profile's admin (personal) / members together (group) |
| Cardinality | Unbounded list per profile — editable, deletable, **not** append-only | Evolving set per profile | **Exactly one** per profile; exactly one per group |
| Visibility | Private to the owning profile's account | Private by default; shareable per group — the unit walls consume | Profile: account (+ optional public surface); group: members |

The pipeline, per profile: inspirations accumulate → WAKA distills
signals → signals synthesize into the top of mind. The group flow reuses
the middle layer: members share signals to a group wall, and the group's
top of mind is generated from those shared signals.

## Inspiration (layer 1)

A capture event. Whatever arrived: pasted text, a link, an image, an
agent's relayed excerpt, an agent's own observation.

- **Editable and deletable.** Editing an inspiration re-derives the
  signals it supports. Deleting one removes its evidence links; a signal
  that loses all evidence is retired — unless human-locked, in which case
  its text stays and it is marked unsupported.
- **Provenance is recorded at capture**, two facts kept distinct:
  - *which session captured it* (the bound profile — audit), and
  - *whose initiative the content is*: `source: "app"` for
    human-directed content (their words, relayed or typed), `source:
    "agent"` for agent-initiated content. An agent-bound session saving
    "이거 와카에 넣어줘" into the human profile writes `source: "app"`;
    an agent spontaneously noting something about the human writes
    `source: "agent"`.
- Inspirations **never cross an account boundary**: not shown on group
  walls, not cited to other members, not exported by group flows.
- Attachments (links, images, files) hang off the inspiration.
  **Enrichment** is machine-derived capture-time context stored with the
  attachment and never presented as the human's words: a link attachment
  gets a bounded, deterministic fetch of the page (title, description,
  bounded text); an image attachment gets a one-time vision description,
  cached on the attachment and re-derived only if the attachment
  changes. Enrichment exists so layer-2 extraction can read what the
  human *saved*, not only what they typed.
- **Reflections** — the short Q&A a human attaches at capture (or later)
  — are layer-1 detail on the inspiration: kept, human-authored, and
  input to extraction. The guided question *generator* is a parked
  feature; the stored reflections are not.

## Signal (layer 2)

**An evidence-backed pattern**: a durable distilled statement — a taste,
a theme, a tension, a belief — that cites the profile's inspirations as
evidence.

- **M:N evidence**: one signal cites any number of inspirations; one
  inspiration can support any number of signals. New inspirations
  strengthen existing signals (more evidence, higher confidence) or spawn
  new ones. Signals are *patterns*, not per-capture fragments.
- **Server-generated**: the background pipeline (classification,
  embeddings, the context graph) exists to produce and maintain signals.
  Those mechanisms are internal machinery; the signal is the product.
- **Human-curated**: the profile's admin can edit a signal's statement,
  merge, hide, or delete it. A human edit **locks** the signal (see the
  edit rule).
- **The shareable unit**: sharing is a per-signal, per-group choice. A
  shared signal appears on that group's wall as its distilled statement.
  Its evidence (the underlying inspirations) stays private — members see
  the pattern, never the raw captures.

## Top of mind (layer 3)

The single synthesized artifact answering "what currently matters, is
believed, and is in question" — for that profile. A human profile's top
of mind is the person's ambition mirror; an agent profile's is the
agent's distilled working memory.

- Composed of **entries** (individual statements/questions/tensions), but
  the artifact is the unit: one identity, one current version, a linear
  version history. Regeneration produces a new version; nothing is
  mutated in place.
- **Profile-scoped**: generated from that profile's signals; the admin
  can edit entries (which locks them), pin, dismiss, reorder.
- **Group**: generated from the signals members have shared to that
  group; entries can attribute which members' signals fed them. Members
  change it together — proposals and affirmations are the co-editing
  mechanism — and accepted changes create new versions.

## The edit rule (regeneration vs. humans)

Layers 2 and 3 are machine-generated *and* human-modifiable. The conflict
rule, everywhere, is: **human edits lock the entry**.

- The server never rewrites a human-touched signal or top-of-mind entry.
- Regeneration may: add new signals/entries, retire *untouched* stale
  ones, and continue attaching evidence/confidence to locked items — the
  human's text is frozen, its support keeps updating.
- Unlocking is an explicit human act (revert to generated, or delete).

## Sharing and privacy, summarized

1. Inspirations: never cross an account boundary. Period.
2. Signals: private by default; shared per group by explicit choice; the
   shared surface is the distilled statement, not the evidence.
3. A profile's top of mind: account-private, unless the owner enables the
   public profile surface.
4. Group top of mind: visible to members; entries may attribute
   contributing members' shared signals.
5. Group membership is between **human profiles** for now; agent profiles
   do not join walls (revisit if a use case appears).

---

## Vocabulary of record → current code

The current implementation predates this model and uses several of these
words for the wrong layer. Disposition of every existing concept:

| Canonical concept | Today in the code | Disposition |
|---|---|---|
| **Account** | `users` table | Stays the auth identity. |
| **Profile** | No entity — all data keyed `user_id` | New `profiles` table (`account_id`, `type: human \| agent`, name). Every memory table re-keys from `user_id` to `profile_id`. Public handle/visibility flags move from `users` to the human profile. |
| **Inspiration** (L1) | `signals` table (!), written by `POST /api/inspirations`; code aliases `signals`/`inspirations` for the same rows | Rename table + identifiers to `inspirations`; the alias dies. The route was right all along. Not append-only: editable/deletable with the evidence-cascade rule. |
| Capture provenance | `signals.source` (`app`/`agent`), `sessions.client` (`web`/`cli`) | `source` keeps its meaning (whose initiative). `sessions.client` is replaced by the session's **bound profile** (`sessions.profile_id`), which also subsumes the audit half of provenance. |
| Spark (removed) | `signal_sparks` (offsets, confidence, source variants incl. auto-detected, six unused analysis columns) | **Removed from the model entirely** — capture is text + attachments; salience extraction is wholly layer 2's job. Table and all spark code are deleted. Revisit only if telemetry shows extraction needs a human salience prior. |
| **Reflections** (L1 detail) | `reflections` | Kept — human-authored Q&A on an inspiration, re-keyed under profiles; input to extraction. The guided question *generator* is parked separately; the stored answers are not. |
| **Signal** (L2) | No first-class entity. Nearest machinery: `context_nodes`/`context_edges`/`context_evidence`, `signal_packets` | New first-class `signals` table: statement, confidence, lock state, share state, evidence links (M:N to inspirations). Embeddings become internal generation machinery; `signal_packets` are **deleted** (extraction reads inspirations + enrichment directly); the context-edge graph is parked. |
| Sharing flag | `signals.shared_to_groups` on the **capture** row | Moves to layer 2: per-signal, per-group. Raw captures are no longer shareable at all. |
| **Top of mind** (L3) | `top_of_mind_notes` (physical table renamed from `wow_moments`, code identifier still `wowMoments`), plus a separately computed `topOfMind` preview blob | One versioned `top_of_mind` artifact **per profile** with entries; notes table, preview blob, and the WOW→note compatibility serializer are all replaced. |
| WOW vocabulary | `wow_kind`, `why`, `belief_statement`, `reflection_question`, `reflection_guide`, `wow_score`; routes `/api/wow-moments`, `/api/wow-status` | Deleted. Native entry fields are designed for the new generator (`type`, `body`, `prompt`, `confidence` carry over from the current surface; belief statements get a deliberate yes/no as a native field, not a legacy leftover). |
| Lens boards | `top_of_mind_notes.lens` (`all`/`app`/`agent`) with separately generated per-lens boards | Deleted — superseded structurally: agent memory lives in the agent profile's own stack. `source` provenance remains on inspirations. |
| **Wall** (personal) | The one-surface web UI | Concept unchanged: a profile's own surface over its three layers. |
| **Group wall** | Group rooms + feed of members' shared captures | Now shows members' **shared signals** (distilled statements), never raw captures. |
| **Group top of mind** | `group_top_of_mind_notes` (+ per-evidence `owner_user_id`), direction proposals/affirmations | Becomes the group-scoped `top_of_mind` artifact; the direction machinery is the co-editing mechanism producing new versions. |
| CLI auth | `auth-cli.ts` loopback flow, `cli_login_codes`, sessions with `client: "cli"` | Loopback flow gains a **consent + profile-selection step**; the minted session binds to the chosen profile. Per-profile scoping (read+capture vs full) is enforced from that binding. |

### API surface after the cleanup

| Route | Layer | Notes |
|---|---|---|
| `POST /api/inspirations`, `GET /api/inspirations` | L1 | Capture + private archive/recall (today's `GET /api/signals` archive behavior moves here), plus edit/delete. |
| `GET /api/signals` | L2 | **Repurposed**: lists the acting profile's distilled signals (statement, confidence, evidence count, lock/share state). |
| `GET /api/top-of-mind` | L3 | Returns the acting profile's single current artifact (+ version metadata). |
| Cross-profile reads | L2/L3 | An agent-bound session may read the human profile per the permission matrix (explicit target parameter; server-enforced). |
| `/api/wow-moments`, `/api/wow-status` | — | Deleted. |

### MCP tools after the cleanup

Tools act as the session's bound profile by default; cross-profile access
follows the permission matrix.

| Tool | Maps to | Notes |
|---|---|---|
| `waka_add_inspiration` (was `waka_add_signal`) | `POST /api/inspirations` | Same `source: "app" \| "agent"` contract; target profile defaults per binding (human-directed saves go to the human profile). |
| `waka_list_inspirations` (was `waka_list_signals`) | `GET /api/inspirations` | Episodic recall over raw captures. |
| `waka_list_signals` (new meaning) | `GET /api/signals` | Distilled patterns — likely the most useful recall surface for agents. |
| `waka_get_profile` | `GET /api/top-of-mind` | The bound profile's artifact; an agent session may also read the human profile's (read-only). |

---

## Naming rules going forward

1. One name per concept. No aliases, no `X (a.k.a. Y)` exports, no
   physical table named differently from its code identifier.
2. The API surface is the canonical vocabulary; storage follows it (via
   migration, not via serializer shims — the shim era ends with this
   cleanup).
3. MCP tool names track the canonical nouns, renamed in lockstep with the
   API in the same change.
4. A concept that needs a new word gets added to this document first.

## Decision log

- **2026-08-15** — Three-layer model adopted (inspiration → signal → top
  of mind); layers 2–3 are WAKA-generated, human-modifiable.
- **2026-08-15** — A signal is an **evidence-backed pattern** (M:N to
  inspirations), not a per-capture extraction.
- **2026-08-15** — **Human edits lock** entries against regeneration; the
  server adds and retires around locked items.
- **2026-08-15** — Sharing moves to layer 2: walls show distilled
  signals; raw inspirations never cross accounts.
- **2026-08-15** — **Profiles are first-class**: every profile (human or
  agent) owns a full stack; one top of mind per profile. Agent profiles
  are sub-profiles of the account (schema N, product one); the human is
  admin of all of them. Supersedes the lens-board decision from earlier
  the same day.
- **2026-08-15** — Inspirations are **editable and deletable** (not
  append-only); deletions cascade through evidence links, retiring
  unsupported unlocked signals.
- **2026-08-15** — Agent sessions get **read + capture** on the human
  profile, full access only to their own profile.
- **2026-08-15** — **Credentials bind to one profile**, chosen at the
  loopback login's consent step; audit and revocation are per-profile.
- **2026-08-15** — Defaults pending a counter-case: only humans and
  agents create inspirations (no system imports); groups are between
  human profiles; agent profiles don't join walls.
- **2026-08-15** — **Sparks removed from the model** (supersedes the
  keep-spark ruling from earlier the same day): capture is text +
  attachments only; no span annotation survives. Revisit only if
  telemetry shows extraction measurably needs a human salience prior.
- **2026-08-15** — Attachments are parsed into **enrichment**: links via
  a bounded deterministic fetch (title/description/bounded text), images
  via a one-time cached vision description. Enrichment is machine
  context at layer 1, consumed by extraction and embeddings — never
  presented as the human's words.
- **2026-08-15** — Reflections are kept as layer-1 detail (cleanly
  separable from the parked question generator); `signal_packets` are
  deleted — extraction reads inspirations and their enrichment directly.
- **2026-08-15** — Generation design adopted (see the goal doc, Phases
  4–5): signals via extract → embed → match-or-mint per inspiration;
  top of mind via one whole-artifact synthesis call per debounced
  refresh; the six-cluster classification call and the keyword-bucket
  node ontology are deleted, not ported.

The migration itself (schema, API, web, MCP phases and gates) belongs in a
`docs/goals/` goal document that references this file.
