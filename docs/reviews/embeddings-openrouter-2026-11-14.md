# Embedding transport preparation, 2026-11-14

This change prepares a broker migration and fixes reader identity gaps. It does
not activate OpenRouter, move stored vectors, change normalization, or establish
provider availability. The default remains native Google
`gemini-embedding-001` / 768 dimensions. Google audio and HEIC remain separate
routes and still require the existing Google credential.

Production synchronizes GitHub `GEMINI_API_KEY` into stage SST `GeminiApiKey`.
The development workflow does not synchronize that secret: its existing stage
SST value supplies runtime `GEMINI_API_KEY`. The native getter prefers that
runtime variable, then the SST resource link. This source inventory neither
identifies a Google account/project nor proves which credential currently works.
No credential value was parsed, exported or used; no owner memory was read.

## Construction and readable space

`embedding-provider.ts` separates requested HTTP transport from readable storage
identity. The six default construction sites are capture indexing, signal
derivation, review derivation, statement reindex, MCP recall and chat lookup.
Only the central factory now constructs the native client in runtime source.

`WAKA_EMBEDDING_PROVIDER` absent/blank/`gemini` retains the native route.
`openrouter` is compatibility-held before any key lookup or HTTP; other values
fail closed without echoing them. No SST/workflow sets this flag. Native cached
memory remains readable. A held recall request returns explicit unavailable,
with its ordinary consultation receipt but no attempt reservation. Chat retains
grounded lexical context and publication checks without a lookup reservation.
An unavailable semantic transport is not reported as an empty native corpus.

| Reader group | Required identity/currentness |
| --- | --- |
| Capture cache | Owner/source/model/scope, canonical input hash, metadata and vector shape |
| Statement reindex cache | Owner/signal/model, current statement hash and vector shape, including locked recheck |
| Related captures | Owner/personal scope/model/dimensions, current canonical material for selected sources |
| Match targets and dismissal anchors | Owner/input policy/model/dimensions, current exact statement hash |
| Gardener | Owner/native model/dimensions, current statement hash before comparing pairs |
| Reading diversity | Owner/native model/dimensions and current statement hash |
| MCP recall | Compatible model/dimensions/current hash/support before and after HTTP |
| Chat semantic context | Compatible model/dimensions/owner/personal scope/current canonical material |

Shape checks require finite, nonzero cosine geometry with the expected length.
They do not rescale or rewrite stored values. Existing explicit synthetic test
clients may advertise their fixture dimensions; runtime configuration cannot use
that seam to assign an unverified transport the native identity.

The gardener previously read the first vector per signal without constraining
model, input hash or dimensions. A real PostgreSQL17 fixture reproduced four
invalid-vector comparisons; the guarded reader refuses all four and still
compares the valid native pair. This is a correctness issue, not evidence of a
tenant leak.

Related-capture discovery adds one current-material SQL statement for the existing
maximum five selected sources, reusing the canonical index builder and ordered
reflection/effective-attachment inputs. A stale selection is dropped without
refilling from the archive. Parent count is bounded; child material bytes are
not newly capped. Claim, material, human-wording and final publication fences
remain separate checks, including changes during provider HTTP.

## Broker contract and pending gate

The candidate sends `google/gemini-embedding-001`, float encoding, 768 dimensions,
and `search_document` / `search_query`. It pins `google-ai-studio` in both `only`
and `order`, disables provider fallback, requires parameter support and retains
existing restrictive privacy preferences. Audio requests are unchanged.

The official [embedding request schema](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)
documents generic `input_type`; it does not establish the exact Gemini task
mapping. The public endpoint metadata's empty `supported_parameters` list is
inconclusive. [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection)
defines the slug allowlist and fallback controls. Naming/dimensional agreement
alone does not establish compatible vectors. The candidate therefore retains its
unverified namespace and is never returned by the runtime factory.

A separately reviewed operator runner is proposed, not executed or paid-approved:
four fixed synthetic documents and three queries through each transport, at most
14 sequential requests. One identical input has both task types. Native results
must distinguish those tasks before OpenRouter requests begin; otherwise the
result is inconclusive. Native failure, including the previously observed 402,
stops the run without fallback or retry.

The narrow proposed gate requires paired cosine at least .99999, stable rankings
and existing threshold decisions across native, broker and mixed corpora. It
records raw norms rather than normalizing data. Google's guidance about manual
normalization below 3072 dimensions is a separate question: this preparation
preserves existing native behavior. Passing the small fixture would not prove
universal compatibility, broad retrieval quality or account privacy policy.

## Verification and limits

- Full API unit gate: 1,478 passed, 24 existing skips. Final focused factory,
  generation-document and queue-boundary gate: 23 passed.
- PostgreSQL17 targeted readers, reply publication, source edits/Stop, matching,
  suppression, cache/attachment and support fencing: 213 distinct cases across
  15 files passed, combining the retained per-file receipts. All provider
  transports were deterministic fakes; no remote SQL or paid inference ran.
- API types passed. The disposable database is explicitly loopback and separate
  from owner/shared data. No migration, dependency, SST, workflow, secret or
  deployment change is included.
- Failed local receipts are retained: the expected gardener baseline, prohibited
  fixture identifier, synthetic consultation/type assumptions and a model-input
  DTO assertion were corrected without relaxing product guards. They are not
  evidence of failed deployment or provider availability.

The parity allowance, actual operator key read, any native-space grant and route
activation remain separate review gates. This preparation does not fix Google's
account capacity/billing availability or claim that embeddings have switched.
