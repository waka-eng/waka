# Recover one failed conversation reply

The operator command previews one failed reply by default. It prints eligibility
and queueing status without returning messages, identifiers or raw errors. Use
the separately verified stage connection as `DB_CONNECTION_URL` and provide
its independently recorded SHA-256. The command reads no dotenv file.

```sh
pnpm exec tsx tools/ops/redrive-conversation-reply.ts \
  --db-sha256 "$VERIFIED_DATABASE_SHA256" --account "$ACCOUNT_ID" \
  --profile "$PROFILE_ID" --job "$JOB_ID" --reply-request "$REPLY_REQUEST_ID" \
  --request-version "$REQUEST_VERSION"
```

Apply only after confirming the exact stage and receiving approval for that job.
Use the same command with `--apply`. It rechecks under locks and grants one
additional normal claim. The original three attempts, last error and request
identity are retained. The tool makes no provider calls and sends no wake.
The normal worker and its budgets still control execution. Use the existing
bounded stage recovery operation if the job needs a wake.

Only a current human-owned reply that failed on serialization, deadlock or lock
contention is supported. Both durable provider dispatch timestamps must be
empty. A stopped, stale, published or ambiguous reply and any other job type
require their existing recovery path. If apply is unconfirmed, reconcile the
job's status and attempt limit before any further operation. A row with the
extra attempt already granted cannot get another grant through this command.
