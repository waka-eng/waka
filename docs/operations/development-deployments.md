# Development deployment safety

Changes normally arrive through a PR targeting `dev`, after required checks and
Main review. A merge starts the existing automatic development pipeline. `main`
and production require a new explicit owner instruction; a historical release
approval does not apply to a later change.

The deployment lane uses `deploy-dev` concurrency without cancelling an active
run. The CI caller and deployment checkout use the same immutable event SHA;
failed/cancelled/skipped checks refuse the whole mutation job. GitHub may replace
a pending run with a newer pending run; this is not a promise to deploy every
intermediate commit or to execute dispatches in strict FIFO order.

The `verify_only` lane remains separate (`verify-dev`) and supersedable. Its
existing default read-only checks and explicit actionless-alarm exercise controls
are unchanged. It cannot enter the deployment job or clear a stage lock.

## If a deployment stops or reports a lock

1. Keep the failed/cancelled run and its exact SHA, step and timestamps. Do not
   immediately retry or start a second mutation path.
2. Inspect Actions for any running/queued development operation, including an
   operator's local SST process if one exists. An Actions concurrency group does
   not serialize an independently started local process.
3. A named operator with existing authorized metadata access must verify the
   exact `development` stage, latest update/lock owner and completion state.
   Do not infer abandonment merely from a workflow failure or elapsed time.
4. If the update is active or ownership is uncertain, leave the lock in place.
   Escalate the concrete state and safe metadata to Main/operator review.
5. A confirmed abandoned lock needs a separately reviewed, scoped recovery
   action by the authorized operator. This runbook creates no new unlock
   permission, manual workflow or automatic recovery authority. Preserve state
   and investigate the failed operation before choosing a retry/forward repair.

The pipeline deliberately has no automatic `sst unlock`. Secrets, migration and
SST failures remain failures. Never delete state, reset a database, disable a
check, or clear a lock simply to obtain a green run. Production recovery is a
separate scope. Retain sanitized phase/operation/check names; do not publish raw
state, environment values or provider bodies.

[GitHub concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
explain the running/pending distinction. Local workflow tests execute the actual
parsed expressions and pin the no-unlock, exact-SHA and CI-success boundaries;
they do not simulate or exercise an interruption of a live AWS deployment.
