# Goal: three layers on a clean slate — profiles, signals, and one top of mind

Status: draft — awaiting owner review (2026-08-15). Phase 0's gate is owner
sign-off on the keep/park/delete inventory; nothing is deleted before that.
Branch: `goal/three-layers`
Canon: `docs/data-model.md` — this goal implements that document and has no
model opinions of its own. If a phase discovers the canon can't express
something the product needs, the phase halts and the canon gets amended
first; the code never wins an argument with the document.
Follows: the waka-mcp contract hardening (waka#230, waka-mcp#2). Supersedes
the lens-board work from `edccb55`/`c9d3502` at the model level (provenance
survives; lens boards die). `two-clocks` stays halted and is unaffected
except that its input tables are parked with their features.

## Why

Three forces converge on a rebuild rather than another rename-in-place:

1. **The vocabulary is inverted, and it already shipped a bug.** The table
   named `signals` stores what the canon calls inspirations; "top of mind
   notes" are physically `wow_moments` wearing a serializer; half the graph
   code answers to two names. The waka-mcp profile-mapping bug happened
   because a client was written against the storage vocabulary instead of
   the surface — that class of bug is a naming-debt tax, and it recurs
   until one name means one thing.

2. **The product model changed shape.** Profiles are now first-class: every
   profile (human or agent) owns a full inspiration → signal → top of mind
   stack, agents get their own memory rather than a lens over the human's,
   credentials bind to a profile, and sharing moves to the signal layer so
   raw captures never cross an account boundary. That is not a column
   rename — it re-keys ownership itself (`user_id` → `profile_id`
   everywhere) and changes what walls display.

3. **The owner has explicitly priced the alternatives.** Breaking changes
   are acceptable, there is no production data to preserve, and a wiped
   database with a clean baseline schema is *preferred* over a complex
   migration chain or compatibility shims. The cheapest honest path is to
   design the schema the canon describes, reset to a single baseline
   migration, and rebuild the layers on it — deleting the WOW/lens/alias
   era outright instead of deprecating it.

The wipe is approved in principle for local and dev databases. The phase
that executes a wipe against any remote database confirms the exact
connection target with the owner at execution time; approval of this
document is not approval of a specific `DROP`.

## Shape of the work

Nine phases. Each lands on `goal/three-layers`, one commit per phase
minimum, checks per `AGENTS.md` (`pnpm --filter @waka/api typecheck`,
`test:unit`, `pnpm db:check` for schema phases, `pnpm --filter @waka/web
typecheck` + build for surface phases). Phases 4–6 spend Gemini calls in
their e2e gates — expected cost is trivial (tens of flash-lite calls), but
state the count before running per the goal rules.

A recurring gate device below is the **grep gate**: a named list of
patterns that must return zero hits outside an explicit allowlist
(`docs/archive/**`, `index.html`, `progress.txt`). Grep gates are how "the
alias died" becomes a measurement instead of a mood.

---

### Phase 0 — Canon lands; the demolition inventory

Land `docs/data-model.md` (already drafted). Walk the entire API + web +
tools surface and produce, in this goal's `## Log`, a three-column
inventory: **keep** (carries into the rebuild as-is or re-keyed), **park**
(feature leaves the product for now; tables/code removed; may return as a
future goal on the new base), **delete** (gone, no return path).

Starting proposal, for the owner to amend at the gate:

- Keep: email+Google auth, attachments presign flow, Postgres-as-queue
  background jobs, Gemini plumbing (`gemini.ts`, model provider), the
  classifier/embedding/context-graph machinery (as internal signal
  generation), groups membership, the direction proposal/affirmation
  machinery (becomes group top-of-mind co-editing), vault export/reindex.
- Park (with their tables): decision-memo, guided-reflection, salience/
  readings surfaces, room timelines, combinations, member events, revisit
  events, activations, signal embeddings if unused by signal generation
  v1. Parked features get one line each in `## Log` naming the goal that
  would revive them.
- Delete: `/api/wow-moments`, `/api/wow-status`, the WOW→note
  compatibility serializer, lens boards, every alias export, the legacy
  `index.html` monolith reference in docs (file may stay archived), stale
  `tools/e2e` scripts that AGENTS.md already flags as dead. Plus the
  audit-confirmed dead list (2026-08-15 pipeline audit): the six-cluster
  classification call (`queue/gemini.ts` classifier — its only living
  consumers are two same-cluster tie-breakers), the keyword-bucket node
  ontology in `meaning-graph-writer.ts` (canned labels), the legacy
  pairwise auto-WOW path (`lib/auto-wow-generation.ts`, zero callers),
  `spreadCaptureActivation` (zero callers), the memory-movement event
  enum (`evaluateSignalMemoryMovement`, test-only), the aliased
  `signalScores` fields (three of five are copies), the `asks_for` edge
  kind (never produced), the sparks concept entirely (`signal_sparks`
  table and all spark code — removed from the canon 2026-08-15), and
  `meaning_packets.input_fingerprint` (written, never read).
- Park additionally: `scoring/stability.ts` + `lib/node-dynamics.ts`
  (dark code reachable only from dev scripts; parked with the two-clocks
  verdict), and the context-edge graph (cross-signal relations return at
  layer 3 where they are useful).

**Gate (owner):** the inventory is reviewed and signed by the owner —
recorded in `## Log` as the amended keep/park/delete lists. Fail = the
model needs another pass; halt and revise the canon instead of building.

### Phase 1 — The clean schema and the baseline reset

Write the new Drizzle schema from the canon: `accounts`, `profiles`
(account_id, `type: human | agent`, name; unique human per account),
`sessions` (profile-bound), `cli_login_codes`, `inspirations` (+
`attachments` with their enrichment block), `signals` + `signal_evidence` (M:N
to inspirations; lock state; confidence), `signal_shares` (per-signal,
per-group), `top_of_minds` (one live artifact per profile and per group;
version chain) + `top_of_mind_entries` (typed, lockable, attributable),
`groups` + `group_members`, group co-edit tables (from the kept direction
machinery), `background_jobs`, `feedback` (re-pointed at new targets),
plus whatever the keep-list requires (context graph tables re-keyed to
profiles as internal machinery).

Delete `drizzle/migrations/0000…0048` and `meta/`; generate migration
`0000_three_layers` as the sole baseline. Update `tools/seed-demo.ts` to
create an account, its human profile, one agent profile, and a small
demo stack. Local/dev database is wiped and re-migrated.

**Gate:** `pnpm db:generate` yields exactly one baseline migration;
`pnpm db:migrate` onto a wiped local DB succeeds; `pnpm db:check` clean;
a schema-review table in `## Log` maps every canon concept to exactly one
table name with zero aliases — any concept that wouldn't fit the schema
without a hack is a halt-and-amend-canon, not a workaround.

### Phase 2 — Accounts, profiles, and profile-bound auth

`users` becomes `accounts`; signup/login/Google flows re-target it and
create the human profile. The CLI loopback flow gains a **consent page
with a profile picker**: `/api/auth/cli/start` renders an "allow this
terminal as <profile>?" step (this also closes the SameSite=Lax drive-by
minting hole — a side effect worth naming), and the exchanged session
binds `sessions.profile_id`. Authorization middleware enforces the canon's
matrix: human-profile sessions are account admins; agent-bound sessions
get full access to their own profile, read + capture on the human
profile, nothing else, enforced server-side per route.

