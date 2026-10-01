# The four-layer data model

**Status: canonical.** Decided 2026-08-15, revised same day to make
**profiles** first-class (owner + assistant review of the waka/waka-mcp
integration); **amended 2026-08-18 to add the fourth layer, principles**
(goal: `goals/principles.md`). This document is the vocabulary of record
for WAKA's data system. When code and this document disagree, the code is wrong — either
fix the code or amend this document first. New concepts land here before
they land in a schema.

Breaking changes are currently acceptable: no backward compatibility, no
legacy aliases. One name per concept, everywhere — DB, code identifiers,
API surface, MCP tools.

This document covers *what the layers are*. The generation mechanics —
exactly how signals are derived from inspirations and the top of mind from
signals, with every threshold — live in [generation.md](generation.md),
whose numbers are machine-checked against the implementation in CI.

---

## Accounts and profiles

An **account** is the auth identity: one login (email/Google), one person.

A **profile** is the unit that owns memory. Every profile — human or
agent — owns a full four-layer stack: inspirations → signals → top of
mind → principles. There is exactly one top of mind **per profile**;
principles are a growing set per profile.

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
| Its own agent profile | Full read/write: capture, curate signals, edit its top of mind, declare and curate its own principles |
| The account's human profile | **Read only**: top of mind, signals, and principles — the conditioning use case, an agent acting for the person reading how they choose. It writes NOTHING there, captures included: what an agent generates stays wholly in its own stack, so nothing an agent saves can move the human's inspirations, signals, or top of mind (founder ruling, 2026-08-29, decision log below — retires the read+capture default of 2026-08-15; relaying is the person keeping the memory themselves) |
| A sibling agent's profile | **Read only, and only through an explicit grant** (`agent_read_grants`, `POST /api/agent-grants`): human-granted, one-directional, revocable — revocation takes effect on the next request, and the revoked grant stays as record. Ungranted, the door is closed; and no grant opens capture — agents' generated memories never mix (same 2026-08-29 ruling). The open default retired 2026-08-24 with `goals/no-quiet-corners.md` Phase 6 (the flip is the founder's ruling of 2026-08-23, decision log below) |
| Other accounts | Nothing |

The human-profile session can do everything in every profile of the
account. Enforcement is server-side, keyed off the session's bound
profile — this is the concrete shape of the CLI-session scoping planned in
the auth-hardening track.

### What a keeper-key session may do

The one exception to "the human session is the account's admin": a session
resolved from a **keeper key** (below) is bound to the human profile but
carries `keyScoped`, and gets exactly two verbs on exactly one profile —
**read and capture on its own**. Keep an inspiration; read the four
layers; nothing else. No curation (an inspiration kept through the key is
edited at a browser), no other profiles (not even the account's own
agents), no account decisions (`humanSessionsOnly` refuses it). The scope
is enforced twice, deliberately: a positive route allowlist at the
`requireAuth` chokepoint (`keeperKeyMayPass`), and the `keyScoped` branch
of the access matrix underneath — a standing credential in a config file
on disk must not be the account's admin, however it is presented.

---

## The four layers

| | Layer 1 — **Inspiration** | Layer 2 — **Signal** | Layer 3 — **Top of mind** | Layer 4 — **Principle** |
|---|---|---|---|---|
| What | Raw capture: text, links, images | Distilled, durable pattern derived from inspirations | The synthesized artifact: what currently matters | How the profile chooses, stripped of context — a directive that survives its situations |
| Created by | Humans and agents (per the permission matrix) | WAKA server (background generation) | WAKA server (generated from signals) | WAKA server (nightly, from long-lived signals) + owner declarations |
| Modified by | Owner-profile admin; captures are editable and deletable | Curated/edited by the profile's admin; mainly machine-made | Edited by the profile's admin (personal) / members together (group) | Owner only: declare, edit (locks), reorder (sticky rank), delete, dispute |
| Cardinality | Unbounded list per profile — editable, deletable, **not** append-only | Evolving set per profile | **Exactly one** per profile; exactly one per group | Growing, **uncapped** set per profile — expensive to earn, merged on overlap |
| Visibility | Private to the owning profile's account | Private by default; shareable per group — the unit walls consume | Profile: account (+ optional public surface); group: members | Account-private; **not shareable** (v1); served to the profile's own credentialed tools via the canonical machine rendering |

The pipeline, per SPACE, and the rules are the same in every one of
them: a space's ground is what is visible in it; a space's signals are
distilled from its own ground; a space's top of mind is those signals
after people have acted on them — alone in your own space, together in
a room. For a person: inspirations accumulate → WAKA distills signals →
signals synthesize into the top of mind → what keeps surviving
distills, nightly, into principles.

**A room runs the same pipeline over a pooled ground** (founder ruling,
2026-08-24: "that room should create signals based on x+y+z"). A room's
ground is its members' public memories — x from one person, y from
another, z from a third — and the room distils ITS OWN signals from
them, owned by the room's mind (a `group`-type profile, migrations
0024/0025) rather than by any member. Three rules keep that honest:

