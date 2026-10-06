# Local performance measurement

Run a production web build against a fresh disposable Postgres schema and
synthetic accounts. Provider network and background autodrain are disabled.
No real-account data, credentials or model inputs belong in output receipts.

```bash
DB_CONNECTION_URL=postgresql://agi@127.0.0.1:5432/waka_capture_a03_test pnpm perf:local
```

The default accounts contain 25, 250, 2,000 and 10,000 inspirations. Endpoint,
context and selection measurements use 30 samples. Output is regenerated in
ignored `work/performance/api.json`; the loopback browser fixture then remains
available at port 3017. Stop with Ctrl-C to remove only its own test schema.
Shutdown/error handlers are registered before account seeding.

Optional environment settings are `WAKA_PERFORMANCE_SIZES`,
`WAKA_PERFORMANCE_SAMPLES` (5 to 60), `WAKA_PERFORMANCE_PORT`,
`WAKA_PERFORMANCE_OUTPUT` and `WAKA_DB_POOL_MAX`. Use pool max 1 for a second
pass modeling the Lambda connection budget. This is not a deployed-cloud test.

Open `/perf/scenario?size=2000&delay=150` to choose the large fixture and add
150 ms to each API response. `/perf/results` returns issued/completed HTTP
receipts with identity/cursor values redacted. The injected browser probe
records first-document readiness, long tasks and eight seconds of frame data
in `document.documentElement.dataset.wakaPerf`. It does not measure subsequent
SPA navigation readiness; use an explicit navigation/action timing probe for
that measurement rather than reusing the initial-document timestamp.

The probe also records early Home readiness in `dataset.wakaReady` and Review
or Chat-return action timing in `dataset.wakaAction`. Use the same browser/build
mode and at least twenty interleaved samples per build for a browser p95 gate.
Adding `review=fresh` to `/perf/scenario` completes the fixture's open Review
without choosing or deleting its original, so each sample measures a fresh
start. `/perf/finish-review` is an equivalent test-only setup control. Neither
control runs a model or changes real accounts. Resumed Review is measured
separately by closing and reopening it without completing the session.

Performance/browser/paid gates are manual. This runner does not add a GitHub
workflow, schedule model requests or modify CI Browser gates.

## Search comparisons

Set `WAKA_PERFORMANCE_SEARCH_CORPUS=1` to add the bilingual/material fixture.
The 10,000-source account runs twenty query classes with repeated endpoint
timings and a complete cursor walk against known matching source ordinals.
Other accounts contain the same terms so a missing tenant predicate is visible.
The ordinary fixture remains unchanged when this flag is omitted.

For an interleaved comparison, keep the old and candidate fixture processes
on separate loopback ports, then run:

```bash
WAKA_PERFORMANCE_BASELINE_ORIGIN=http://127.0.0.1:3017 \
WAKA_PERFORMANCE_CANDIDATE_ORIGIN=http://127.0.0.1:3018 \
WAKA_PERFORMANCE_SAMPLES=30 \
pnpm tsx tools/performance/compare-search.ts
```

This command requires both fixtures to have the search corpus enabled. It
selects the 10,000-source account with zero added delay, alternates request
order, validates page membership/totals and records observed median/p95.
It rejects remote origins and keeps fixture cookies in memory, not output.

`tools/performance/compare-readers.ts` accepts the same origin/sample/output
settings and compares Chat context plus Top of Mind/Principles reads. Its
test-only `/perf/context` measures context preparation without a provider and
checks normalized fixture output; exact source hashes/order are covered by the
SQL oracle tests. Repeat with `WAKA_DB_POOL_MAX=1` to model Lambda's connection
budget. This is not a cloud latency or worker-contention measurement.

Runtime `[performance-stage]` events contain only a closed operation label,
stage, elapsed milliseconds and outcome. Queue wait excludes intended run-after
delay. Separate these stages when diagnosing waiting; never log source wording
or infer provider latency from a pending UI state alone.

## Long conversation reads

Run `pnpm tsx tools/performance/long-conversation.ts --label=current` with the
same explicit disposable loopback database. It creates 20-, 100- and 200-message
threads with repeated or varied citations, measures one read-only transaction
at pool one, and cleans its own schema before exiting. `WAKA_PERFORMANCE_SAMPLES`
sets 5 to 60 samples; the default is 20. Provider traffic is refused.

The oracle includes current/legacy inspiration proofs, earlier readings,
changed hashes and other-profile references. Output contains timing, statement
counts and normalized projection digests, not source IDs or raw account words.
`--diagnose` adds sanitized SQL plan costs and times for one warmup; it does not
write data or print query parameters. This measures projection, not HTTP/auth,
large-body delivery, cold starts or deployed latency. The temporary old-reader
snapshot used for the recorded matched comparison was removed after selection.

