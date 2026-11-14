# Model routing and native GPT rollout

The candidate development profile is [gpt61-development.json](../../infra/gpt61-development.json).
Its native provider is OpenAI Responses: Terra-low for text and supported vision,
Sol-medium for reading drafts, Terra-low for mandatory publication review.
The existing prompt builders and application parsers are shared. No tool use,
streaming, Pro mode, server-side conversation history or automatic paid fallback
is added. Existing completion caps, human locks, ownership, citations, currentness,
opening recovery, idempotency, Stop and quota fences remain authoritative.

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

Development SST alone creates `OpenAiApiKey` and injects `OPENAI_API_KEY` into
API, BackgroundWorker and PrincipleRefresh. The production branch of the same
source keeps its existing model profile and does not create or expose that secret.
The key is not linked to web, cleanup, monitoring, probe or budget functions.
The new GitHub secret is `OPENAI_API_KEY_DEVELOPMENT`, mapped to runtime/setup
`OPENAI_API_KEY`; no global production key or new GitHub environment is needed.
New development Actions key exposure is step-scoped to validation, secret setup
and private runtime comparison; dependency install and web build do not receive it.

`set-development-openai-secret.mjs` passes the value through stdin using the
pinned SST contract, with dev-only stage refusal, bounded closed diagnostics,
no key argv and no raw child output. It must only run under authorized setup;
the source PR does not itself set GitHub/SST secrets. Existing same-stage provider,
DB/auth and owner-file values must be preserved. Do not reuse local S3-limited
AWS credentials as deployment credentials.

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
- `OpenRouterEmbeddingCandidate` implements768 dimensions and explicit
  document/query `input_type` mapping, but is not selected by any runtime factory.
  Its distinct `unverified` model namespace cannot be mistaken for existing
  calibrated storage. No stored vector is relabeled, rewritten or backfilled.
  Direct/OR vector-space equivalence and compatible-reader filtering must be
  proven before activation. The existing recall model/dimension filter gap is
  a gate for that later change; this PR does not pretend to solve it without DB
  evidence. A few sample equal vectors alone do not prove broad calibration.

## Dev acceptance and rollback

The existing exact-SHA CI guard and serialized, no-auto-unlock dev deployment
remain. The official migration/schema gates are retained; this change adds no
SQL migration. The new read-only dev audit privately compares all task/profile,
key, stage/SST identity, function ARN, DB target and API-worker pointer bindings
for all three model runtimes. It emits booleans and safe resource names only.
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