- **Visibility stays global and two-valued.** One switch — private, or
  public to every room its owner is in. Per-room visibility is
  deliberately out of scope.
- **A room's signal appears only once memories from at least two
  different members stand under it.** A pattern one person's memories
  support is that person's own signal, already forming on their own
  wall, and must not wear the room's name — everything a room says
  about itself is genuinely collective.
- **The evidence asymmetry is deliberate, and it is not a global
  relaxation.** A ROOM's entries may name the memories that fed them,
  because a room's ground is public-to-the-room by construction — every
  memory on it was put there by its owner's own switch. **Your own top
  of mind keeps "that, never which."**

The room's top of mind is generated from the room's own signals through
the same synthesis pipeline, still gated by the members' affirmations
and proposals. Sharing an already-formed personal signal into a room
("say out loud") retires as the way statements reach a room — the
`signal_shares` record survives as history (the export still carries
it; the record outlives the verb), but the wall's future is what the
room grew. Principles do not participate in groups (v1).

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
    "agent"` for agent-initiated content. Since the 2026-08-29 ruling an
    agent-bound session cannot save into the human profile at all, so a
    human stack gains `source: "agent"` rows only from history predating
    the ruling; an agent's own stack is where its observations live.
- Inspirations carry a **`visibility`** of `private` (the default, at the
  column level) or `public`, chosen by the person who saved it and editable
  in both directions afterwards. Only `public` ones cross an account
  boundary, and only into the rooms that person's account belongs to —
  there is no world-readable capture. A room's *field* is exactly this: the
  public captures of its current members, each carrying whose it is.
  Closing one again removes it from every room at once, since no copy is
  made anywhere.

  This reverses the original rule ("inspirations never cross an account
  boundary; only signals are shareable"). A room that could show only the
  machine's readings of what people keep, and never what they actually
  kept, was a thinner room than the product wanted. The gate is per capture
  and never inferred.

  What is still absolute: **evidence never crosses**. A signal's evidence
  names the exact spans of the memories behind it, and sharing a statement
  has never shipped its grounds. A consequence worth knowing: a shared
  statement may cite memories its author kept private, so a room can show a
  statement whose grounds are not all visible in that room.
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

## Experience (layer-1 grouping)

The named ground a run of memories was gathered on (meeting decision,
2026-08-17 — deliberately **experience**, not "project": a project is a rule
scope, an experience is a stretch of lived work). One row per
`(profile, name)`, born at capture: naming an experience on a keep
finds-or-creates it in the capture's own transaction, so there is no second
birthplace to drift from.

- **An inspiration names at most one experience**, through a composite
  `(profile_id, experience_id)` FK — the same tenancy net every child of
  layer 1 uses, so a memory can never stand on another profile's ground.
- **Signals are deliberately NOT keyed to experiences.** A signal's relation
  to an experience is a fact of its *evidence* — which memories stand under
  it and where they were kept — so it is derived by joining
  `signal_evidence → inspirations → experiences`, never stored twice.
- **The lens**: `?experience=` on the inspirations and signals lists narrows
  recall to one ground; `GET /api/graph` draws
  principle → signal → experience from the same joins, statements and names
  only — capture text never crosses.

## Agent keys

The standing credential an agent profile holds (meeting decision,
2026-08-17: per-agent names and API keys). Issued and revoked by a
**human session only**; binds to an **agent profile only**; resolves through
`requireAuth` to an ordinary agent-bound session, so the access matrix and
`humanSessionsOnly` apply unchanged — a key is a way in, never a wider set
of powers once in. Only the secret's SHA-256 lands in `agent_keys`
(sessions-table posture); the secret is shown once at issue time. Revocation
is a timestamp and takes effect on the key's next request.

## Keeper keys

The mirror credential for the person (founder ask, 2026-08-29, completing
that day's ruling: with agents unable to capture into the human profile,
the person needs a first-class way to keep from their own MCP). Same
posture as an agent key in every mechanical respect — `waka_keeper_` +
48 hex, SHA-256-only at rest in `keeper_keys`, prefix for telling keys
apart, header-only (a key in a cookie is not a credential), revocation as
a timestamp effective on the next request, issued and revoked by the
unscoped human session only (a key cannot mint its successor). What
differs is the binding and the power: it binds to a **human profile
only**, re-checked at lookup so a hand-forged row cannot re-point it at an
agent, and the session it resolves is `keyScoped` — keep and recall on the
person's own memory, nothing else (matrix section above).

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
- **Disagreement, in three words** (no-quiet-corners Phase 5). A
  **tension** is two patterns held on purpose — both true, pulling against
  each other; it is layer-3 material, never a defect. **Contested** is an
  unresolved conflict: the three-way merge judge answered *opposed* in the
  ambiguous band, the new signal minted anyway, and an undirected
  `contradicts` pair (`signal_contradictions`) holds the dispute — both
  sides serve as contested until arbitration. Resolution comes **only from
  an owner act** — a lock, a verdict (`true` settles for the answered
  side, `not_true` against it; `partly` settles nothing), or a dismissal —
  never from evidence weight, however lopsided (founder ruling 2026-08-23,
  decision log below). The loser becomes **yielded**: a state read off the
  resolved pair at serve time, its row and evidence untouched. A state,
  never a deletion.

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
- **Group**: generated from the room's OWN signals — distilled from the
  pooled public memories of its members (ruling 2026-08-24; previously
  from signals members shared in, whose record survives as history).
  Entries can attribute contribution. Members change it together —
  proposals and affirmations are the co-editing mechanism — and
  accepted changes create new versions.

## Principle (layer 4)

**How the profile chooses, stripped of context.** A **rule** binds a
context ("≤$100 for LLM testing") and is checkable; a **principle**
survives having its context removed ("have something working before you
put more money in") and *compiles into* different rules per context.
WAKA stores the generator; captured rules are **evidence, never
artifacts**.

- **Five qualification tests**, all required for a minted principle:
  *context* (still instructs with every proper noun and number deleted),
  *directive* (prescribes the next choice; a fact about the person is a
  signal), *evidence* (cites ≥3 distinct signals from this profile's own
  history), *support* (dated evidence and representation in ≥1 top-of-mind
  versions), *completion* (can never be finished; anything checkable-off
  is a goal). Exact thresholds live in
  [generation.md](generation.md) and are drift-locked once implemented.
- **States**: `held` (demonstrated), `aspirational` (declared by the
  owner in their own words — locked from birth, visibly undemonstrated,
  redeemed to held when evidence arrives), `contested` (the owner's
  `not_true` verdict, or a judged conflict between two principles,
  marked as a pair). Contested stays visible; rank decides operationally
  until the owner resolves.
- **Human wording survives evidence loss.** A declared or human-edited
  principle is never automatically deleted when its support changes, even
  when it was originally minted. `unsupported_at` records loss of demonstrated
  support independently of a disagreement. Without a live dispute it reads
  `aspirational`; an existing `contested` stance stays contested. Both UI and
  machine rendering disclose withdrawn support while keeping the owner's
  instruction and wording. When qualifying evidence returns, the unsupported
  mark clears without resolving a dispute or rewriting the sentence.
- **Declarations are routed, never refused.** Validation runs
  internally at declaration: what qualifies becomes aspirational; what
  is really a rule or a goal is quietly kept as an inspiration — the
  layer where it already belongs. The surface shows where the words
  landed, never a test verdict.
- **Rank is the tie-breaker.** An explicit, owner-reorderable order;
  an owner reorder is sticky (generation thereafter appends, never
  re-sorts). This is what makes the set decidable for agents.
- **Many, not one.** The mirror of top of mind: top of mind is one
  bounded artifact rewritten whole and decaying by design; principles
  are an uncapped set selected by longevity, minted per-candidate with
  merge-on-overlap. Cardinality is the structural difference between
  the layers.
- **Generated from changed material**: three active, evidenced signals and
  at least one citing top-of-mind version can support an initial principle.
  Personal and room top-of-mind jobs request generation; opening the view
  can queue missed work. Requests are deduplicated by material fingerprint.
  A nightly cron and hourly local recovery pass cover missed triggers.
  Rooms own principles through their group profile, with membership-gated
  reads and citations restricted to currently visible room signals. Room
  curation is read-only; personal edits keep their existing locking behavior.
  State maintenance is immediate SQL. No calendar wait is required.
- **The canonical rendering is machine-facing**: one deterministic
  markdown document (rank-ordered, stable ids, a self-describing
  preamble carrying the consumption contract), served byte-identically
  to every consumer — the primary consumers are AI tools deciding on
  the person's behalf. The web view is the human's decorated reading of
  the same document. For agents acting for the human, **aspirational is
  binding**: the person's declared word governs what their agents obey;
  demonstration governs only what WAKA asserts.
- **Audit chain**: decision → principle → signals → the person's own
  captures. Agents cite principle ids in decisions they leaned on.

## The edit rule (regeneration vs. humans)

Layers 2, 3, and 4 are machine-generated *and* human-modifiable. The
conflict rule, everywhere, is: **human edits lock the entry**. (Owner
declarations at layer 4 are locked from birth — they are the owner's
words on arrival.)

- The server never rewrites a human-touched signal or top-of-mind entry.
- Regeneration may: add new signals/entries, retire *untouched* stale
  ones, and continue attaching evidence/confidence to locked items — the
  human's text is frozen, its support keeps updating.
- Unlocking is an explicit human act (revert to generated, or delete).

## Sharing and privacy, summarized

1. Inspirations: private by default; `public` per capture by explicit
   choice, and then visible only in the rooms that account belongs to.
   Never world-readable. Evidence never crosses, whatever the capture's
   visibility says.
2. Signals: private by default; shared per group by explicit choice; the
   shared surface is the distilled statement, not the evidence.
3. A profile's top of mind: account-private, unless the owner enables the
   public profile surface.
4. Group top of mind: visible to members; entries may attribute
   contributing members' shared signals.
5. Group membership is between **human profiles** for now; agent profiles
   do not join walls (revisit if a use case appears).
6. Principles: account-private, **not shareable** in v1 — the group wall
   stays signals-only. Served outward only as the canonical machine
   rendering, under the profile's own credential, per the matrix.

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
| **Principle** (L4) | No entity | New `principles` + `principle_signals` tables (statement, type `value \| maxim \| stance`, state, rank, lock; M:N citations to signals); `feedback.target_type` gains `principle`. |
| **Wall** (personal) | The one-surface web UI | Concept unchanged: a profile's own surface over its layers — the principles view joins it as an always-present nav verb (the empty view teaches what a principle is and offers the declare line). |
| **Group wall** | Group rooms + feed of members' shared captures | Now shows members' **shared signals** (distilled statements), never raw captures. |
| **Group top of mind** | `group_top_of_mind_notes` (+ per-evidence `owner_user_id`), direction proposals/affirmations | Becomes the group-scoped `top_of_mind` artifact; the direction machinery is the co-editing mechanism producing new versions. |
| CLI auth | `auth-cli.ts` loopback flow, `cli_login_codes`, sessions with `client: "cli"` | Loopback flow gains a **consent + profile-selection step**; the minted session binds to the chosen profile. Per-profile scoping (read+capture vs full) is enforced from that binding. |

### API surface after the cleanup

| Route | Layer | Notes |
|---|---|---|
| `POST /api/inspirations`, `GET /api/inspirations` | L1 | Capture + private archive/recall (today's `GET /api/signals` archive behavior moves here), plus edit/delete. |
| `GET /api/signals` | L2 | **Repurposed**: lists the acting profile's distilled signals (statement, confidence, evidence count, lock/share state). |
| `GET /api/top-of-mind` | L3 | Returns the acting profile's single current artifact (+ version metadata). |
| `GET /api/principles`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /reorder` | L4 | Ranked set + owner curation. **No refresh endpoint** — generation belongs to the nightly cron alone. |
| `GET /api/principles.md` | L4 | The canonical machine rendering: one deterministic markdown document, byte-identical for every consumer. |
| Cross-profile reads | L2/L3/L4 | An agent-bound session may read the human profile per the permission matrix (explicit target parameter; server-enforced). |
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
| `waka_get_principles` | `GET /api/principles.md` | Returns the canonical markdown document — the same bytes the endpoint serves — plus the structured list for tools that want fields. |

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

