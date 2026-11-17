# Model routing and production preparation

The single reviewed task/provider profile is [model-profile.json](../../infra/model-profile.json).
SST uses it for explicit `development`, `dev` and `production` stages; other
stages retain their existing selection. A source candidate is not a live rollout.
Its native provider is OpenAI Responses: Terra-low for text and supported vision,
Sol-medium for reading drafts, Terra-low for mandatory publication review.
The existing prompt builders and application parsers are shared. No tool use,
streaming, Pro mode, server-side conversation history or automatic paid fallback
is added. Existing completion caps, human locks, ownership, citations, currentness,
opening recovery, idempotency, Stop and quota fences remain authoritative.

The current owner-approved AI allowance is a $10/month COMBINED dev+production
spending target with alerts and existing quotas, not an automatic hard stop.
Native unknown costs stay unknown. Per-key limits and project alerts do not prove
a global invoice cap; no provider reroute or shared budget service is added.

This document describes source configuration. It is not proof that credentials,
account access, a model-quality comparison or a deployment has passed.

## Selection and credentials

`WAKA_GENERATION_PROVIDER` accepts `openai`, `openrouter` or `gemini`. An explicit
selection requires that provider's key; it never falls back after a missing key,
HTTP failure or unknown dispatch. Unset preserves the old OR-key/Gemini behavior.
An OpenAI key's mere presence does not select it. Task configuration is read from
the existing `WAKA_MODEL_*` names; native IDs must be `gpt-6.1-terra` or
`gpt-6.1-sol`, without an OR prefix. Sol never receives disabled reasoning or
sampling controls; Terra-low tasks also omit sampling controls.

SST creates the existing `OpenAiApiKey` secret for development/dev/production and
injects `OPENAI_API_KEY` into API, BackgroundWorker and PrincipleRefresh through
the same profile. Web, cleanup, monitoring, probe and budget functions receive no
model key. Release preflight must establish credential readiness; provider
entitlement is not established by source or by sharing a key reference.

For the owner-authorized 2026-11-17 release, development and production explicitly
reference the existing `OPENAI_API_KEY_DEVELOPMENT` GitHub secret temporarily.
Production has four step-scoped consumers: validation, read-only preview, stdin
setup and private runtime comparison. There is no automatic fallback to another
secret name and no key copy into source, local env files or artifacts. The
existing setter still receives `SST_STAGE=production` for production and writes
only that stage's SST namespace; DB/auth/Google/other-provider credentials keep
their production bindings. A later dedicated production-key change is separate.
Development exposure remains limited to validation, stdin setup and private
runtime comparison. Production additionally supplies `SST_SECRET_OpenAiApiKey`
to the existing read-only preview step. Install/web-build/job/global environment
receives neither OpenAI value. Validation fails before stage reads, secret writes,
migrations or deployment if the required production credential is absent.
Secret-name metadata alone does not establish a value or provider entitlement.

[`set-openai-secret.mjs`](../../scripts/set-openai-secret.mjs) is the one stdin
mechanism for all three exact stages. It rejects aliases/whitespace/unknown
stages, missing or oversized keys, sends no key in argv, strips OpenAI key env
names from the child, and bounds private child diagnostics. It replaces the
former development-only helper; there is no alias or second setter. Source tests
use synthetic keys and fake children. Running it still requires an authorized
same-stage setup; this change performs no secret write. Preserve DB/auth/provider
credentials and never reuse local S3-only credentials for deployment.

Fresh-human enrollment now has one stage-neutral name,
`WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2`. Enabled enrollment requires exact
`WAKA_STAGE` and trusted `SST_RESOURCE_App` name/stage agreement for one of the
three supported stages. SST sets API dev/development to `1`, production to literal
`0`, and omits it from workers and PrincipleRefresh. There is no legacy flag alias,
missing-control flip, existing-profile migration or paid call in the helper.
The old name is ignored/off if only that name is supplied. Deployment of the new
API supplies the new name atomically; the preserved owner local launcher and
loaded backend were not updated or restarted. A future local source update must
review its launcher separately before expecting new-human model2 enrollment.

Production model2 policy/cutover/default enablement remains held. The exact
compiled `embedding2.dev-candidates.v1` is an explicitly limited dev policy,
not independent calibration or evidence of broad production quality. See the
[production readiness gates](production-readiness.md).

## Responses contract and privacy

