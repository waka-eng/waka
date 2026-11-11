# Production monitoring

Status: implementation candidate, not deployed acceptance. Production-only encrypted delivery secret and public build variables are prepared; the live site is unchanged. The accepted app
baseline is `19f8193135b66937d31867315a08a06e8959c935`. No model calls,
owner database changes or new synthetic Discord message are part of this work.

The owner chose Discord and authorized up to **US$10/month for monitoring**,
separate from AI spending. A direct, mention-free sample was accepted by Discord
at **2026-11-11 22:21:21 UTC**. That proves direct webhook delivery only. The one
test-message allowance is consumed. **Do not exercise an alarm or send another
synthetic message without a new concrete approval.** Normal incident/recovery
notifications are the purpose of the deployed service.

## Operator dashboard

Use the existing AWS console views below; there is no $3/month custom dashboard,
SaaS operations subscription, SNS hop or recurring database inspection.

| View | Inspect | Action |
| --- | --- | --- |
| [Production alarms](https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#alarmsV2:) | Filter `waka-production-`. ALARM and OK metric transitions go to Discord. | Start with the fixed alarm label and UTC time; open its metrics. |
| [Lambda functions](https://us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions) | Exact API/worker/probe/relay names from the current deployment outputs. | Errors/throttles/duration; do not invoke worker or provider jobs as a health test. |
| [CloudWatch metrics](https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#metricsV2:) | `WAKA/Operations`, `WAKA/ModelUsage`, `WAKA/QueueRecovery`; production dimensions only. | Fault codes are structured log fields. Compare failures, unpriced requests and reported cost. |
| [SQS queues](https://us-west-2.console.aws.amazon.com/sqs/v3/home?region=us-west-2#/queues) | Attachment completion DLQ and monitoring delivery-failure queue. | Inspect bounded metadata; preserve failed events until resolved. |
| [Log groups](https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:log-groups) | Relay/probe retain 14 days; existing app groups keep their existing retention. | Query fixed operational event/code fields; never copy raw app logs to Discord. |
| PostHog project | Owner-supplied public project and US/EU ingestion host, once configured. | Anonymous screen counts and coarse render/unhandled/rejection failures; no replay or memory inspection. |

Refresh on demand; the cost estimate allows 20 operator hours/month at a
five-minute refresh over 20 metrics. Do not leave a large metrics/logs dashboard
refreshing continuously. AWS console access is the independent inspection path
if Discord itself is unavailable; this is not a second notification channel.

## Detection and honest coverage

| Signal | Default | Limits |
| --- | --- | --- |
| Public web/API availability | Fixed unauthenticated GETs to `https://waka.im/` and `/api/health` every five minutes, redirect refused, 4-second HTTP deadlines, 64 KiB response limit. Two failed five-minute probe periods alert. | No WAKA/Neon/provider call; a small Dynamo operational state bounds failed API attempts. Successful liveness does not prove authenticated journeys, Neon readiness or model quality. Native probe errors avoid another custom metric. |
| Missing availability probe | Native Invocations below one for three five-minute periods; missing data breaches. Actions are armed only after a natural healthy/OK baseline. | No forced invocation, state change or setup message. Initialization failure reports the actual action state; an already armed alarm is never disabled by the initializer. |
| API handled 5xx | Production-only `WAKA/Operations Faults`, any fault in five minutes. | Closed `api_5xx` code; no route/URL/account/body/error text. 4xx and normal quota refusals do not page. |
| Worker terminal/wake/scheduling failures | Same fault series; terminal metric only after the fenced SQL update actually returns `failed`. Wake/scheduler failures and unexpected worker execution errors have fixed codes. | Expected `BackgroundJobRetryScheduled`, cadence/account-budget holds and successful stale settlements are excluded. Runtime timeout uses native Duration >=839 seconds; throttles have native coverage. |
| Lambda errors/throttles | Sum of fixed function metrics over five minutes. | Expected worker retry signals are excluded from Errors; worker terminal/execution/timeout/throttle signals cover genuine failures. |
| Attachments | Cleanup errors, storage-scope holds, or ten full existing daily cleanup batches emit a fault; completion DLQ visible count >0 alerts. | Backlog is sampled during existing work, not continuously queried. Safe quarantine can require operator binding; no orphan sweep or owner-data repair is implied. |
| Overdue jobs/exhausted leases | An explicit recovery inspection with overdue/exhausted work emits the same fixed Faults series; the historical recovery metrics remain available. | No new poll or wake of Neon. Missing samples are not proof of health. Timely silent-stall detection and recovery exercise remain open. |
| Scheduled work | Native EventBridge failed-invocation metrics for the daily worker/Principle schedules; daily maintenance completion is a production log/metric. | Native delivery failures are not proof every job completed. Absence of daily completion is an operator inspection lead, not a continuously queried DB heartbeat. |
| Providers/cost | Existing provider request/unpriced/reported-cost metrics; non-received transport/HTTP outcomes emit a fault. | Provider-reported cost is not invoiced billing; Gemini unpriced usage is expected visibility, not an automatic spend incident. This does not cap provider/AWS dollars. |
| Browser | PostHog manual screen categories and sanitized exception categories, if configured. | No raw errors/stacks, DOM, text or network payloads. Coarse grouping loses detailed root-cause diagnostics. Project receipt/alert routing remains unverified until configured. |

## Delivery, retention and recovery

CloudWatch invokes the relay directly using the documented
`lambda.alarms.cloudwatch.amazonaws.com` principal. Every permission and runtime
event must match an exact production alarm ARN, source account and region. The
relay never forwards the CloudWatch reason, arbitrary event body or stack. It
constructs a fixed friendly label, state, UTC time and AWS console link, with
`allowed_mentions.parse=[]`. Initial healthy state is suppressed. OK says “Metric back in range”; it does not claim a failed job was repaired.

The relay alone receives the encrypted Discord secret. It has only its own
leading-key-scoped DynamoDB intent-table permissions, failure-queue send permission, and normal
Lambda log/trace permissions. Probe/API/worker/cleanup/Principle runtimes never
receive the webhook. The probe has no memory/model/auth/object-store links. It can GetItem/UpdateItem only the exact `probe:availability` operational key in the existing monitoring table; the relay is limited to `event:*` and `head:waka-production-*` keys and cannot access that probe key.

The API probe commits a conservative two-hour next-attempt deadline **before**
its HTTP request. An interrupted invocation, process replacement, settlement
failure or four-second client abort cannot erase that allowance. Root/web checks
continue every five minutes. While API state is checking, unhealthy or cooling,
skipped API checks remain degraded (native Errors), never healthy. After a failed
check, one successful API sample enters recovering; a second successful sample at
least 30 minutes later restores normal cadence. A failure in between restores the
two-hour cooldown. API recovery detection can therefore lag by up to about 2.5
hours; passive real API faults remain independently monitored. This deliberately
trades rapid active recovery confirmation for bounded synthetic outage cost.
There is one non-expiring fixed probe row, no WAKA database polling and no
per-account budget/accounting framework. Probe retries are zero, EventBridge
redelivery is zero with a 60-second max event age, and its Lambda timeout/memory
remain 12 seconds/128 MB.

Before a POST, a conditional durable intent is stored and a 30-second lease is
claimed. Reserved relay concurrency is one; the table fences duplicate delivery
across invocations/replacements. A delivered head timestamp suppresses strictly older
ALARM/OK events. Distinct states with tied timestamps retain their separate intents. Successful settlement is separate from the external POST.
**A crash after Discord accepts but before durable settlement can duplicate the
message. At-least-once recovery is intended; exactly once is not claimed.**

Each invocation makes one POST with a five-second timeout. Discord 429 defers
the lease according to bounded Retry-After (60 seconds to one hour); no busy wait.
Native Lambda asynchronous delivery retries at most twice, maximum event age
one hour. Remaining failures go to a 14-day encrypted SQS queue. Pending intent
records remain for 30 days; TTL is eventual, not a promised deletion instant.
The fixed per-alarm delivered heads remain for ordering. A crash before POST,
after POST or before settlement keeps recoverable state.

If delivery fails:

1. Inspect relay error count and the delivery queue in AWS. Logs contain fixed
   `monitor_*` failure codes, never the destination or raw response body.
2. Fix the precise secret/destination/network/rate/storage issue. An expired
   lease allows the normal retained event to retry. Do not delete pending intent
   to force a duplicate or publish a new issuer/rollback around cleanup fences.
3. For a retained **async destination envelope**, validate its source, extract
   its original `requestPayload`, and invoke the relay only with the original
   allowlisted alarm event. Do not pass the whole envelope, replay unknown input,
   or invent a new state/timestamp. Use an authorized operator action, one event
   first, and retain the queue entry until delivery/settlement is established.
4. If the owner test-message budget is exhausted, do not use this procedure for
   a synthetic test. A later end-to-end failure/delivery/recovery exercise needs
   concrete approval. Discord HTTP acceptance is not human acknowledgement.

The failure-queue alarm itself can produce one failed transition, not an
unbounded recursive consumer loop: the queue has **no automatic consumer** and
an alarm acts on state changes. A broken Discord endpoint cannot notify through
itself; cloud-console inspection and a named operator remain necessary.

## PostHog privacy and configuration

Only `VITE_POSTHOG_PROJECT_TOKEN` (public `phc_` project token) and
`VITE_POSTHOG_HOST` (exact `https://us.i.posthog.com` or
`https://eu.i.posthog.com`) enable the SDK on production web. Missing/invalid
settings and native builds are disabled. No personal/admin token belongs in a
browser build. Dev receives neither production project configuration nor webhook.

The pinned `posthog-js` no-external bundle is dynamically loaded only when
configured. Local SDK config disables remote flags/config, autocapture,
pageviews/pageleave/dead/rage clicks, session replay, console/network recording,
performance collection, surveys/tours/conversations/experiments and external
script loading. Person profiles and persistent cookies/storage are disabled.
Events carry the fixed namespace `WAKA/production`; the SDK only starts on `waka.im`. Anonymous IDs are per document and rotate on logout/account change. WAKA never
identifies the real account/profile to PostHog.

The final `before_send` **rebuilds** every approved payload: only the public
project token, fresh event UUID, anonymous ID, neutral screen/error category and
required privacy flags survive. Raw URL/referrer/query, capture/chat/link text,
account IDs, names/emails, exception messages/stacks/breadcrumbs and SDK automatic
properties cannot survive. All other event types, including replay/identify,
are dropped. SDK HTTP uses origin-only referrer policy; as a third party,
PostHog still necessarily receives the network connection/IP/browser headers.
GeoIP enrichment and person-profile processing are disabled in the payload.

The app sends at most 100 events per loaded document, errors included. This is
an abuse/work bound, **not a global billing limit**. Actual outgoing SDK payloads
are tested with sensitive canaries and fake transport; no live PostHog events
were sent for those checks. Error tracking is intentionally coarse; project
receipt, project billing cap, retention and optional native Discord error-alert
integration require project/admin verification. No replay/add-on/paid plan is
enabled by this source.

## Monthly cost envelope

Prices checked against official us-west-2 AWS price-list data and product docs
on 2026-11-11. No AWS free tier or credits are subtracted. Counts below include
existing production **and development** monitoring, not only this increment.

| Item | Conservative monthly assumption | USD |
| --- | --- | ---: |
| Existing custom series | 5 model usage +4 recovery per stage, 18 total, all active all month ×$0.30. Gemini has no CostUsd series. | 5.40 |
| New custom series | Production-only Faults +DailySweeps, 2 ×$0.30. Codes are fields, not dimensions; zero new dev series. | 0.60 |
| Alarms | 9 production alarms referencing 17 billed metrics +3 existing dev alarm metrics ×$0.10. No composite/high-resolution/Insights alarms. | 2.00 |
| Logs | 1 GB total monitoring/app operational ingestion allowance ×$0.50 +1 GB-month ×$0.03. New relay/probe retention 14 days; existing app retention unchanged. | 0.53 |
| Compute and requests | Up to 8,928 five-minute probes/month at the entire 12s/128MB limit, their DB-free health calls at 2s/1GB, plus 3,000 relay attempts at 20s/128MB; request fees included, rounded up. | 0.68 |
| Operator metrics/inspection | 4,800 GetMetricData metrics ×$0.00001 +1,000 other requests; 1 GB Logs Insights scan. EMF makes zero new PutMetricData calls. | 0.07 |
| Delivery/storage/transfer | <=1,000 transitions, <=20k delivery operations plus <=27k five-minute probe Dynamo operations and <=10k SQS requests, tiny retained metadata, schedule/S3/HTTP transfer allowance. No NAT gateway, KMS key or Secrets Manager subscription. | 0.10 |
| Custom dashboard/SNS/vendor ops plan | Native console links above; no custom dashboard or SNS resource. | 0.00 |
| **Conservative AWS envelope** | Existing $5.80 baseline (custom series, dev alarms and old production DLQ) +incremental/usage allowances. | **9.38** |

The table is a conservative **normal-traffic envelope**, not a timeout stress
bound. The actual API source timeout is **60 seconds at 1024 MB**; the 30-second
function is the cleanup consumer. The table assumes this synchronous DB/network-
free health route, including cold import, completes within two seconds. A probe's
four-second HTTP abort does **not** stop or cap the server Lambda's billing. Without the durable cooldown, every five-minute health invocation consuming all
60 seconds could reach about $18.01/month. **That is not the implemented policy.**
The two-hour persisted deadline limits full-timeout failing attempts to at most
373 over 31 days, including restart/chatter tests. Conservatively add all 373
60s/1GB attempts ($0.373) on top of the table's entire normal healthy API allowance:
**$9.76/month stress envelope**, rounded up. The existing delivery/storage allowance
covers the additional small probe operations. Relay assumes up to 3,000 attempts
at its full 20s/128MB bound, HTTP5s, two native async retries/max age1h. Probe assumes
all 8,928 invocations at its full12s/128MB bound, HTTP4s, no event/async retries.
API/source timeouts and payload semantics are unchanged. Actual alerts, log volume,
other application traffic and operator queries can exceed assumptions; this is
not an AWS hard billing cap. Observe actual native API/probe duration after rollout.

Routine sparse-metric/low-traffic cost should be lower; the incremental fixed
baseline is $2.20/month (two series +16 additional alarm metrics; the existing production DLQ alarm is replaced). These are assumptions,
not an enforced cap. Additional stages/providers/dimensions, high log volume,
more console refreshes or incidents can exceed the envelope. Review actual AWS
charges after rollout; preserve signals rather than silently dropping incidents.

PostHog advertises a no-card free plan with 1M product events and 100k exceptions
per month. Main verified the supplied US project and public token in the authenticated
project UI. Billing displayed “Add your credit card to remove usage limits” and
monthly free allocations; no plan/card/billing setting was changed. This is a
verified no-card/free-usage posture, **not proof a separate per-product $0 cap was
configured**. The official free-plan limits stop usage at allowance. Replay and
paid add-ons are not enabled by this source. Production build variables are
prepared privately, but live activation still awaits candidate review. No
PostHog cost overrun is authorized by the $10 monitoring budget.

Primary references: [CloudWatch prices](https://aws.amazon.com/cloudwatch/pricing/),
[regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-west-2/index.json),
[Lambda](https://aws.amazon.com/lambda/pricing/),
[DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [SQS](https://aws.amazon.com/sqs/pricing/),
[native alarm action](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-actions-Lambda.html),
[Discord webhook](https://docs.discord.com/developers/resources/webhook),
[PostHog configuration](https://posthog.com/docs/libraries/js/config),
[analytics pricing](https://posthog.com/product-analytics/pricing),
[error pricing](https://posthog.com/error-tracking/pricing).

## Discovered daily-maintenance gap

Pinned SST3.19.3 serializes a Cron target as `JSON.stringify(args.event || {})`.
The existing daily worker Cron supplies no event, while the worker only enters
maintenance for `source:"aws.events"` and `detail-type:"Scheduled Event"`.
Consequently the current source drains ordinary jobs but does not reach the
maintenance branch. `DailySweeps` is **not verified current coverage**. A separate
minimal target-payload repair and real worker-path regression are being prepared
for review; no live activation or catch-up invocation is authorized by this note.

## Rollout and remaining gates

Review exact source/CI and sanitized SST preview before production apply. Keep
main/dev aligned through their existing exact-SHA pipelines; dev has no Discord
resources/actions and no production PostHog settings. New operational Dynamo/SQS
resources are independent of profile SQL; no schema migration or owner-memory
rewrite is required. Preserve the existing additive schema/cleanup fence on any
forward fix. To pause noisy actions, use a reviewed alarm-action configuration;
do not disable the durable issuer/cleanup consumer or remove pending deliveries.

The missing-probe alarm is created with actions disabled. A bounded initializer
(up to eight minutes of native CloudWatch reads, no SQL/model/forced probe) checks
exact function/alarm identity, recent Invocations, zero observed Errors and OK
state before enabling only that alarm. It reads actual ActionsEnabled: an unchanged
Pulumi update may leave an already armed alarm enabled. It does not assume a reset,
disable an existing alarm on failure, or claim readiness without a fresh baseline.
An unavailable baseline fails the pipeline and records actual action state.

Post-deploy `scripts/monitoring-audit.mjs` checks actual function/stack/region/
account identity, exact alarm actions/principal/source conditions, narrow inline
IAM plus recognized AWS log/trace managed policies, secret isolation, bounded
retries/concurrency, table/queue retention, native metrics and the probe schedule.
It sends **zero notifications** and cannot certify Discord or PostHog receipt.

Still open: actual deployment audit, natural probe observations, alarm-path
delivery/owner acknowledgement/recovery exercise, silent overdue/missed-work
detection without idle DB polling, actual PostHog ingestion/error-alert
configuration (project/free-usage posture is verified), and ongoing operator ownership. Attachment late-PUT/erasure,
provider privacy/spend, performance and five-person human gates remain open in
the [launch checklist](../reviews/production-launch-2026-11-11.md). This foundation
does not establish a production erasure SLA or complete beta readiness.