- **2026-08-18** — **Principles adopted as layer 4**: context-free
  directives ("how the profile chooses"), distinct from rules
  (context-bound, checkable — and stored only as evidence). Five
  qualification tests: context, directive, evidence, time, completion.
- **2026-08-18** — Principles are **many, not one**: an uncapped growing
  set selected by longevity — the structural mirror of the single
  decaying top of mind. Minted per-candidate with merge-on-overlap and
  judged conflict marking (contested pairs, rank decides meanwhile).
- **2026-08-18** — Principle generation runs **once per day at midnight
  PST and nothing else may trigger it**; state maintenance stays
  immediate. Declarations are instant, owner-made, locked from birth.
- **2026-08-18** — Declarations are **routed, never refused**: internal
  validation sends qualifying ones to aspirational and rule/goal-shaped
  ones to the inspiration archive, with no displayed test verdict.
- **2026-08-18** — The **canonical rendering is machine-facing**: one
  deterministic markdown document served byte-identically everywhere;
  the web view is the human's reading of it. For agents acting on the
  person's behalf, aspirational principles are binding as the person's
  declared word.
- **2026-08-18** — Principles are per-profile like every layer, **not
  shareable** in v1, read-only to agent sessions on the human profile,
  and surfaced under progressive disclosure.
- **2026-08-21** — Progressive disclosure **reversed** (owner decision):
  the principles nav verb is always present, empty set or not — the
  empty view is the explanation. The board header ("X's top of mind" +
  last-read) now renders only on the wall view; every other view titles
  itself.
