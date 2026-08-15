# Goal: three layers on a clean slate — profiles, signals, and one top of mind

Status: draft v2 — awaiting owner review (2026-08-15). v1 was adversarially
reviewed the same day; v2 resequences demolition into Phase 1, adds the
database strategy and a cutover phase, and sentences every surface v1 left
unowned. Phase 0's gate is owner sign-off on the keep/park/delete
inventory; nothing is deleted before that.
Prerequisite: the docs PR (waka#231) must be merged to `dev` before
`/goal three-layers` can start — the goal branch is cut from `dev` and
this document must exist there.
Branch: `goal/three-layers` (waka). Companion branch `three-layers` in
waka-mcp, prepared in Phase 7, merged at Phase 9.
Canon: `docs/data-model.md` — this goal implements that document and has
no model opinions of its own. If a phase discovers the canon can't express
something the product needs, the phase halts and the canon gets amended
first; the code never wins an argument with the document.
Follows: the waka-mcp contract hardening (waka#230, waka-mcp#2).
Supersedes the lens-board work from `edccb55`/`c9d3502` at the model
level. The halted storage-strength goal (`docs/goals/durable-interest.md`)
stays halted and is unaffected except that its input tables are parked
with their features.

## Why

Three forces converge on a rebuild rather than another rename-in-place:

1. **The vocabulary is inverted, and it already shipped a bug.** The table
   named `signals` stores what the canon calls inspirations; "top of mind
   notes" are physically `wow_moments` wearing a serializer; half the graph
   code answers to two names, and ten tables are exported under two
   identifiers each. The waka-mcp profile-mapping bug happened because a
   client was written against the storage vocabulary instead of the
   surface — that class of bug is a naming-debt tax, and it recurs until
   one name means one thing.

2. **The product model changed shape.** Profiles are now first-class:
   every profile (human or agent) owns a full inspiration → signal → top
   of mind stack, agents get their own memory rather than a lens over the
   human's, credentials bind to a profile, and sharing moves to the signal
   layer so raw captures never cross an account boundary.

3. **The owner has priced the alternatives.** Breaking changes are
   acceptable, there is no production data to preserve, and a wiped
   database with a clean baseline schema is *preferred* over a complex
   migration chain or compatibility shims.

## Database strategy

There is no purely local database today: `.env.local` points at a shared
remote Neon instance that also backs the deployed dev stage. Therefore:

- **Phases 1–8 run against a scratch database** — a fresh Neon
  branch/database created for this goal (or a local Postgres container).
  The goal branch's `.env.local` points at it. The shared instance and
  the deployed `dev.waka.im` stage keep running the **old** code and
  schema, untouched, for the entire goal.
- Because the deployed stage stays on the old world until Phase 9, the
  owner's daily waka-mcp usage keeps working mid-goal. There is no MCP
  outage window until cutover, and at cutover the waka-mcp update lands
  the same day.
- **The only wipe of a shared database happens in Phase 9**, after the
  owner confirms the exact connection string at execution time. Approval
  of this document is not approval of a specific `DROP`.

## Shape of the work

Ten phases, 0–9. Each lands on `goal/three-layers`, one commit per phase
minimum. Checks per `AGENTS.md`, with this goal's amendment: from Phase 1
onward the repo must be **fully green at every gate** — `pnpm --filter
@waka/api typecheck`, `pnpm --filter @waka/api test:unit`, `pnpm --filter
@waka/web typecheck` + build, `pnpm typecheck:admin` (until/unless the
admin app is deleted at Phase 0's direction), and `pnpm db:check` for
schema phases. That is only possible because demolition happens *in
Phase 1*, not at the end: after the baseline lands, every file in the
repo either compiles against the new schema or is deleted in the same
phase. The branch merges **once**, at Phase 9.

Any gate that introduces new tests must name the `vitest.unit.config.ts`
allowlist entries it added — a test absent from the allowlist looks
exactly like a passing test.

## Budget

Phases 4–6 spend Gemini calls in their e2e gates; everything else is
free. Estimates (state actuals in `## Log` per goal rules; stop if any
phase overruns its estimate by more than double):

- Phase 4 gate: ~10 captures × (1 extract + 1 embed + occasional judge)
  × a handful of runs ≈ **≤ 150 flash-lite/embedding calls**.
- Phase 5 gate: Phase 4's captures + ~2–6 artifact synthesis calls per
  run ≈ **≤ 100 calls**.
- Phase 6 gate: two accounts × Phase 4-scale captures + group synthesis
  ≈ **≤ 200 calls**.

All flash-lite / embedding tier: total well under a few dollars.

---

### Phase 0 — Canon signed; the demolition inventory

Walk the entire API + web + admin + tools surface and record, in this
goal's `## Log`, the three-column inventory: **keep** (carries into the
rebuild, re-keyed or re-pointed), **park** (feature leaves the product;
tables and code removed; may return as a future goal on the new base),
**delete** (gone, no return path).

Starting proposal, for the owner to amend at the gate:

- **Keep**: email+Google auth; attachments presign flow;
  Postgres-as-queue background jobs; Gemini HTTP plumbing and the
  **embedding machinery** (`gemini-embedding-001`); groups membership;
  the direction proposal/affirmation machinery (becomes group top-of-mind
  co-editing); **reflections** (capture-time Q&A — kept as layer-1
  detail: it is 5 endpoints in 2 route files plus read-only consumers,
  cleanly separable from the parked question-generator); the
  **background-jobs admin** route + `packages/admin` app (undeployed,
  three endpoints, useful queue observability during this very goal —
  its WOW-shaped job-detail enrichment gets trimmed to generic payload
  summaries); `tools/dev-stack/boot-and-wait.ts` (needed by every boot
  gate); `tools/visual-diff` (pairs config re-pointed later).
- **Park** (tables and code removed; one `## Log` line each naming the
  goal that would revive them): decision-memo; guided-reflection (the
  question generator — the `reflections` table itself is kept);
  salience/readings surfaces (`signal_readings`,
  `signal_reading_divergences`); room timelines + `group_member_events`;
  combinations (`combinations`, `combination_readings`); revisit events
  (`signal_revisit_events`); `signal_activations`;
  `scoring/stability.ts` + `lib/node-dynamics.ts` (dark code; parked
  with the `durable-interest` verdict); the context-edge graph
  (`context_nodes`/`context_edges`/`context_evidence`); **the vault**
  (recommended park wholesale: the capture-path write hook is 7 call
  sites behind an existing DI seam, but `exporter.ts`/`serialize.ts`
  are typed against six dying tables — re-pointing is a rewrite, and
  durability can return as its own goal; the SST `Vault` bucket stays
  declared, unused).
- **Delete**: `/api/wow-moments`, `/api/wow-status`,
  `/api/admin/meaning-graph`, `/api/admin/top-of-mind-preview`, the
  WOW→note compatibility serializer, lens boards, every alias export
  (ten tables have two names each — both vocabularies die), the
  six-cluster classification call, the keyword-bucket node ontology, the
  legacy pairwise auto-WOW path (`lib/auto-wow-generation.ts`, zero
  callers), `spreadCaptureActivation` (zero callers), the
  memory-movement event enum (test-only), the aliased `signalScores`
  fields, the `asks_for` edge kind, the sparks concept entirely
  (`signal_sparks` and all spark code), **`signal_packets`** (extraction
  reads inspirations + enrichment directly; the packet template and its
  never-read `input_fingerprint` go with it), `group_room_feedback`
  (zero consumers anywhere), the `group_rooms` family (only consumer is
  the erasure cascade), stale `tools/e2e/*` and the schema-coupled
  tools (`enrich-signals`, `pool-shape`, `turn-density`,
  `group-reading-eval`, `verify-timeline-phase0`,
  `packages/api/scripts/{pull-boards,replay-stability}.ts`), web pages
  `MeaningGraph.tsx`, `AdminWowStatus.tsx`, `AdminHome.tsx`, the
  parked-feature views inside `Surface.tsx` (readings, direction,
  rooms) and the orphaned `web/src/lib/api.ts` exports that serve them.
- Also in this phase: append a banner to `AGENTS.md` — "the
  three-layers rebuild is in progress; the vocabulary of record is
  `docs/data-model.md`, which supersedes the Product Direction
  vocabulary below" — so every later phase's executor reads the canon
  first (the full AGENTS.md rewrite happens in Phase 8). Record the
  accepted mid-goal facts: the deployed dev stage stays on the old world
  until Phase 9; all pre-goal sessions and CLI credentials die at
  cutover.

**Gate (owner):** the amended inventory is signed and recorded in
`## Log`. Fail = the model needs another pass; halt and revise the canon
instead of building.

### Phase 1 — Baseline, demolition, and the compile-or-delete sweep

One phase, three inseparable moves — sequenced together because every
later gate requires a fully green repo:

1. **The clean schema.** New Drizzle modules from the canon: `accounts`,
   `profiles` (account_id, `type: human | agent`, name; unique human per
   account), `sessions` (bound `profile_id`), `cli_login_codes`,
   `inspirations` (+ `attachments` with their enrichment block,
   `reflections` re-keyed as inspiration detail), `inspiration_embeddings`
   and `signal_embeddings` (Phase 4's match-or-mint reads persisted
   vectors), `signals` + `signal_evidence` (M:N; lock state; confidence)
   + `signal_shares` (per-signal, per-group), `top_of_minds` (one live
   artifact per profile and per group; version chain) +
   `top_of_mind_entries` (typed, lockable, pinnable, dismissible —
   pin/dismiss/lock are **entry columns**, not feedback rows),
   `groups` + `group_members` (member = human profile), the group
   co-edit tables (ported direction machinery), `background_jobs`,
   `feedback` with the new target enum (`signal | top_of_mind_entry`
   only — value reactions that feed regeneration). Nothing parked
   appears in the baseline.
2. **The baseline reset.** Delete `drizzle/migrations/*` + `meta/`;
   generate `0000_three_layers` as the sole migration; migrate onto the
   scratch database. Rewrite `test/helpers/db.ts` fixtures/cleanup and
   `migrations.test.ts` (it currently pins old migration filenames) for
   the single-baseline world. Rewrite `tools/seed-demo.ts` +
   `demo-seed-data.ts` to create an account, its human profile, one
   agent profile, and a small demo stack.
3. **Compile or delete.** Execute the signed inventory: delete sentenced
   routes, libs, queue paths, schema modules, tests, tools, and web
   pages; mechanically re-point every kept file (auth → `accounts`, with
   signup/login creating the human profile and binding the session to
   it; groups → profile keys; erasure cascade → the new table set; the
   background-jobs admin route trimmed to generic payload summaries).
   Prune `vitest.unit.config.ts` to the surviving tests and fold in the
   13 files that were silently outside the allowlist. Update
   `scripts/dev-local.sh` (drop the WOW-status env assertion) and
   `test/sst-config-env.test.ts` to match. `web/src/lib/api.ts` loses
   its dead exports; the router loses the dead pages.

**Gate:** `pnpm db:generate` yields exactly one baseline migration;
migrate + `pnpm db:check` clean on the scratch DB; **all five checks
green** (api typecheck, api test:unit, web typecheck+build, admin
typecheck); `pnpm test:dev-local-script` passes; a schema-review table in
`## Log` maps every canon concept to exactly one table name with zero
aliases. Any concept that wouldn't fit without a hack is a
halt-and-amend-canon, not a workaround.

### Phase 2 — Profiles in behavior: matrix, consent, picker

Signup/login flows finalize account + human-profile creation; agent
profiles become creatable (product: one). The CLI loopback flow gains the
**consent page with a profile picker** — an API-rendered HTML step (no
SPA dependency), which also closes the SameSite=Lax drive-by minting
hole — and the exchanged session binds the chosen `profile_id`.
Authorization middleware enforces the canon's matrix: human-profile
sessions are account admins; agent-bound sessions get full access to
their own profile, read + capture on the human profile, nothing else.
State plainly: all sessions minted before this phase are invalid;
browser and CLI re-login (the deployed stage is unaffected until
Phase 9).

**Gate:** an authorization test suite proves the matrix — for each
(session binding × target profile × operation class) cell a test asserts
allow/deny; the drive-by case (top-level GET to `/start` without consent
interaction) mints nothing; all five checks green.

### Phase 3 — Layer 1: inspirations, enrichment, and the new e2e harness

Capture (`POST /api/inspirations`), **edit and delete**, archive/recall
(`GET /api/inspirations`, absorbing the old signals-archive behavior)
with **SQL-backed search** replacing the in-memory newest-200 filter.
Provenance per the canon's two-fact rule. Reflections ride at capture
(≤3) and via their endpoints. Attachment enrichment becomes both-modal:
links get the bounded deterministic fetch upgraded to bounded page text
(with SSRF hygiene: refuse private-range and metadata-endpoint targets);
images get a one-time vision description (flash-lite, cached on the
attachment, transcribing legible text verbatim). Web: capture + archive
surfaces on the new routes.

This phase also **builds the instrument later gates depend on**: a new
`tools/e2e/organic.ts` (modeled on the old smoke's capture round-trip,
minus the cluster poll) plus a tiny local fixture server serving (a) a
page whose salient content exists only in its body and (b) a test image
with embedded text — so enrichment gates are deterministic, not
network-flaky. Boot via the kept `boot-and-wait`.

**Gate:** CRUD + search API tests green (search finds a seeded match
beyond the newest 200); cross-profile tenant-isolation negative tests;
the e2e harness completes a signup → capture → archive round-trip
against `pnpm dev:local` on the scratch DB; enrichment rows recorded
`ready` for the fixture link (body text present) and fixture image
(transcription present); all five checks green.

### Phase 4 — Layer 2: signals

The generator, per new or edited inspiration (background job):

1. **Extract** — one flash-lite call producing 0–3 candidate signal
   statements in the user's own language, grounded in cited spans of the
   text and its attachment enrichment.
2. **Embed** the inspiration and each candidate (`gemini-embedding-001`).
3. **Match or mint** — deterministic: above a high cosine threshold
   against existing signals, attach as evidence; in an ambiguous band,
   one merge-judge call; below, mint `emerging`. Thresholds tuned here.
4. **Lifecycle, pure code** — confidence from evidence count, time
   spread, source diversity; `emerging` promotes at ≥3 evidence; the
   cascade rule (edit re-derives; delete drops evidence links and
   retires unsupported **unlocked** signals; locked ones survive marked
   unsupported); locks absolute.

Curation endpoints: edit statement (locks), hide, delete. Per-signal
per-group sharing. `GET /api/signals` now means layer 2.

**Gate (e2e, spends Gemini — see Budget):** on a fresh profile, capture
5 related + 2 unrelated organic inspirations (one related capture is the
fixture image, one the fixture body-only link); **within 5 minutes of
the queue drain**, ≥1 signal cites ≥2 related inspirations as evidence,
including evidence via enrichment; two profiles seeded with different
content produce zero identical statements (the canned-ontology
regression test). Cascade and lock tests as specified (locked statement
byte-equal across regeneration). All five checks green; new tests named
in the allowlist.

### Phase 5 — Layer 3: one top of mind per profile

Refresh is cooldown-debounced after signal changes (plus manual). The
generator: (1) deterministic selection of the top K signals —
confidence, evidence count, reinforcement recency, and a
dormancy-comeback bonus **re-implemented over `signal_evidence`
timestamps** (its old inputs are parked); (2) **one** synthesis call for
the whole artifact — current version with locked entries marked
immutable, selected signals, recent feedback in; next version out,
entries typed (`pattern | tension | question | hypothesis | action`,
belief statements decided natively), each citing signal ids;
(3) validation in code: the 12-reason copy gate, citation safety (every
cited id exists), byte-identical enforcement of locked entries;
(4) deterministic diff-and-version with the `replaced_by` chain. Every
refresh records a version decision — "no change" is an explicit outcome
with a reason. Entry pin / dismiss / lock endpoints ship here as entry
state. `GET /api/top-of-mind` returns the acting profile's current
version + metadata; the public-profile surface re-points at the human
profile's artifact; the one-surface board reads artifact + entries.

**Gate (e2e, spends Gemini):** organic flow — captures → signals →
artifact v1; edit one entry (locks); capture more → v2 with the locked
entry byte-identical, version chain v1→v2, unlocked stale entries
retired, every cited signal id resolving; pin and dismiss round-trip
through their endpoints and survive a regeneration; one live artifact
per profile enforced by constraint (second insert fails in a test); a
no-change refresh records its explicit decision. All five checks green.

### Phase 6 — Groups: walls of signals, a co-edited top of mind

The group wall renders members' **shared signals** (statement,
confidence, owner attribution — never evidence). The group's top of mind
generates from members' shared signals; entries attribute contributing
members; proposals/affirmations accept changes into new versions. Human
profiles only.

**Gate (two-account e2e, spends Gemini):** account B sees A's shared
signal statement and **cannot** obtain any inspiration text of A's
through any group payload (the test greps every group API response for
A's raw capture strings); a proposal accepted by both produces version
n+1 attributed correctly; an agent-bound session cannot join, post to,
or read walls. All five checks green.

### Phase 7 — MCP and skills speak the canon

On waka-mcp branch `three-layers`: rename tools in lockstep
(`waka_add_inspiration`, `waka_list_inspirations`, `waka_list_signals`
= layer 2, `waka_get_profile` = the bound profile's artifact, explicit
target for the permitted cross-profile read); `waka-login` surfaces the
profile picker; response schemas re-validated; both SKILL.md files
re-taught. **Build the live-stack test mode this phase's gate needs**
(today's suite is fully fetch-mocked): a vitest project that runs the
real client against `pnpm dev:local` + scratch DB. `/api/health`
capabilities become the post-rebuild set (the sanctioned break of the
stable-strings rule, detectable by old clients). Nothing merges or
deploys yet — the owner's daily MCP keeps working against the deployed
old stage until Phase 9.

**Gate:** the live-mode suite passes end to end — login as agent
profile, capture into human profile (`source: "app"`), capture into own
profile, recall both layers, read both top of minds — and a
signal-edit attempt against the human profile from the agent session is
denied by the server. Mocked suite + typecheck green on the waka-mcp
branch.

### Phase 8 — The sweep

The residue pass (bulk demolition already happened in Phase 1): full
`AGENTS.md` rewrite to the canon vocabulary (banner removed); README
runbook refresh; archive superseded docs (`docs/wow-moment-algorithm.md`,
`HANDOFF.md`, the group-top-of-mind pair and any doc describing deleted
machinery → `docs/archive/`); `drizzle.config.ts` header comment;
`progress.txt` closing entry.

**Gate (grep + suites):** the grep gate runs over `packages/**`,
`tools/**`, `scripts/**` only (docs are handled by the archive list
above; allowlist `docs/archive/**`, `docs/data-model.md`,
`docs/goals/**`, `index.html`, `progress.txt`). Zero hits for both
vocabularies of every dead concept: `wow_`, `wowMoment`, `WowMoment`,
`top_of_mind_note` (the old table; the new ones are `top_of_minds` /
`top_of_mind_entries`), `contextNode`, `context_node`, `contextEdge`,
`context_edge`, `meaningNode`, `meaningEdge`, `meaningPacket`,
`signalPacket`, `signal_packets`, `spark`, `Spark`, `lens`,
`sharedToGroups`, `shared_to_groups`, `sessionClient`, `client: "cli"`,
and the `inspirations`-as-alias export. All five checks green plus
`pnpm db:check`.

### Phase 9 — Cutover

Merge `goal/three-layers` to `dev` (one PR). Owner confirms the exact
connection string of the deployed stage's database; wipe + baseline
migrate. `sst deploy` the dev stage; run the e2e harness against the
deployed URL. Merge waka-mcp `three-layers` the same day; re-run
`waka-login` (old credentials are dead by design); the live-mode suite
passes against the deployed stage. `Status:` flips to done with final
numbers in `## Log`.

**Gate:** deployed e2e green; waka-mcp live suite green against the
deployed stage; the old stage's schema is gone (a probe for
`wow_moments` returns undefined-table).

---

## Out of scope

- Any data preservation. The wipe is the point.
- Auth-hardening beyond the matrix + consent page (refresh rotation,
  device-code flow, keychain storage) — they layer on after.
- Reviving parked features; each returns, if it returns, as its own goal
  against the new base.
- The `durable-interest` verdict — it stands.

## Log

- 2026-08-15 — Goal drafted from `docs/data-model.md` (same-day canon).
- 2026-08-15 — v2 after adversarial review + full blast-radius mapping:
  demolition resequenced into Phase 1 (compile-or-delete); database
  strategy added (scratch DB for phases 1–8; deployed stage untouched
  until cutover, which also removes the mid-goal MCP outage); Phase 9
  cutover added; reflections kept, vault parked (recommendation),
  admin app kept trimmed, `signal_packets` and `group_rooms` sentenced;
  embeddings tables added to the baseline; feedback target enum fixed;
  pin/dismiss made entry state; grep gate scoped to code and both alias
  vocabularies; e2e harness + fixture server made explicit Phase 3
  scope; waka-mcp live-mode suite made explicit Phase 7 scope; budget
  section added. Awaiting Phase 0 owner review.