Each request is stateless with `store:false`, `stream:false`, a bounded completion
cap and no response-history ID or tools. Only completed, matching-model assistant
JSON is accepted; incomplete/refused/foreign-model/tool output is not published.
Chat retains JSON-object mode and its existing strict app parser. Conditional
multi-source Review questions also use JSON mode because their root `anyOf` is
outside OpenAI's strict root-object schema contract. The neutral format directive
does not alter human/source words. Other supported schemas use strict conversion.

`store:false` disables response application state; it does **not** establish Zero
Data Retention. Default abuse-monitoring retention and account-specific controls
are separate provider facts. OR `data_collection`/`zdr` preferences do not become
OpenAI controls. No account policy change is made, and prompts, results, error
bodies, response IDs and encrypted reasoning are never written by the new logger.

Native usage is numeric **structured logs only**: real `Provider:openai`, closed
task/model/reasoning/outcome fields, tokens and duration. Cost is unknown/unpriced;
native usage is not OR `usage.cost`. JSON decoding and task-parser acceptance are
separate outcomes. No `_aws` declaration is emitted for this provider, creating
**zero new ModelUsage custom metric series**. Existing fixed Faults metrics still
cover transport/parser failures. Additional log ingestion is variable; existing
function log retention is unchanged. Do not add a third EMF Provider series
without recounting the approved monitoring cost envelope.

## Media compatibility gates

- Direct Terra handles PNG/JPEG/WebP through the bounded image path. GIF retains
  its existing OR route because animated GIF support is not promised by the
  native contract. HEIC/HEIF retains the existing direct-Google route. A common
  image failure does not trigger a second paid provider request.
- The dedicated OR audio adapter targets `google/gemini-3.5-transcribe` on
  `/api/v1/audio/transcriptions`, preserving real-byte/duration validation,
  original-language text, silence, corrections and bounded worker retry policy.
  `WAKA_AUDIO_PROVIDER` is still `gemini` in this candidate profile pending a
  bounded capability check. Setting it to OR requires a reviewed activation;
  current Google credentials remain. STT has no asserted provider completion-token
  limit: input duration/bytes and accepted transcript length are bounded, which
  is not a dollar cap.
- Owned active/building model2 uses the existing `OpenRouterEmbedding2Candidate`
  via pinned Google AI Studio `google/gemini-embedding-2`, exact formatted input,
  768 finite nonzero raw geometry and a distinct namespace. No normalization,
  row relabeling or provider fallback is added. Profiles without control remain
  native `gemini-embedding-001`. Production existing profiles need independently
  scoped inventory/build/current coverage/atomic cutover; an env flag is not a
  coverage certificate. The older `OpenRouterEmbeddingCandidate` remains an
  unselected, unverified namespace and is not a substitute.

## Dev acceptance and rollback

The existing exact-SHA CI guard and serialized, no-auto-unlock dev deployment
remain. The official migration/schema gates are retained; this change adds no
SQL migration. The existing read-only dev audit privately compares all task/profile,
key, stage/SST identity, function ARN, DB target and API-worker pointer bindings
for all three model runtimes. Production release audit now compares the same
canonical task/provider profile, credential, exact account/function/SST identity
and stores for API, BackgroundWorker and PrincipleRefresh, requiring production
new-human enrollment OFF. It preserves all cleanup no-model-key/queue/IAM gates.
Both audits emit booleans and safe resource names only.
Runtime metadata acceptance does not establish live model quality or entitlement.

Use controlled synthetic requests only after Main reviews a concrete request,
token and cost allowance. Retain unknown/outstanding charges and stop on the first
unexpected transport/config/model or safety failure; no invisible retries or
provider fallbacks. The prior selective cost example omitted formerly-DS short
question/routing volumes; an all-native profile needs those volumes added.

Rollback is a reviewed return to the previous provider/model environment, not
deleting memory or changing vector namespaces. Keep existing provider credentials
until every retained media route and rollback need is deliberately addressed.
Normal delivery is PR to dev with Main review. Main/production promotion requires
a new explicit owner instruction.

Primary contracts: [OpenAI GPT compatibility](https://developers.openai.com/api/docs/guides/latest-model),
[Responses](https://developers.openai.com/api/reference/resources/responses/methods/create),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs),
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data),
[OR STT](https://openrouter.ai/docs/guides/overview/multimodal/stt),
[OR embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request),
[pinned SST stdin](https://github.com/sst/sst/blob/v3.19.3/cmd/sst/secret.go).