- **2026-08-21** — **The group wall returns to the web surface** as the
  rooms views (`/rooms`, `/rooms/:groupId`): doors, join-by-code, the
  wall of shared signals, the share picker, and the co-edited group top
  of mind with the full proposal flow. The rebuild had parked the old
  rooms UI and left the web group client unconsumed.
- **2026-08-21** — **Group top-of-mind synthesis implemented.** The
  rebuild shipped `refreshTopOfMindForGroup` as an explicit
  `not_implemented` seam — walls and proposals worked, but acceptance
  never materialized and no group reading was ever generated, which this
  document had described as existing. Now true: the wall is the
  selection, member decisions are applied by code (edit locks, removal
  dismisses, addition arrives locked), citations carry per-member
  attribution, and the groups e2e asserts that acceptance materializes
  a version. Mechanics: `docs/generation.md` §"The group's top of mind".

- **2026-08-22** — **Erasure is the model's one true delete, and its blast
  radius is now named.** Account erasure deletes every version of every
  group top of mind for any group the departing member was in or whose
  artifact cites their signals (`lib/account-erasure.ts`), then the room
  regenerates clean — one member's erasure destroys the whole room's
  co-authored version history. This is the sole exception to "fading
  never deletes," recorded here so the vocabulary of record stops being
  falsified by the code it governs. **Open ruling, gated on the founder
  and counsel** (`goals/a-room-you-can-trust.md`, Phase 0b): whether a
  majority-approved entry is the room's collective speech (versions
  survive, the departed rendered nameless and groundless) or the departed
  member's personal data (the current cascade is correct). Until ruled,
  no audit-of-record claim may be made for rooms.