**Gate:** an authorization test suite proves the matrix — for each (session
binding × target profile × operation class) cell, a test asserts
allow/deny; the drive-by case (top-level GET to `/start` without consent
interaction) mints nothing. `test:unit` green.

### Phase 3 — Layer 1: inspirations

Capture (`POST /api/inspirations`), **edit and delete** (new — the canon
retired append-only), archive/recall (`GET /api/inspirations`, absorbing
today's `/api/signals` archive behavior) with **SQL-backed search**
replacing the in-memory newest-200 filter — rebuilding the read path
anyway is the moment to fix recall depth. Provenance: `source: app |
agent` per the canon's two-fact rule (initiative vs. capturing session).
Attachment enrichment becomes both-modal: links keep the bounded
deterministic fetch (title/description, upgraded to bounded page text);
images get a one-time vision description (flash-lite, cached on the
attachment, re-derived only when the attachment changes). Enrichment
feeds extraction and embeddings and is never rendered as the human's
words. Web: capture + archive surfaces speak the new routes.

**Gate:** API tests for create/edit/delete/search incl. tenant isolation
across profiles (profile A's session cannot read profile B's inspirations
even within wiring mistakes — negative tests); search returns a match
beyond the 200 newest (seed 300, find #1). Web capture smoke passes.

### Phase 4 — Layer 2: signals

The generator, per new or edited inspiration (background job):

1. **Extract** — one flash-lite call producing 0–3 candidate signal
   statements in the user's own language, each grounded in cited spans
   of the text and its attachment enrichment. This one call replaces
   both the six-cluster classification (deleted) and the keyword-bucket
   ontology whose canned labels were the old middle layer's biggest
   fidelity gap.
2. **Embed** the inspiration and each candidate statement
   (`gemini-embedding-001`, 768d, unchanged).
3. **Match or mint** — deterministic: a candidate above a high cosine
   threshold against the profile's existing signals attaches as new
   evidence (strengthening it); an ambiguous band gets one merge-judge
   call ("same underlying pattern?"); below it, a new signal is minted
   `emerging`. Thresholds are tuned at this phase's gate, not guessed
   here.
4. **Lifecycle, pure code** — confidence from evidence count, time
   spread, and source diversity; `emerging` promotes at ≥3 evidence; the
   cascade rule (edit re-derives; delete drops evidence links and
   retires unsupported **unlocked** signals, locked ones survive marked
   unsupported); locks absolute.

Curation endpoints: edit statement (sets lock), hide, delete. Per-signal
per-group sharing replaces `shared_to_groups`. `GET /api/signals` now
means layer 2. The context-edge graph is parked, not rebuilt.

**Gate (e2e, spends Gemini):** on a fresh profile, capture 5 related + 2
unrelated organic inspirations; within the background cadence, ≥1 signal
exists citing ≥2 of the related inspirations as evidence, and statements
are profile-specific — two profiles seeded with *different* content must
produce zero identical statements (the canned-ontology regression test).
One of the related captures is an image with no text and one is a bare
link: both must still contribute evidence via their cached enrichment.
Cascade tests: deleting all evidence retires an unlocked signal and
preserves a locked one as unsupported. Lock test: regeneration never
alters a locked statement (byte-equal before/after).

### Phase 5 — Layer 3: one top of mind per profile

Refresh is cooldown-debounced after signal changes (plus manual). The
generator: (1) deterministic selection of the top K signals —
confidence, evidence count, reinforcement recency, and the
dormancy-comeback bonus kept from `memory-movement` (a signal returning
after months outranks a hot streak); (2) **one** synthesis call for the
whole artifact — in: the current version with locked entries marked
immutable, the selected signals, recent feedback; out: the next
version, entries typed (`pattern | tension | question | hypothesis |
action`, belief statements decided natively here), each citing the
signal ids it rests on. Whole-artifact synthesis replaces the old five
per-node calls so entries can express tensions *between* signals;
(3) validation in code: the 12-reason copy gate carries over, plus
citation safety (every cited signal id must exist) and byte-identical
enforcement of locked entries — never trusted to the model;
(4) deterministic diff-and-version with the `replaced_by` chain. A
refresh always records a version decision — "no change" is an explicit
outcome with a reason, never a silent empty generation.

`GET /api/top-of-mind` returns the acting profile's current version +
metadata. The public-profile surface re-points at the human profile's
artifact. Web: the one-surface board reads artifact + entries.

**Gate (e2e, spends Gemini):** organic flow — captures → signals →
artifact v1; edit one entry (locks it); capture more → regeneration
produces v2 where the locked entry is byte-identical, version history
shows v1→v2, unlocked stale entries retired, and every entry's cited
signal ids resolve. One artifact per profile enforced by constraint, not
convention (insert of a second live artifact fails in a test). A refresh
with no material change records an explicit no-change decision.

### Phase 6 — Groups: walls of signals, a co-edited top of mind

The group wall renders members' **shared signals** (statement,
confidence, owner attribution — never evidence). The group's top of mind
generates from members' shared signals; entries attribute contributing
members; proposals/affirmations (kept machinery) accept changes into new
versions. Human profiles only.

**Gate (two-account e2e):** account B sees A's shared signal statement on
the wall and **cannot** obtain any inspiration text of A's through any
group payload (asserted, not assumed: the test greps every group API
response for A's raw capture strings); a proposal accepted by both
produces version n+1 attributed correctly. An agent-bound session cannot
join, post to, or read walls.

### Phase 7 — MCP and skills speak the canon

waka-mcp renames in lockstep: `waka_add_inspiration`,
`waka_list_inspirations`, `waka_list_signals` (now layer 2),
`waka_get_profile` (bound profile's artifact; explicit target for the
cross-profile read the matrix allows). `waka-login` surfaces the profile
picker. `/api/health` capabilities become the post-rebuild set (this is
the sanctioned break of the "stable strings" rule — pre-launch, canon
change). Both SKILL.md files re-teach the triggers; response schemas
re-validated end to end.

**Gate:** waka-mcp's suite runs against a **live local stack** (not just
mocks) via `pnpm dev:local`: login as agent profile, capture into human
profile (`source: app`), capture into own profile, recall both layers,
read both top of minds — all green; a `waka_add_inspiration` call with an
edit attempt on the human profile's signal is denied by the server.

### Phase 8 — Demolition and the grep gate

Delete everything the Phase 0 inventory sentenced: WOW routes and
vocabulary, compatibility serializer, lens code, alias exports, parked
features' code and tables (already absent from the baseline), dead e2e
tools, stale docs sections (`README`, `AGENTS.md` vocabulary refresh,
`docs/wow-moment-algorithm.md` moved to `docs/archive/`).

**Gate (grep + suites):** grep gate returns zero hits outside the
allowlist for: `wow_`, `wowMoment`, `WowMoment`, `lens`, `meaningNode`,
`meaningEdge`, `sharedToGroups`, `shared_to_groups`, `sessionClient`,
`client: "cli"`, and the `signals`-means-captures alias pair
(`inspirations` as an alias export). Full `test:unit`, both typechecks,
web build, and `pnpm db:check` green. `progress.txt` gets the closing
entry; `Status:` flips to done.

---

## Out of scope

- Any data preservation. The wipe is the point.
- Auth-hardening items beyond the matrix + consent page (refresh
  rotation, device-code flow, keychain storage) — they layer on after.
- Reviving parked features; each returns, if it returns, as its own goal
  against the new base.
- `two-clocks` — halted at its own gate; its doc and verdict stand.

## Log

- 2026-08-15 — Goal drafted from `docs/data-model.md` (same-day canon).
  Awaiting Phase 0 owner review of the keep/park/delete inventory.
