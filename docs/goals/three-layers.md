# Goal: three layers on a clean slate — profiles, signals, and one top of mind

Status: draft v3 — ready to run (2026-08-15). v1 drafted; v2 after
adversarial review the same day (demolition resequenced into Phase 1,
every surface sentenced, cutover phase added); v3 records the owner's
database decision: **wipe in place** on the shared instance. Phase 0's
gate is owner sign-off on the keep/park/delete inventory; nothing is
deleted before that.
Prerequisite satisfied: waka#231 (this document + the canon) merged to
`dev` on 2026-08-15, alongside waka#230 and waka-mcp#2.
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

Revised at Phase 1 execution (2026-08-15) on evidence that contradicts
the earlier assumption. The "wipe in place" decision was taken believing
the target was a dev database. It is not: `.env.development` and
`.env.production` resolve to the **same** Neon host and database
(`ep-hidden-mouse-…neon.tech / neondb`), so wiping "dev" would wipe
production. A local Postgres is running and `.env.local` already names
`localhost:5432/waka_dev`, which carried the old schema.

Therefore:

- **Phases 1–8 run against local `waka_dev`.** It is wiped and migrated
  to the baseline — that is the wipe the owner approved, on a database
  whose only content was the schema being replaced.
- **The Neon instance is not touched by this goal.** It keeps serving
  the deployed stage on the old code and old schema throughout, so
  `dev.waka.im` and any waka-mcp client stay up for the whole rebuild.
- **Phase 9 is where the shared database is decided**, and it is a real
  decision rather than a formality, because that database is production
  as well as dev. Cutover therefore halts for the owner: confirm the
  target, take a backup or a Neon branch first, then migrate and deploy.
  Nothing before Phase 9 depends on it.

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
  accepted mid-goal facts: the deployed dev stage and any waka-mcp
  client are down from Phase 1 until the Phase 9 deploy; all pre-goal
  sessions and CLI credentials die with the Phase 1 wipe.

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
   generate `0000_three_layers` as the sole migration; drop the old
   tables in local `waka_dev` and migrate it to the baseline. Rewrite
   `test/helpers/db.ts` fixtures/cleanup and
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
migrate + `pnpm db:check` clean on the wiped database; **all five checks
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
State plainly: every pre-goal session and credential already died with
the Phase 1 wipe; browser and CLI re-login against the new world.

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
against `pnpm dev:local`; enrichment rows recorded
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
real client against `pnpm dev:local`. `/api/health` capabilities become
the post-rebuild set (the sanctioned break of the stable-strings rule,
detectable by old clients). Nothing merges or deploys yet.

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

Merge `goal/three-layers` to `dev` (one PR). The database already
carries the new schema (Phase 1 wiped in place), so cutover is code
only: `sst deploy` the dev stage; run the e2e harness against the
deployed URL. Merge waka-mcp `three-layers` the same day; re-run
`waka-login` (old credentials died at Phase 1); the live-mode suite
passes against the deployed stage. `Status:` flips to done with final
numbers in `## Log`.

**Gate:** deployed e2e green; waka-mcp live suite green against the
deployed stage; a probe for `wow_moments` returns undefined-table.

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
- 2026-08-15 — v3: owner chose **wipe in place** over a scratch
  database; the database strategy, Phase 1, and Phase 9 updated
  accordingly (`dev.waka.im` accepted down from Phase 1 until the
  Phase 9 deploy). Prerequisite PRs waka#230, waka#231, and waka-mcp#2
  all merged. Ready for `/goal three-layers`.

### Phase 0 — inventory (2026-08-15), awaiting owner signature

Surface counted by enumeration, not memory: **18 routes, 20 schema
modules, 56 lib files, 15 queue/scoring/vault files, 8 web pages, 17
tools**. Every one carries a verdict below. Verdicts: **K** keep
(re-keyed/re-pointed, behavior preserved), **R** rewrite (concept
survives, implementation replaced by a named phase), **P** park (feature
leaves; code and tables removed; revivable as its own goal), **D**
delete (no return path).

**Routes (18)**

