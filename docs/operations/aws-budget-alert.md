# AWS account $5 monthly alert — candidate

This setup is notification-only. It neither caps spending nor stops services,
and does not change the existing eight operational alarms or AI request budgets.
It is not deployed until exact-SHA CI, sanitized infrastructure preview, Main's
review and actual acceptance have passed. Existing account inventory was checked
read-only: zero budgets, complete HTTP200 response. Do not overwrite an unrelated
budget if that inventory changes before rollout.

## Scope and ordering

`waka-aws-account-monthly-5` is MONTHLY/COST/USD5, unblended actual AWS-account
cost across all regions/stages/services, without a production/service/tag filter.
It has one ACTUAL/GREATER_THAN/100%-of-limit notification and one SNS subscriber.
Credits, discounts, refunds, tax, support, subscriptions, recurring and upfront
fees are explicitly included; blended/amortized rates are off. Direct Neon,
OpenRouter and PostHog invoices are outside AWS billing. Credits/free allowances
can make actual cost lower than the list-price monitoring model.

The start/end fields are omitted: AWS begins the current monthly period and
renews monthly, with no chosen expiry (the service's default end is 2087-06-15).
There is no forecast threshold, auto-adjusting amount or BudgetAction.

The account-global budget uses an explicit us-east-1 provider; SNS/Lambda stay
in the existing us-west-2 account. **Budget creation is last:** explicit
dependencies include the topic policy, exact-source invoke permission, confirmed
SNS Lambda subscription, configured Lambda and its async failure configuration.
An Output guard refuses PendingConfirmation/foreign subscription identities.
An already-breached monthly notice must not be published into an empty topic.

AWS billing information is refreshed at least daily; alerts are not real-time
and can arrive after further spend. Actual notifications are once per budget
period. The $5 threshold is below the modeled $9.18 monitoring envelope, so a
breach is expected if that usage is realized; this is not a shutdown target.

## Isolated delivery

New resources: one notify-only Budget, one standard SNS topic/policy, one
BudgetAlert Lambda with its Lambda-only role/log group/code artifacts, one
SNS subscription, one exact-topic Lambda invoke permission, and one bounded
async configuration. The extra Pulumi global provider is not a billed service.
No new metric, alarm, table, queue, dashboard, KMS key or schedule is added.

Topic resource policy permits only `budgets.amazonaws.com` with the exact topic,
source account and exact named budget ARN. The new function's SNS permission
is bound to that same topic/account. Existing trusted account administrators
remain subject to their IAM permissions; no application role gets SNS Publish.
The old CloudWatch handler, labels, permissions and 27-check contract stay intact.

BudgetAlert receives only the existing Discord secret and operational identifiers.
It can Get/Put/Update only `budget:*` keys in the existing monitoring table and
send failed async deliveries to the existing failure queue. It cannot access
WAKA memory, provider/auth/store credentials, or the old event/head/probe keys.
No function URL, reserved concurrency or paid provisioned capacity is configured.

The native SNS envelope must match the exact topic/account/region/type and valid
message ID/time. Raw Message/Subject/financial text/URLs are never forwarded or
logged. Ordinary notices use fixed '$5 monthly ACTUAL account threshold exceeded'
copy. Only exact Message `WAKA_BUDGET_SETUP_TEST_V1` selects fixed, clearly labeled
setup-test copy saying it is **not** a billing breach. Discord mentions are off.

SNS message ID is hashed for transport deduplication; delivery time is not used
to guess a billing month. Durable pending intent precedes a 30s token/expiry-fenced
claim, greater than the entire 20s Lambda runtime. HTTP deadline is 5s; sent is stored
only after HTTP success. Duplicates/concurrent attempts respect the durable claim.
Crashes before I/O remain recoverable; a crash after external acceptance before
settlement can duplicate a POST. No exactly-once guarantee is claimed.

429 persists a bounded 60s–1h defer without sleeping. Native async retries are 2,
max age 1h; unresolved execution failures reach the existing 14-day encrypted queue.
AWS's native failure record retains the original SNS envelope in that restricted
operational queue; the adapter never copies its financial text into Discord,
application logs or delivery-state rows. Do not export raw failure records.
Budget-only intent expires after 90 days (eventual TTL), covering native transport
and retained failure recovery. The SDK makes no hidden request retries; each
handler attempt uses at most 3 Dynamo requests. No WAKA database polling occurs.

**Pre-Lambda gap:** SNS retries managed-endpoint server failures on its native
policy, but permanent admission/permission errors can be discarded; no SNS
subscription DLQ is added. The existing queue accepts Lambda async failures via
identity policy only. Giving SNS its own queue policy would change the accepted
operational boundary and is deliberately excluded. Inspect native SNS failure
metrics/subscription/permission and the Budgets console if delivery is missing.
Discord is still a single endpoint; a broken channel cannot notify itself.

## Cost and administration preflight

Notify-only Budgets are free; there is no monthly topic/Lambda minimum or new
custom-metric/alarm charge. Without subtracting free tier, an allowance of 30
notices/month × 3 attempts, at 20s/128MB each, <=270 Dynamo requests, <=1MB logs,
small SNS/SQS/storage/transfer costs is conservatively **under $0.01/month extra**.
Normal one-per-month delivery should cost much less. The existing $2 fixed
increment stays unchanged; adding this allowance rounds the previous total
monitoring envelopes to **$9.19 normal / $9.57 stress**, not hard caps. Larger
incident/duplicate/log volumes can exceed assumptions; hosting/DB/AI are separate.

Before apply, Main must verify the **actual Actions deployment principal**, not
the local S3-only credential or Console identity, can administer the exact budget:
`budgets:ViewBudget`, `budgets:ModifyBudget`, read budget actions and resource tags
on the named budget ARN (tag write only if tags are managed). If a newer response
names a billing view, read-only `billing:GetBillingView` must prove it is the
account's unfiltered PRIMARY view. Ordinary SNS/Lambda/IAM/log deployment rights
are needed for the declared resources. No Create/ExecuteBudgetAction, SCP,
automatic shutdown or additional billing-action role is required or requested.
Missing rights must be reported precisely, not bypassed or silently expanded.

## Acceptance and test boundary

Local tests cover strict sources/privacy, setup labels, actual configured policy/
dependency expressions, concurrent/replayed notices, storage/transport/429/5xx
faults, crash ambiguity and exact real-adapter SDK request counts. Mutable memory
DB tests and live model calls are not needed.

Review actual source/permissions/cost and sanitized preview before publication.
After apply retain all old runtime 34/monitoring 27/baseline gates, plus separate
`production-budget-alert-audit.json`: actual account-wide cost types/period/USD5,
one actual 100% notification/SNS subscriber, no actions/chosen expiry/filter, confirmed
source bindings, isolated role/SDK fields, no URL/reservation, retry/retention/logs.

After Main's concrete exercise review, at most **one** SNS setup sentinel canary
may prove SNS→Lambda→Discord with a matching durable sent record. It proves that
wiring, not a real billing threshold or human acknowledgement. Do not burn money,
alter thresholds or use SetAlarmState to force a budget alert. Native Budgets→SNS
threshold receipt remains separately observed when AWS evaluates actual cost.
No webhook, provider key, raw SNS payload or owner memory belongs in evidence.

Primary references:
[Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/),
[Budgets refresh/notification behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html),
[SNS publisher policy](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html),
[cost types](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_CostTypes.html),
[Budget period defaults](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Budget.html),
[administrative actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_budgets.html),
[SNS/Lambda delivery and duplicates](https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html),
[SNS retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html),
[SNS pricing](https://aws.amazon.com/sns/pricing/).
