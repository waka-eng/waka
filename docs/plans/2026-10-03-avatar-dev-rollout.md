# Avatar dev rollout

Status: complete on 2026-10-04; merged, deployed and verified in signed-in dev.
M8-A passed the [18-case quality gate](../craft/evidence/personal-capture/conversation-m8-evaluation.md).
The owner requested all remaining milestones and dev delivery, with simulators
in place of physical devices. Production and native/store packaging remain out
of scope.

## Release scope

- PR [339](https://github.com/waka-eng/waka/pull/339) merged M7/M8 to `dev` at
  `182a759`; PR [340](https://github.com/waka-eng/waka/pull/340) added the verified
  mobile scrollbar fix at `c3eca587617cdc99d0841b5e9e94ffa9805b399d`.
  M7 adds private selected-thought capture, explicit adoption and
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

## Deployment verification

Both functional releases passed PR CI and dev deployment. Final deployed code
is `c3eca587617cdc99d0841b5e9e94ffa9805b399d`; subsequent completion records do
not change the application.

| Release | PR CI | Dev deployment | Dev CI |
| --- | --- | --- | --- |
| PR 339 | [37181483052](https://github.com/waka-eng/waka/actions/runs/37181483052) | [37182065040](https://github.com/waka-eng/waka/actions/runs/37182065040) | [37182065048](https://github.com/waka-eng/waka/actions/runs/37182065048) |
| PR 340 | [37183722437](https://github.com/waka-eng/waka/actions/runs/37183722437) | [37184216228](https://github.com/waka-eng/waka/actions/runs/37184216228) | [37184216258](https://github.com/waka-eng/waka/actions/runs/37184216258) |

The deployments passed configured database-target separation, dev migrations,
and exact API/worker reply flag and model checks. Final CI passed 1,393 full
hermetic API tests and 677 web tests, with types and migrations checked. The
766-test unit pass is a subset of API coverage, not another 766 unique tests;
three paid benches remained skipped. No production deployment occurred.

## Signed in dev acceptance

Clearly labeled private QA material exercised the existing dev account. No
real Principle was edited and no test material was published. This is one
small observed journey, not a population reliability or retention measure.

| Action | Observed result |
| --- | --- |
| Send and correct | Two user messages produced two actual replies; the second honored the correction's temporary scope. |
| Follow a citation | Opened the cited current Principle and returned to the conversation. |
| Save an adopted thought | One explicitly rewritten private inspiration saved and reopened with conversation provenance. |
| Inspect Principle edit | Confirmation stayed disabled without acknowledgement; canceled without a mutation. |
| Reload and revisit | Unsent draft survived reload; a separate return tab retained four messages and one saved-source link, without duplicates. |
| Reflect on saved source | One authored QA answer received one actual follow-up; Done for now retained the reflection and its indicator. |
| Final mobile fix | Deployed chat body reported an 8px gutter, four messages and one saved-source link. |

There were three interactive live generations: two chat replies and one
reflection follow-up, with no observed failure. Ordinary source processing may
run separately; no invoice total is inferred. One private QA conversation and
one private QA inspiration with its reflection remain for owner inspection.
No real account text or screenshots were committed. Source processing showed
the legitimate daily-floor queue time; new Principles were not forced.

## Simulator acceptance

The owner approved Chrome's first-run Terms for the test emulator. Android
Chrome API 35 verified keyboard-safe entry, draft retention across app switching,
persisted conversation reopening, synthetic recording interruption, playback
before saving, and reopening the saved original. A failed earlier emulator
session and the successful hardware-GPU retry are both recorded. iOS booted
and rendered the current chat route; unchanged recording/native-share/session/
keyboard evidence is reused from the first-bundle log, not claimed as a fresh
complete iOS run.

See [the audio decision](../decisions/2026-10-02-audio-capture-spike.md) for exact
limits. Physical microphone and telephone interruption behavior remain outside
what simulators prove. Both simulators and the dedicated local fixture server
were stopped; its exact disposable schema was verified absent. The dev app
remains open for the owner.