| Route | V | Note |
|---|---|---|
| `auth.ts`, `auth-google.ts` | K | `users` → `accounts`; signup/login create the human profile (P1–2) |
| `auth-cli.ts` | K | + consent page and profile picker (P2) |
| `health.ts` | K | capabilities set updated at P7 |
| `attachments.ts` | K | presign flow unchanged; enrichment both-modal (P3) |
| `inspirations.ts` | R | L1: capture/edit/delete/search, absorbs the archive (P3) |
| `signals.ts` | R | becomes L2 (P4); its archive behavior moves to `inspirations.ts` |
| `top-of-mind.ts` | R | artifact + entries + version metadata (P5) |
| `groups.ts` | K | re-keyed to profiles; wall shows shared signals (P6) |
| `feedback.ts` | K | target enum → `signal \| top_of_mind_entry` |
| `public-profiles.ts` | K | re-points at the human profile's artifact (P5) |
| `admin-background-jobs.ts` | K | trimmed to generic payload summaries |
| `guided-reflection.ts` | P | question generator only; `reflections` stays |
| `decision-memo.ts` | P | |
| `wow-moments.ts`, `wow-status.ts` | D | |
| `admin-meaning-graph.ts`, `admin-top-of-mind-preview.ts` | D | |

**Schema modules (20 → 17 + 3 new)**

| Module | V | Note |
|---|---|---|
| `client.ts` | K | |
| `index.ts` | R | barrel; **all ten alias exports die** |
| `schema.ts` | R | `users`→`accounts`; old `signals`→`inspirations`; sparks + packets + context graph out |
| *(new)* `schema-profiles.ts` | + | `profiles` (account_id, type, name) |
| *(new)* `schema-signals.ts` | + | L2 `signals` + `signal_evidence` + `signal_shares` |
| *(new)* `schema-top-of-mind.ts` | + | `top_of_minds` + `top_of_mind_entries` |
| `schema-sessions.ts` | K | + bound `profile_id` (replaces `client`) |
| `schema-cli-login-codes.ts` | K | |
| `schema-attachments.ts` | K | enrichment block extended for images |
| `schema-reflections.ts` | K | re-keyed as inspiration detail |
| `schema-embeddings.ts` | R | inspiration **and** signal vectors (P4) |
| `schema-background-jobs.ts` | K | job types rewritten |
| `schema-feedback.ts` | K | new target enum |
| `schema-groups.ts` | K | member = human profile |
| `schema-group-direction.ts` | K | co-edit machinery (P6) |
| `schema-wow-moments.ts` | D | replaced by the artifact tables |
| `schema-group-rooms.ts` | D | incl. zero-consumer `group_room_feedback` |
| `schema-activations.ts`, `schema-revisits.ts` | P | |
| `schema-combinations.ts`, `schema-member-events.ts`, `schema-reading-divergence.ts` | P | |
| `schema-documents.ts` | P | with the vault |

**Lib (56)** — K: `account-erasure` (cascade rewritten), `admin-auth`,
`auth`, `db`, `gemini-http`, `google-oauth`, `group-direction-policy`,
`group-direction`, `inspiration-embeddings`, `locales`, `member-labels`,
`middleware` (+matrix, P2), `model-provider`, `public-handles`, `queue`,
`salience` (`verifyQuote` backs P5 citation safety), `session`,
`signal-enrichment` (upgraded P3), `top-of-mind-family-lock`.
R: `feedback-application`, `gemini-model-provider`,
`group-top-of-mind{,-synthesis}` (P6), `top-of-mind-persistence`,
`top-of-mind-refresh` (P5), `top-of-mind-value`.
P: `combination-reading`, `context-node-types`, `decision-memo`,
`group-combination-reading`, `guided-reflection-question`,
`member-set-hash`, `node-dynamics`, `reading-divergence{,-gemini}`,
`room-timeline`, `signal-activation`, `signal-readings`.
D: `ambition-synthesis{,-gemini}` (superseded by whole-artifact
synthesis), `auto-wow-generation` (zero callers), `inspiration-scores`,
`meaning-candidates`, `meaning-graph-rebuild`, `meaning-graph-writer`
(keyword ontology), `meaning-packets`, `meaning-relationship-judge`,
`memory-movement` (dormancy re-implemented over `signal_evidence`),
`signal-packets`, `signals` (aliased score presentation),
`top-of-mind-dedupe`, `top-of-mind-notes` (compatibility serializer),
`top-of-mind-preview`, `wow-candidates`, `wow-generation-config`,
`wow-judge`.