- **2026-08-22** — **Open ruling, recorded before any non-human mind can
  touch a room: the decline asymmetry.** Accepting a group proposal
  needs a strict majority of current members; any single member can
  decline — kill — any open proposal alone
  (`routes/groups-proposals.ts`). Proposed resolution: refusal becomes a
  counted stance like affirmation — a proposal dies when a majority
  against is assured, or on timeout — so "a member is a member" holds
  for both verbs. Gated on the founder (`goals/a-room-you-can-trust.md`,
  Phase 0c); the code keeps today's rule until the ruling lands.
- **2026-08-29** — **The keeper key ships**: a standing credential for
  the PERSON, so their own MCP can keep and recall without the browser
  consent dance — the ask that completes the same day's separation
  ruling, which had retired the last way an agent could add to the
  human's stack. Deliberately LESS than the person: the session it
  resolves is `keyScoped` (read + capture on the person's own profile,
  nothing else), so a config file on disk never holds the account's
  admin. `keeper_keys` table, `waka_keeper_` prefix, `keeperKeyMayPass`
  allowlist at the `requireAuth` chokepoint, `keyScoped` branch in the
  matrix beneath it.
- **2026-08-29** — **RULED (founder): agent-generated memory is fully
  separate from the human's.** An agent session may READ the human
  profile (conditioning) and nothing more: the capture verb on the human
  is retired, and sibling grants open reading only — capture across any
  two profiles is now exclusively the human admin's act. Nothing an
  agent saves can enter, and therefore ever move, another profile's
  inspirations, signals, or top of mind. Supersedes the 2026-08-15
  read+capture default; enforcement is the one matrix in
  `resolveProfileAccess`, so every route inherits the flip. A
  consequence recorded honestly: the confidence source-diversity bonus
  can no longer newly arise on a human profile (agent-sourced evidence
  cannot arrive there); historical rows keep counting.
