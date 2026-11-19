# Production readiness and recovery

The latest recorded production reading update is PR 502 on November 18, 2026.
The same 11-file change passed dev first in PR 501. The production deploy
verified the expected runtime, monitoring and budget configuration, five public
checks, and the existing S3 recovery controls. Review the exact current commit
and deploy receipt before using this record to authorize a later release.
[Dev deploy](https://github.com/waka-eng/waka/actions/runs/44314963726) ·
[Production deploy](https://github.com/waka-eng/waka/actions/runs/44320930483)

## Release controls

- Release through reviewed PRs and the ordinary exact-commit CI and deployment
  workflows. Promote the reviewed change from dev and preserve production's
  MCP namespace, signup, and version-aware erasure settings. Keep database
  targets, auth secrets, and SST stage namespaces distinct.
- The production workflow checks out the successful CI commit and restricts the
  deployment job to `main`. A production preview using this workflow also
  runs from `main`. A preview of branch code needs its own read-only identity
  and workflow before any production access is granted.
- A repository admin must enforce these boundaries on GitHub. Under
  **Settings → Rules → Rulesets**, make an active branch ruleset targeting only
  `main`. Require PRs, one independent approval, dismissal of stale approvals,
  and the exact required GitHub Actions check
  `Typecheck, unit tests, migrations`. Require the branch to be up to date,
  prevent deletion and force pushes, and leave the bypass list empty for routine
  release actors. Confirm the check source from a real passing PR before
  enabling the rule. Keep an active reviewer independent of the author.
  [GitHub branch rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- Under **Settings → Environments → production**, select the exact allowed
  branch `main`, with no tag matches. Require an independent production
  reviewer, enable prevention of self-review, and disable admin bypass. Verify
  rules and deployment gates by reading them back and observing the next
  authorized release. An in-workflow ref check does not establish GitHub-level
  enforcement. [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- Deployment values are scoped to the runner steps that use them. Actions use
  immutable commits, checkout does not persist a token, and SST secret setup
  accepts values on stdin. The existing release AWS access key remains pending
  an OIDC cutover. Runtime, data and provider credentials are still sensitive
  within each step that consumes them.

### AWS deployment identity cutover

1. Inventory the exact approved release actions by stage, including SST state
   and assets, Lambda, scoped IAM and PassRole, Route53, deployment audits and
   production monitoring resources. Reuse the existing AWS account and OIDC
   provider for `token.actions.githubusercontent.com`. Keep the private
   monitoring-only role and the local CLI identity separate.
2. Create separate deployment roles for dev and production with policies
   scoped to their resources. Production trust uses
   `aud=sts.amazonaws.com` and an exact
   `sub=repo:waka-eng/waka:environment:production`. Bind that environment to
   `main` with the protection above. Dev needs its own environment restricted
   to `dev` and an exact corresponding subject. Grant only necessary actions
   to each role. Review IAM role creation and PassRole separately from app
   resource access. Avoid wildcard repository or environment trust.
3. Put `id-token: write` on the intended release job alone, use a pinned AWS
   credential action and an environment-specific role ARN, and verify the
   assumed account and role before any mutation. Keep manual read-only
   monitoring separate. Plan the first real deploy with temporary rollback
   access to the existing credential and a confirmed owner. Verify a
   permitted branch and denied off-branch role assumption before retiring and
   then removing the static AWS access key and GitHub secrets.
   [GitHub OIDC with AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)

## Signup and access

Production signup runs in explicit `off` mode. An unconfigured or invalid
production deployment closes new signup. Both password and Google share
50 account creation starts per rolling hour, with no daily cap in this mode.
Returning sign-ins do not use the new-account allowance. The normal workflow
uses the default in `packages/api/src/lib/signup-admission.ts`; the API can
accept a smaller `WAKA_SIGNUP_CREATE_HOUR` when explicitly supplied. Capacity
from a failed or uncertain creation is not automatically returned. This
limits aggregate creation and is unrelated to provider spend. Any per-source
protection must use an ingress identity whose trust is established. Never
infer source identity from arbitrary forwarded headers.

The retained Turnstile mode is an explicit alternative with an API-only
same-stage binding, signed grants, and separate verification quotas. Native
configured signup opens the approved website and returns to ordinary native
sign-in. Turning it on is a product and operational change. Verify real
password signup and Google first-time signup separately when changing modes.
The owner confirmed signup worked on November 18.

For Google sign-in, verify the public `waka.im` property in Search Console
under a Google account that owns the OAuth project and check the resulting
status in Google Auth Platform. Keep the product description, Google
account-data use explanation, and English Terms and Privacy links publicly
reachable before sign-in. Check both the OAuth web and native redirect
bindings after changing projects or ownership. Verify this separately from
successful sign-in on a test account.

The Google recovery transaction revokes the inherited password, sessions,
codes, and profile keys when a verified Google identity reclaims an
unverified password account. When testing a change, verify access
revocation and that inherited public visibility is private. Preserve owned
memory and keep other accounts untouched. Support must establish ownership
independently before intervening. Never accept credentials by email. Use
team@waka.im for user requests and restrict credential recovery and erasure
to their reviewed workflows.

## Provider costs and privacy

Production and dev use the shared task profile. OpenAI Responses handles
Terra text and supported vision, and Sol synthesizes readings. OpenRouter
handles Embedding2, Gemini 2.5 Flash audio, Gemini 3.1 Flash Lite HEIC/HEIF
description, and the DeepSeek GIF exception. Historical Embedding 001 data
does not establish a serving path. An unavailable Embedding2 space must not
be substituted with the old model. [Model routing](model-routing.md)

The owner chose a combined `$10/month` dev plus production AI spending
target with alerts and existing quotas. Monitor OpenAI project and OpenRouter
account/key spend, using provider invoices for the combined total. The AWS
account budget covers infrastructure separately. Establish the actual alert
recipient and observe delivery. Project alerts and per-key credit limits
have their own scope. Production temporarily uses the approved shared OpenAI
development key. Replace it with an independently scoped production key once
that key is ready. Read back the runtime binding, verify one bounded approved
inference, and revoke the previous key only after confirming other consumers
can continue.

Keep OpenRouter collection and ZDR choices stage-specific. OpenAI
`store:false` describes application state, and provider abuse-monitoring
retention depends on the actual account and endpoint. Reverify routing and
retention when changing a provider or settings. Keep policy text aligned
with use of inspirations, readings, searches, attachments and recordings.

## Monitoring and incident handling

- Public liveness checks the website shell and shallow API health. November
  18 delivery testing recorded one production alarm delivered through the
  relay and Discord, then recovery to OK. Migrations and the release
  comparison provide separate evidence of the configured database target.
- A launch pilot checks real sign-in, save, processing completion, a useful
  reading, and attachment handling. Check elapsed time and a normal empty
  reading. Treat a stuck job, authorization failure, or missing output as
  separate from an unavailable website. Use synthetic records and bounded
  paid calls where the operator has approved them.
- CloudWatch app log retention is 30 days. Only read narrowly scoped,
  necessary logs. Exclude memory text, SQL parameters, tokens, cookies, keys,
  and raw provider responses from logs and support artifacts. For a suspected
  historic logging incident, preserve restricted evidence and escalate
  before changing retention or deleting logs. An account erasure does not
  erase CloudWatch history.
- Diagnose failures with the exact check, commit, resource, time and safe
  error category. Give an incident one operator. For uncertain outcomes,
  reconcile state before restarting the action. Treat retry of completed
  provider work as a fresh authorization decision.

## Database and object recovery

On November 18 the production Neon endpoint was matched to its branch in
AWS us-east-1 and a 24-hour history window. The restore exercise recovered a
synthetic row from an isolated historical branch and an attachment version
whose bytes matched its recorded SHA-256. It did not measure a production
recovery time or acceptable data loss. Keep that short window in mind when
triaging an incident.

Attachments and the retired Vault are private S3 buckets in us-west-2.
Versioning is enabled. Noncurrent versions become eligible for expiry after
one day and empty delete markers are cleaned up. AWS applies these lifecycle
rules asynchronously. Current objects have no expiry from these rules. The
30-day deleted-save shelf is a separate database product feature. Current
SST bucket definitions leave these recovery settings unmanaged. Read back
versioning, lifecycle and attachment notifications after any bucket or
provider update.

1. Identify a recovery point within the available window. Restore Neon to
   an isolated branch first. Reconcile subsequent writes, erasures and
   credential revocations before selecting anything to move back.
2. For objects, verify the private key and owner, require exact key equality
   on version listing, read the version by ID and verify expected bytes.
   Keep bucket notification and version-aware attachment erasure wired.
   Erasure purges exact-key versions and existing events handle late uploads.
   Retired Vault erasure requires a verified ownership and storage scope.
3. Preserve source, ownership and migration evidence. Treat in-place restore,
   object promotion and production data repair as separate incident actions
   requiring approval. Roll back code only where the previous runtime is
   compatible with the forward migration. Never restore erased data as a
   side effect of service recovery.

[Neon branch recovery](https://neon.com/docs/manage/branches) ·
[S3 object version listing](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)

## Legacy attachment inventory check

Run only against the independently verified production database target, with
a read-only operator, a bounded connection and the actual region/bucket scope.
The result contains counts only. The exact `storage_scope` below matches
the production bucket and AWS region with no custom endpoint. Confirm it
before running. This includes the deleted-save shelf and pending sweeper
inventory. It returns no object keys, profile IDs or account IDs.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
WITH refs AS (
  SELECT profile_id, s3_key AS key FROM attachments
  WHERE s3_key IS NOT NULL AND s3_key <> ''
  UNION
  SELECT d.profile_id, item ->> 's3Key'
  FROM deleted_inspirations AS d
  CROSS JOIN LATERAL jsonb_array_elements(d.attachments) AS a(item)
  WHERE item ->> 's3Key' <> ''
), gaps AS (
  SELECT p.account_id, r.key
  FROM refs AS r
  JOIN profiles AS p ON p.id = r.profile_id
  LEFT JOIN attachment_objects AS o
    ON o.key_hash = encode(sha256(convert_to(r.key, 'UTF8')), 'hex')
  WHERE o.storage_scope IS DISTINCT FROM
    '{"bucket":"waka-production-attachmentsbucket-rceuztkc","region":"us-west-2","endpoint":null}'
)
SELECT count(DISTINCT account_id) AS affected_accounts,
       count(DISTINCT key) AS unverified_referenced_keys,
       (SELECT count(*) FROM attachment_objects
        WHERE due_at IS NOT NULL AND key IS NOT NULL
          AND storage_scope IS DISTINCT FROM
            '{"bucket":"waka-production-attachmentsbucket-rceuztkc","region":"us-west-2","endpoint":null}'
       ) AS unverified_pending_keys
FROM gaps;
ROLLBACK;
```

If any count is nonzero, verify historical bucket provenance before backfilling
scope or deleting bytes. Recheck current references and hold ambiguous keys.
Test account erasure with both a bound legacy fixture and a foreign or
unverified object before applying a bounded audited repair. Never fill missing
scope with the runtime default alone.

## Native distribution

A development-signed build can expire and may omit Associated Domains.
Before distributing WAKA for iPhone, use the real distribution team and
capabilities, then test sign-in, app links, media permissions, capture and
updates on supported devices with the distributed build. The web release
verification is separate.
