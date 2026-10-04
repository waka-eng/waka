# Avatar dev rollout

Status: prepared on 2026-10-03; merge, deployment and signed-in acceptance are
not yet complete. M8-A passed the [18-case quality gate](../craft/evidence/personal-capture/conversation-m8-evaluation.md).
The owner requested all remaining milestones and dev delivery, with simulators
in place of physical devices. Production and native/store packaging remain out
of scope.

## Release scope

- Branch `codex/conversation-thoughts` targets `dev`, currently based on M6 merge
  `5c9f230`. M7 adds private selected-thought capture, explicit adoption and
  provenance, corrections, and version-safe confirmed Principle edits.
- Migrations 0063 and 0064 add provenance and correction references. They do
  not rewrite existing inspirations or Principles. Chat deletion clears the
  source link of deliberately saved inspirations; it does not erase them.
- Dev API and worker both enable replies and use `google/gemini-3.8-flash`
  through OpenRouter, with low reasoning and the existing 1,200-token request
  cap, three attempts per message/hour and twenty dispatches per account/hour.
  Other generation models stay unchanged; production chat remains disabled.
- The deploy workflow must pass configured database-target separation, migrate
  using the dev secret, then synchronize the runtime to that same target.
  Local env filenames are not authoritative and must not drive remote writes.
- Post-deploy validation reads only the enablement/model fields of the exact
  API and worker function names exported by SST; it never prints their secrets.

## Recovery

To stop new reply dispatches, run the existing Deploy dev workflow manually
with `enable_conversation_replies=false`. It sets the shared API/worker flag to
0 and retains stored messages, budgets and schema. Existing in-flight Lambda
work may finish; the switch is not a provider refund or immediate cancellation
guarantee. The per-conversation Stop reply action remains a publication fence.

Do not drop the new tables/columns or roll migrations back destructively. Use
a forward repair for persistence faults. Any old-code rollback must preserve
the additive schema and first be checked against newly written rows. A schema
restore or production change needs a separate decision. Release-evidence,
goal, plan and progress-only commits do not trigger cloud redeployment;
application/configuration changes still deploy automatically.

## Acceptance still to record

Record the PR, merged SHA, CI and deployment runs, migration/preflight results,
and the API/worker configuration checks. Use the existing signed-in dev session
with clearly labeled private QA text. Do not alter existing Principles or make
test material public. Do not copy real account text into committed evidence.

Verify a new conversation, actual reply and current citation, correction and
next reply, explicit thought save, original opening, reload/Back and a second
visit. Inspect the separate Principle edit confirmation without changing an
existing real Principle; the real mutation/conflict/history cases are verified
on the disposable local database. Collect content-free attempt, success,
failure and reopen counts with the small sample size stated. Existing capture,
review and share evidence remains in the earlier rollout record.

The iOS simulator booted and rendered the current conversation route; its
recording/native-share/keyboard evidence is retained in the first-bundle log.
The read-only Android emulator booted, but a new Chrome run is waiting on the
owner's first-run Terms approval. Do not accept those terms or claim new
Android interaction checks without that decision. Physical microphone and
telephone interruption behavior remain outside what a simulator can prove.