- **2026-08-23** — **RULED (founder): the sibling door flips to opt-in.**
  An agent-bound session reads and captures only the profile it is bound
  to and the human's; reading a sibling agent's memory requires an
  explicit, revocable, human-granted pairing listed beside credentials.
  The open intra-account default (`resolveProfileAccess` granting every
  agent read+capture on every profile) is retired with the grant
  machinery in `goals/no-quiet-corners.md` Phase 6 — no longer
  founder-gated; the flip ships with the phase.

- **2026-08-23** — **RULED (founder): WAKA is both.** The identity
  question is answered in the plural: a world for one person and their
  minds, AND infrastructure for teams — neither is a pivot away from the
  other. Sequencing is unchanged (the personal trust core ships first;
  the team door still stands behind its hard gates — the security audit
  before hosting strangers, eyes before hands before votes), but the
  team direction is identity now, not a hypothesis awaiting pilot
  evidence to justify its existence. Pilot evidence still decides
  *pace*, never *whether*.

- **2026-08-23** — **RULED (founder): the machine never picks between two
  things it believes about you.** The register's standing arbitration
  question is closed in the strictest direction: when derivation holds
  two opposed beliefs, both stand as **contested** and resolution comes
  only from an owner act (a lock or a verdict), after which the loser
  becomes **yielded** — a state, never a deletion. No evidence weight,
  however lopsided, resolves a pair on its own; the machine may name a
  tension, never settle one. This is "the world never moves unless the
  user moved it," applied to belief. Governs
  `goals/no-quiet-corners.md` Phase 5 (contested pairs), whose design
  assumed exactly this and is now doctrine rather than proposal.

- **2026-08-23** — **RULED (founder): a sentence the room approved belongs
  to the room.** The erasure question above is closed. Erasure stays the
  one true delete for everything the person OWNS — profiles, inspirations,
  signals, sessions, uploaded bytes — and now touches nothing the room
  settled: versions, entries, settled proposals, settled stances, and door
  marks all survive as **departed marks** (their `profiles` FKs are
  `set null`; the surface reads "someone" where a name was). The name is
  what erasure removes; the fact that someone was here is the room's.
  Live hands are withdrawn in the same transaction — the erased person's
  open proposals, and their stances on anyone's open proposals, go the way
  a removed member's do — and a `left` door mark is written per seat.
  "Fading never deletes" no longer has an exception for rooms.
  Implemented in `lib/account-erasure.ts`, migration
  `0016_the_departed_keep_their_marks`, pinned by
  `lib/account-erasure.db.test.ts` on real Postgres.

- **2026-08-23** — **RULED (founder): refusal is a counted stance, not a
  veto.** The decline asymmetry above is closed, in the direction
  proposed. A "not us" is recorded per member beside the yeses
  (`group_top_of_mind_affirmations.stance`: affirmed | declined; one row
  per member per proposal, answering again replaces the answer). A
  proposal carries on a strict majority of yeses against the current
  roll, exactly as before; it falls only when the nos make that majority
  arithmetically impossible (`fallsToDeclines`: declines × 2 ≥ members —
  in a room of two, one refusal still settles the question, now as
  arithmetic rather than as a veto). The author's own decline still
  resolves alone: withdrawing your own sentence is not a veto over
  anyone else. "A member is a member" now holds for both verbs.
  Implemented in `routes/groups-proposals.ts`, migration `0015_no_veto`,
  pinned by `routes/room-decline.db.test.ts` on real Postgres.

- **2026-08-22** — **The room's record survives its members** (Phase 0a
  of `goals/a-room-you-can-trust.md`): membership events are append-only
  history (`group_membership_events` — joined/left/removed; the seat row
  remains only the current seat), removal takes votes only from open
  proposals (who carried an accepted version is history), and a deleted
  signal leaves entry citations in place with a null reference rather
  than unwriting them from past versions. Evidence quotes are now stored
  only as verified spans, labeled whose words they are
  (`signal_evidence.quote_source`: own | enrichment); the lock gained
  its promised other half as **release** (the words stand; the generator
  regains jurisdiction; releasing unsupported words retires them).

The migration itself (schema, API, web, MCP phases and gates) belongs in a
`docs/goals/` goal document that references this file — for this layer,
`goals/principles.md`.