**Queue / scoring / vault (15)** — `queue/gemini.ts` R (HTTP plumbing
kept; classifier prompt out, extract/synthesis clients in);
`queue/classifier.ts` + its smoke D; `scoring/board-selection.ts` K
(P6 may reuse); `scoring/wow-score.ts` D (with `inspiration-scores`);
`scoring/activation.ts`, `scoring/stability.ts` P; all seven `vault/*` P.

**Web (8)** — K: `Login`, `Onboarding`, `Profile`, `PublicProfile`
(re-pointed), `Surface` (parked views — readings, direction, rooms —
and orphaned `api.ts` exports removed). D: `MeaningGraph`,
`AdminWowStatus`, `AdminHome`.

**Tools (17)** — K: `dev-stack/boot-and-wait`, `visual-diff/*` (pairs
re-pointed). R: `seed-demo`, `demo-seed-data` (account + human profile +
agent profile + demo stack). P: `export-vault`, `reindex-vault`.
D: all five `e2e/*` (replaced by `tools/e2e/organic.ts`, P3),
`enrich-signals`, `pool-shape`, `turn-density`, `group-reading-eval`,
`verify-timeline-phase0`, and `packages/api/scripts/{pull-boards,
replay-stability}.ts`.

**Park register** (revival goal named per feature): decision-memo →
*decision-memo*; guided-reflection → *guided-reflection*;
salience/readings → *salience*; room timelines → *room-timeline*;
combinations → *combination-as-an-act*; revisits + activations →
*brain-inspired-spark-engine*; stability/node-dynamics →
*durable-interest* (halted; verdict stands); context-edge graph →
*context-graph*; vault → *vault-durability*.

**Three judgment calls flagged for the owner** (the rest follow
mechanically from the canon):

1. **Vault parked wholesale** — the capture write hook is 7 call sites
   behind an existing DI seam, but `exporter.ts`/`serialize.ts` are
   typed against six dying tables, so keeping it is a rewrite, not a
   re-point. Parking loses YAML durability/export until its own goal.
2. **`inspiration-scores` + `wow-score` deleted** — L1 stops carrying
   `importance_score`/`wow_score`, so the archive loses its
   resonance/revisited sorts (recency + text search remain). Ranking
   moves to L2 confidence/evidence, per the canon. This is the one
   deletion that visibly changes an existing surface.
3. **Admin app kept, trimmed** — undeployed, three endpoints; useful
   queue observability during this very goal. Cheap to keep, cheap to
   drop if you'd rather.

**Accepted mid-goal facts**: from Phase 1 until the Phase 9 deploy,
`dev.waka.im` and any waka-mcp client pointed at it are down, and the
deployed stage's 1-minute cron error-loops against missing tables; all
pre-goal sessions and CLI credentials die with the Phase 1 wipe.

**Gate status: PASSED — owner signed 2026-08-15**, inventory unamended.
Two addenda applied during execution, both inside the signed categories:
the `routes/*.smoke.ts` scripts (excluded from every test config, so they
never ran) went with the stale-e2e deletions, and the old
`packages/api/test/` integration suite went with the features it tested —
Phases 3–6 rebuild coverage on the new harness.

### Phase 1 — schema review (2026-08-15)

Database strategy revised at execution: `.env.development` and
`.env.production` resolve to the *same* Neon host and database, so the
approved "wipe the dev database" would have destroyed production. A local
Postgres was already running with `waka_dev` on the old schema; that is
the wipe target. `.env.local` was switched to it (backup at
`.env.local.bak-three-layers`) so the rebuild tooling cannot reach Neon.
The shared instance keeps serving the deployed stage on old code
throughout, and Phase 9 decides it deliberately.

**One concept, one table, zero aliases** (21 tables, 1 migration
`0000_three_layers.sql`, `db:check` clean):

