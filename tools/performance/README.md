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
