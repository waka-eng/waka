# Background-job follow-ups: abandoned leases, reruns, malformed extraction

Three entries in `docs/known-issues.md`. Earlier fixes were reverted because they
killed live slow workers, reset attempts so a poison job ran forever, dropped
`rerun_requested`, scanned the table on every drain, could abort a drain, spent
three billed calls on a repeated malformed answer, or never retried a malformed
answer on a provider-routed call. Each rule below says how it avoids those.

## 1. Exhausted final-attempt leases stay `running`

**Rule.** The daily scheduled run (`runScheduledSweeps`, EventBridge only) settles
a row that is `running`, has `attempts >= max_attempts`, is a supported type, and
was locked more than **24 hours** ago. Unflagged, it becomes `failed` with
`last_error = 'abandoned_lease: …'`. Flagged (`rerun_requested`), it becomes the
same fresh request `markJobFailedOrPending` already makes (see 2).
At most 100 rows per run. Wrapped in its own try/catch, like the other sweeps.

- *Live slow worker.* The Lambda worker's timeout is 14 min, and AWS caps it at
  15. In-process drains (local dev) never get the scheduled event. 24 h is about
  100× any lifetime a worker can have. A row that old has no live holder.
- *Hot path.* The scan runs only on the daily scheduled event. Enqueue wakes,
  drains and the recovery event don't run it.
- *Abort.* A failed settle is logged and swallowed. The drain still runs.
- *Poison resurrection.* An unflagged row goes terminal, and its attempts are
  never reset. Only a new request (an enqueue, which bumps `request_version`) can
  start it again, with a normal attempt budget.
- *Reruns.* A flagged row is not dropped (see 2).

## 2. L3: rerun requested on a job that then exhausts

**Already fixed on `origin/dev`** (46c74dc5). `markJobFailedOrPending` reads the
flag: a flagged row returns to `pending` with `attempts = 0` and the error
cleared. The enqueue that set the flag already bumped `request_version`, so this
is one fresh normal request for new input, not the poison attempt resurrected.
`source-job-durability.db.test.ts` ("a failed older attempt cannot strand a newer
saved revision") pins it. The one remaining hole was a crashed final attempt that
never reaches `markJobFailedOrPending`. Case 1 closes it with the same rule.
No code change. The known-issues entry is updated.

## 3. Malformed extraction payload recorded as "no candidates"

**Rule.** If a reply parses as JSON but fails `extractedStatementsSchema`,
`parseSignalCandidates` throws `MalformedModelOutputError` instead of returning
`[]`. The drain gives it **one retry per request version**:

- New nullable column `background_jobs.malformed_retry_version` (**migration 0078**,
  `ADD COLUMN`, no backfill; older builds ignore it).
- First malformed answer for version V: an ordinary retry (normal backoff), and
  `malformed_retry_version = V` is stored.
- Second malformed answer while `malformed_retry_version = request_version`:
  terminal `failed`, `last_error` prefixed `malformed_model_output`. This is
  distinct from both "derived with nothing" and a transport failure.
- *Temperature 0 vs provider routing.* At most 2 billed calls per request
  version, never the full budget of 3. A routed call still gets one retry on
  a possibly different backend.
- *`last_error` carry-over.* Nothing reads `last_error` to decide. Only the
  column decides, and it is keyed to `request_version`. A new enqueue (pending
  or terminal) bumps the version, so new input gets its own single retry. A
  different failure between two malformed answers does not change the count.
- Failures of other kinds keep the ordinary `max_attempts` budget.
