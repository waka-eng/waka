# Dependency security maintenance — 2026-10-26

The local full dependency audit fell from 106 findings (including one critical)
to two. `pnpm audit --prod --audit-level=low` reports no known vulnerabilities.
Counts are advisory database snapshots, not evidence of an exploit or a complete
application security assessment. GitHub can count duplicate manifests separately.

Runtime changes: Hono 4.13.14, Undici 6.29.1, and Zod 4.6.7. Attachment fetching
uses the patched package's fetch and dispatcher together, so it does not depend
on the Undici version bundled in Node. Zod's enum error configuration was migrated
while preserving the existing messages.

Build/test dependencies and compatible transitive dependencies were updated.
The UUID overrides retain CommonJS support and the `v4()` API used by AWS SDK v2
and the Xcode project writer. OpenControl retains Zod 3 because its JSON-schema
adapter requires that API; forcing Zod 4 into that dependency would break it.

## Remaining tooling findings

Neither dependency below belongs to the deployed application dependency graph.
They remain visible in the full audit; no advisories are globally suppressed.

| Advisory | Dependency path | Follow-up |
| --- | --- | --- |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high | SST 3 → OpenControl → Zod 3 | OpenControl's validation can exhaust memory on oversized constrained collections. Do not expose the local development control server to untrusted callers. Remove the dependency through an SST upgrade. |
| [GHSA-j965-2qgj-vjmq](https://github.com/advisories/GHSA-j965-2qgj-vjmq), low | SST 3 → AWS SDK v2 | Region configuration must be trusted; deployment pins `us-west-2`. Remove SDK v2 through an SST upgrade. |

SST 4 removes these dependency paths, but its
[migration](https://sst.dev/docs/migrate-from-v3/) upgrades the underlying AWS
provider and requires a state refresh for each stage. Plan and validate that
separately, including a resource diff, before changing deployed infrastructure.

## Regression prevention

Dev deployment calls CI and depends on its successful completion. Pull requests
and main run CI directly. CI audits application dependencies, checks types,
applies migrations to disposable Postgres, runs hermetic API/web/admin/mobile
tests, and builds web/admin. Browser and paid model evaluations stay manual.
The build/check runners use Node 24; this does not change Lambda runtime settings.

Run `pnpm audit` periodically to review the full tooling graph as well. The
application audit in CI intentionally does not hide or dismiss tooling alerts.

## Local verification

- All 1,801 hermetic API tests passed against a dedicated loopback Postgres database.
- API/web/admin types, 1,382 web tests plus the added CI-gate test, admin/mobile
  tests, web/admin/mobile builds, migration checks, and frozen installation passed.
- A real HTTP fixture verifies excessive content encodings are rejected and a
  subsequent image request succeeds; existing DNS/redirect/body limits still pass.
- AWS SDK and Xcode's UUID consumers were exercised, including parsing the iOS project.
- Actionlint accepted both changed workflows.