| Canon concept | Table | Notes |
|---|---|---|
| Account (auth identity) | `accounts` | email/credentials/onboarding only |
| Profile (memory owner) | `profiles` | partial unique index = one human per account |
| Session | `sessions` | binds `profile_id`; the old client flag is gone |
| CLI login code | `cli_login_codes` | carries the chosen `profile_id` |
| Inspiration (L1) | `inspirations` | + GIN index for SQL-backed search |
| Attachment | `attachments` | enrichment block incl. `enrichment_kind`/`enrichment_text` |
| Reflection | `reflections` | L1 detail |
| Embeddings | `inspiration_embeddings`, `signal_embeddings` | match-or-mint inputs |
| Signal (L2) | `signals` | `locked_at`, `unsupported_at`, `last_evidence_at` |
| Evidence | `signal_evidence` | M:N, unique (signal, inspiration) |
| Share | `signal_shares` | the only thing that crosses into a group |
| Top of mind (L3) | `top_of_minds` | CHECK profile XOR group; partial unique = one live artifact each |
| Entry | `top_of_mind_entries` | pin/dismiss/lock are columns here, not feedback |
| Citation | `top_of_mind_entry_signals` | FK-enforced; `owner_profile_id` attributes group entries |
| Group | `groups`, `group_members` | member = human profile |
| Co-edit | `group_top_of_mind_proposals`, `group_top_of_mind_affirmations` | |
| Queue | `background_jobs` | 4 job types; partial unique debounces artifact refresh |
| Feedback | `feedback` | targets narrowed to signal \| entry |

**Gate: PASSED.** `pnpm db:generate` → exactly one baseline migration;
migrate + `db:check` clean on the wiped database; all five checks green:
api typecheck clean, **api test:unit 19 files / 218 tests**, web typecheck
clean, **web test 6 files / 56 tests**, web build ok (267.77 kB js /
121.66 kB css), admin typecheck clean, `test:dev-local-script` ok.
Diff: **328 files, +18,126 / −104,172**.

Queue conflict semantics verified against a live Postgres
(`packages/api/scripts/verify-enqueue.ts`, 4/4 as expected): first enqueue
inserts; a duplicate while pending coalesces onto the same row; a
*succeeded* row re-arms to pending with `attempts=0` and the error
cleared; the artifact refresh collapses a burst onto one job.

Three defects found by cross-checking one agent's output against another,
all fixed before the gate:
1. `enqueueDeriveSignals` keyed with `DO UPDATE SET updated_at`, so once a
   capture's job had succeeded every later edit was silently swallowed and
   the signals never re-derived — the canon's cascade rule, broken.
2. `enrich_attachment` ignored `enrichAttachment`'s return, recording a
   transport failure as a successful job, so a timed-out link was stuck
   without enrichment forever.
3. ~150 lines of signal-embedding code written by one agent and
   independently superseded by another's better approach (a signal's
   vector *is* its statement's vector) — deleted rather than left as a
   second way to do the same thing.

**Deferred to Phase 8** (residue, gates nothing): dead CSS in
`styles/global.css` and `styles/surface.css` for the parked
direction/rooms/timeline surfaces.

### Phase 2 — profiles in behavior (2026-08-15)

**Gate: PASSED.** All five checks green; **api test:unit 21 files / 258
tests** (up from 19/218 — 40 added).

The matrix is proven cell by cell in `lib/profile-access.test.ts` rather
than sampled: every (session binding × target profile × operation) pair
is asserted, including the case that catches a check comparing ids and
forgetting the tenant — same profile id, different account, refused.

`GET /api/auth/cli/start` **no longer mints anything.** It renders a
consent page; `POST /api/auth/cli/consent` is what issues the code. That
closes the drive-by hole: a session cookie is `SameSite=Lax` and is
therefore sent on exactly the top-level GET navigation an attacker can
cause, so the old shape would have handed a live 30-day credential to a
local port of the attacker's choosing with nothing shown to the person.
Lax does not send the cookie on a cross-site POST, and a human has to
press the button. Second lock: the form carries an HMAC bound to the
session, callback, and state, with a 10-minute life, so a stale tab
cannot replay a confirmation for a callback nobody saw. Tests assert the
bare GET returns 200 with no `Location` header and zero inserts, and
that forged, absent, and callback-swapped tokens all mint nothing.

Agent profiles became real: `/api/profiles` lists for either session
kind (an agent needs to know what it may reach) but only a human-profile
session may create, rename, or delete — an agent that could mint itself
memories would be administering the account rather than working inside
it. The human profile cannot be deleted at all; the delete is scoped to
agent rows in SQL, so it is not merely refused, it is not found.

The consent page was rendered and looked at in both colour schemes and
at mobile width (`scripts/render-consent-page.ts`) — it is API-rendered
HTML with no SPA behind it, so nothing in the web build would otherwise
exercise how it looks, and it is the one screen standing between a stray
navigation and a live credential.

### Phase 3 — layer 1, enrichment, and the harness (2026-08-15)