`--large-messages` uses maximum-length Korean placeholder messages (4,000 user
and 3,000 assistant characters). It records serialization and projected JSON
bytes, plus the actual API's thirty-message initial response. Placeholder text
is highly compressible, so these are uncompressed payload bounds, not mobile
transfer-time or realistic compression measurements. Do not time it alongside
test suites; record overlapping load separately when it occurs.

## Interactive Chat fixture

Set `WAKA_PERFORMANCE_CHAT_SCENARIO=1` to seed one synthetic conversation with
two currently valid Top of Mind references, then open `/perf/chat?size=25`
(or another seeded size). Source reopening and one-click follow-up writes use
the real owned API and durable client journals. Replies may be queued, but
autodrain and provider networking remain disabled and keys are removed. The
seeded assistant response is a known fixture, not a generated quality result.
Stop the process normally to remove only its own disposable schema.

Add `WAKA_PERFORMANCE_CHAT_HISTORY=1` alongside that flag to include an earlier
kept reading dated September 1 and a current reading dated October 1. It exercises
date disclosure and source-based continuation through the real API, without
claiming the seeded answer is model quality evidence. The history flag requires
the interactive Chat fixture and changes only its owned synthetic schema.
`WAKA_PERFORMANCE_CHAT_MESSAGES=80` adds a longer synthetic thread for built
window/scroll tests (even values 2 to 200). Ready replies and references are
seeded fixtures; no model or background drain is enabled.

## Recovery and controlled worker checks

These controls exist only in the disposable loopback fixture, not the app API:

- Add `fault=archive-tail-once`, `fault=review-read-once` or
  `fault=capture-lost-once` to `/perf/scenario`. Alternatively,
  `/perf/fault?name=<fault>` arms one failure without reloading the page.
  The archive/Review controls reject the matching read once. Capture commits
  through the real handler and then drops the response; verify a durable replay
  creates exactly one source, rather than expecting only one POST.
- `readingDelay=0..5000` on `/perf/scenario` delays only the initial reading
  endpoint, keeping early Home/Capture readiness independently measurable.
  `fault=reading-read-once` rejects that GET once; retry must remain read-only.
  `review=checkpoint` prepares one decided synthetic source in an open session
  so the saved checkpoint and its next-inspiration transition can be inspected.
- `/perf/worker?action=start`, `stop` and `status` control one bounded worker.
  Concurrent starts refuse the second request. The worker claims and completes
  a real queue job, repeatedly reads owned material/context and validates its
  revision, with no provider or source rewrite. Status reports whether it is
  active, completed iteration count and queue result. Its maximum is 120 seconds;
  stop it explicitly when the measurement is finished.
- The worker prefers the 10,000-source profile. Other synthetic profiles'
  pending jobs are deferred three minutes to keep claim selection deterministic
  after Capture/Review checks. This is fixture isolation, not production queue
  scheduling or a measurement of provider latency.
- SIGINT/SIGTERM stops the worker before closing its database and dropping
  only the schema allocated by this process. Failed startup also cleans its
  schema; an occupied port must not remove the other running fixture's schema.

For timing, inspect the DOM probe's action mode as well as its value. Wait for
the Chat mode before measuring Back, then wait for the return mode; do not reuse
an earlier action receipt. Record request volume across the full window, and
do not run the full test suite concurrently with an uncontended benchmark.
Record that extra load separately if it occurs. Fixtures changed by Capture
must report their actual source count, not just the configured summary ceiling.

## Search migration and backfill

Migration 0067 must precede deployment of an API that reads its new columns.
It adds nullable search metadata and a text-write trigger; it does not rewrite
historical rows or run a model. Missing or unsupported coverage falls back to
current text. Reverting the API optimization does not require deleting memory
or removing the additive columns. The original full-text index is retained.

`pnpm backfill:inspiration-search --help` describes explicit operator
maintenance. It loads no env file and defaults to reporting remaining rows.
For a disposable local schema, rehearse one bounded batch:

```bash
DB_CONNECTION_URL=postgresql://agi@127.0.0.1:5432/waka_capture_a03_test \
pnpm backfill:inspiration-search --apply --stage local \
  --expected-host 127.0.0.1 --schema waka_test_REPLACE_WITH_OWN_SCHEMA \
  --batch-size 250 --max-batches 1
```

Use the schema allocated for that test, not a guessed or another task's schema.
Rerun against the same verified target to resume. Busy originals are skipped;
zero updates does not imply completion when the reported remaining count is
nonzero. Repair does not change wording, material/generation revisions or jobs.
For dev, verify the actual stage database URL independently before an explicit
`--stage dev --expected-host <actual-host>` apply. Production apply is excluded.
