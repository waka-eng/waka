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

Performance/browser/paid gates are manual. This runner does not add a GitHub
workflow, schedule model requests or modify CI Browser gates.