**Gate: PASSED — 8/8 steps against a live stack** (`pnpm dev:local`,
local Postgres, fixture server on 127.0.0.1:8791):

| # | Step | Result |
|---|---|---|
| 1 | stack answers as waka | PASS (3 capabilities) |
| 2 | signup creates account + human profile | PASS |
| 3 | three captures land and read back | PASS |
| 4 | **search finds a capture buried past the newest 200** | PASS (8.2s, 206 captures) |
| 5 | edit readable back, delete gone | PASS |
| 6 | **second account reaches nothing of the first** | PASS (404, empty archive) |
| 7 | **link enriched from the page body** | PASS (609 chars, body marker present, boilerplate absent) |
| 8 | **image enriched from what it depicts** | PASS (248 chars, marker transcribed) |

All five checks green; **api test:unit 22 files / 276 tests** (18 added).

Step 4 is the regression the previous archive shipped: it filtered the
newest ~200 rows in application memory, so anything older was simply
unfindable. Step 7's fixture hides its salient sentence in the page body
and puts a decoy in the `<aside>`/`<script>`/`<footer>` — the gate
asserts the body marker is present *and* the boilerplate marker absent,
so it catches both "never read the body" and "swept the chrome up as
prose".

**Image vision shipped.** `lib/image-description.ts` sends the bytes
inline to flash-lite at temperature 0 and asks for legible text
*verbatim*, because a description may be quoted back as words the person
saved and an approximation would put words in their mouth. It refuses
instructions found inside an image — an image is content, never a
request. Failures are classified: a rate limit retries, a safety block
does not. Verified against the real model
(`scripts/verify-image-description.ts`): a generated PNG reading
"SMALL TOOLS" came back transcribed verbatim.

Two blockers the harness surfaced, both fixed in the API rather than
worked around in the test:
1. The SSRF guard refused the loopback fixture unconditionally. Rather
   than a "skip the check in dev" flag — the kind that eventually ships —
   `WAKA_ENRICHMENT_ALLOWED_HOSTS` names specific hosts, is empty by
   default, and is set by nothing in the deployed configuration.
2. Images could only be finalized through S3, so an image capture needed
   an object store to exist. Recording an image **by URL** is a real
   capability (a pasted image arrives that way) and it goes through the
   same address guard a link gets; the harness uses it, so enrichment is
   exercisable against a plain local stack.

Spend this phase: ~8 flash-lite calls (1 vision verification, 1 gate
vision call, ~6 during harness development) — far inside the ≤150 line.

### Phase 4 — layer 2, signals (2026-08-15)

**Gate: PASSED — 6/6 against a live stack** (`tools/e2e/signals.ts`):

| # | Step | Result |
|---|---|---|
| 1 | stack answers as waka | PASS |
| 2 | 5 related + 2 unrelated captures land | PASS |
| 3 | **a signal cites ≥2 related captures** | PASS (2.0s, evidence=3) |
| 4 | **a different archive shares zero statements** | PASS (3 vs 3, zero identical) |
| 5 | **a locked statement survives regeneration byte for byte** | PASS |
| 6 | **deleting every citation retires an unlocked signal** | PASS |

All five checks green; api test:unit 22 files / 276 tests.

Step 4 is the canned-ontology regression made measurable. Two archives
with no shared vocabulary — one about small tools, one about a garden —
produced three statements each and zero in common. The previous middle
layer bucketed every capture into nine hardcoded English sentences, so
every archive converged on the same "insights"; that cannot happen now
without this step going red.

**Step 6 found a real bug and it was fixed rather than accommodated.**
Evidence rows vanish by foreign-key cascade when an inspiration is
deleted, but nothing re-evaluated the signals left standing on nothing —
they stayed `active` with zero support indefinitely, which is the canon's
cascade rule broken. Deletion is the one path where support disappears
without any derivation pass running, so the reconciliation is now driven
from the delete itself (`reconcileSignalsAfterEvidenceLoss`), collecting
the citing signals *before* the cascade removes the join. What happens to
a stranded signal depends on whose words it is: a generated statement is
retired, a locked one keeps its text and is marked unsupported — deleting
someone's own sentence because its footnotes went would be WAKA editing
them. First run: 5/6 with step 6 timing out at 300s "still active";
after the fix, 6/6 with the retirement landing in 0.0s.

**Consolidation:** two `cosineSimilarity` implementations existed, one
returning `null` for incomparable vectors and one returning 0. The null
form won and is now the only one — a missing embedding must not look
like a confident decision that nothing matched, because that silently
mints a duplicate signal.

Spend this phase: ~40 flash-lite/embedding calls across two gate runs —
inside the ≤150 line.

### Phase 5 — layer 3, one top of mind (2026-08-15)

**Gate: PASSED — 7/7 against a live stack** (`tools/e2e/top-of-mind.ts`):

| # | Step | Result |
|---|---|---|
| 1 | stack answers as waka | PASS |
| 2 | an archive synthesizes into a first artifact | PASS (v1, 3 entries, reason=initial) |
| 3 | **every cited signal resolves to one the profile owns** | PASS (3 citations, all resolvable) |
| 4 | **a locked entry survives regeneration byte for byte** | PASS (v2, carried verbatim) |
| 5 | **pin and dismiss round-trip and survive** | PASS |
| 6 | a refresh records an explicit decision | PASS (v3, reason=regenerated) |
| 7 | **only one artifact is live** | PASS (3 versions, exactly 1 live) |

All five checks green; **api test:unit 23 files / 291 tests** (15 added).

Step 6 passed but did not exercise the branch it was aimed at: with
nothing newly captured, synthesis still returned different wording and
the pass recorded `regenerated` rather than `no_change`. Both calls run
at temperature 0, so this is model nondeterminism, not a defect — and
the criterion ("every refresh records a decision") did hold. But
accepting either reason left the `no_change` path unproven, so it is now
proven where it is actually decided, in code: `isUnchanged` is asserted
across reworded bodies, moved citations, appearing and disappearing
entries, and dismissed entries on either side.

The same reasoning covers the two guarantees a live run can never
demonstrate, because they only matter when the model misbehaves:
`assembleEntries` reproduces a locked entry from the **stored row** even
when the model reworded it or returned nothing at all, and
`validateSynthesizedEntries` drops an invented citation rather than
writing it — a hallucinated id would otherwise fail a foreign key and
take somebody's whole regeneration down with it.

Spend this phase: ~25 flash-lite/embedding calls.

### Phase 6 — groups (2026-08-15)

**Gate: PASSED — 8/8 against a live stack** (`tools/e2e/groups.ts`):

| # | Step | Result |
|---|---|---|
| 1 | stack answers as waka | PASS |
| 2 | two archives meet in a group | PASS |
| 3 | each member shares one of their own signals | PASS |
| 4 | the wall shows statements attributed to owners | PASS (2 from 2 members) |
| 5 | **no group surface exposes another member's raw capture** | PASS (5 surfaces checked) |
| 6 | a proposal is accepted once a second member affirms | PASS |
| 7 | **a non-member cannot tell the group exists** | PASS (404, not 403) |
| 8 | **an agent-bound session cannot reach a wall** | PASS (403 at the wall and at the door) |

All five checks green; api test:unit 23 files / 291 tests.

Step 5 does not inspect a field. One capture contains a phrase nobody
would write twice, and every group surface the other member can reach is
fetched and searched for it — the boundary holds because nothing
anywhere returns it, not because the serializer everyone remembered to
check happens to omit it.

**Step 8 failed first, and the fault was the test.** It asserted the
agent gate by passing `?profile=` on a *human* session; groups ignore
that parameter and read the session's own profile type, so a 200 was
correct behavior and the assertion was meaningless. Rewritten to mint a
credential that genuinely acts as the agent profile — through the same
loopback flow waka-mcp uses, consent page and all — it now proves the
real thing, and exercises Phase 2's consent flow end to end as a side
effect.

Spend this phase: ~15 flash-lite/embedding calls. **Running total across
Phases 3–6: ~90 calls**, inside the ≤450 budgeted across the three
spending phases.

**Tenant integrity is enforced by the database, not by convention.** Seven
composite foreign keys — `(profile_id, parent_id)` against unique
constraints on `inspirations` and `signals` — make a cross-profile row
impossible in `attachments`, `reflections`, `signal_evidence` (both
parents), `signal_shares`, and both embedding tables. Two failures found
and fixed getting there: drizzle emits `CREATE UNIQUE INDEX` after FK
constraints, so composite FKs need table-level unique *constraints* as
targets; and `drizzle-kit migrate` swallows the resulting Postgres error
behind its spinner — applying the SQL through `psql` was the only way to
see it.
