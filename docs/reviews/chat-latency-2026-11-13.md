# Chat latency review — 2026-11-13

Baseline: dev `a9e3218f6809f89c5f122c5ecac10e39f2640295`. This review separates
measured application work from unmeasured deployed latency. It does not establish
the dominant cause of an individual slow dev conversation or complete the broader
performance goal. Main/production is outside this change.

## The path

Send commits the human message and reply intent atomically. Before enqueueing,
admission constructs the complete reply input and its current-source hash. After
commit it awaits an asynchronous worker wake, not the answer. The queue claims
work in its existing fair order; budget holds/backoff may defer it.

The worker reconstructs lexical input. When compatible material is indexed and
the existing account budget permits, it performs one serial Google query
embedding (5s header/10s exchange bounds), rechecks lexical currentness, then
selects hybrid input. It obtains a complete JSON answer and re-proves sources,
conversation/lease ownership and currentness before publication. The indexed
path consequently calls `inputFor` five times including admission; the
nonsemantic path calls it three times. Those proof boundaries remain intact.

The browser checks immediately, then at 1s for the first ten pending reads and
2s afterward, with existing bounded failure/older-state recovery. **It does not
currently poll at 4s.** A ready revision still requires a separate owned
conversation read before delivery. No faster polling, streaming/schema change,
publication bypass, idle DB polling or new model retry is introduced.

## Confirmed avoidable work and bounded fix

Previously each input reconstruction fetched the entire transcript and then
used its latest eight messages. It also separately fetched the owning profile's
locale/type, and projected reply-request rows even when the selected messages
contained no assistant turns.

The changed reader selects the latest nine rows, restores ascending order and
uses eight: the ninth preserves overflow disclosure. It joins the same scoped
conversation/profile in one statement and omits the request-projection read only
when no assistant row needs one. It retains the whole-message 8,000-character
window, current anchor/revision, locale, legacy memory scopes, pins, source and
opening proofs, human words, quotations, locks, idempotency, quotas and Stop.

A matched replay used a freshly verified disposable loopback PG17 database,
real routes/readers/SQL and zero-delay fake embedding/model transports. Fixed
IDs/timestamps and a grounded synthetic citation made the **complete provider
input digest and published projection digest identical** before/after in all
three cases; ready/citations and the human-kept reading also matched.

| Fixture | Admission statements before → after | Worker statements before → after | Ready-state / delivery read |
| --- | ---: | ---: | ---: |
| First plain message | 32 → 29 | 32 → 28 | 4 / 6, unchanged |
| First Why opening, three sources, indexed | 54 → 51 | 80 → 72 | 4 / 18, unchanged |
| Same opening, 120 earlier messages | 64 → 63 | 80 → 76 | 4 / 18, unchanged |

In the long fixture each of four worker input reads returned 121 rows/123,161
UTF-8 content bytes before, and nine rows/8,249 content bytes after. These count
message content, not total protocol bytes. **Other before-save, send-response
and requested full-history API reads remain.** This is not a claim that the
entire send transfers only nine rows. Local loopback wall times with fake
zero-delay providers are not Neon, Lambda, queue or browser measurements.

Actual SQL regressions cover the bounded tail, exact latest-eight order,
overflow/whole-word/negation behavior, stale anchor and locale edits. Existing
tenancy, reference/attachment, current-source, deletion, Stop and publication
tests remain authoritative.

## Lower-reasoning experiment: keep low

Six sequential fixed synthetic Terra calls compared three English grounded,
correction/history/no-memory, and Korean cases at low/none. Each pair had the
same entire request core except reasoning; output cap 1,200, no retries/fallback.
Main also reviewed the accepted synthetic answers against the prewritten
semantic rubrics. Both settings passed this narrow sample.

| Pair | Low provider ms | None provider ms | Cached input tokens low / none |
| --- | ---: | ---: | ---: |
| English grounded | 2,964 | 2,094 | 0 / 1,115 |
| Correction/history | 2,501 | 2,391 | 1,115 / 0 |
| Korean grounded | 1,893 | 2,542 | 1,115 / 1,115 |

All six reported **zero reasoning tokens**. None was faster in two pairs and
slower in one, with cache/order variation and only three samples. This is not
causal latency evidence, reliable p95, broad quality equivalence or end-to-end
performance proof. The agreed uncached reference-price estimate was $0.009569
for 7,704 input/373 billed-output tokens; cached input total 4,460. It is not an
invoice cost or a monthly projection. No further comparison calls were made.

The decision is to keep **Terra chat low** and all other models/efforts unchanged.
The temporary none capability and test-only experiment were preserved outside
the repository and removed from this PR. There is no new routing knob,
model/default, SST/workflow, secret, dependency or schema change.

## Diagnostics and remaining attribution

One content-free `conversation_timing` log reports worker prepare, optional
lookup, revalidation, answer and publication durations, phase error booleans,
answer-attempted and committed-publication flags. It has no account/request IDs,
sources, words, exceptions or EMF declaration. Existing performance logs add
`reply_admission`, `reply_state` and `reply_read` fixed stages. Admission excludes
its enclosing commit/wake; read stages include the projection, not browser paint.
Worker total excludes its earlier queue/cold-start/admission time.

These logs complement existing queue/model/context timings and browser-local
`chat_acknowledged`/`chat_reply` User Timing. Separate invocations are not magically
correlated, and observing a fetched reply is not a browser paint measurement.
No new CloudWatch custom metric series or third-party event is created; log
ingestion remains usage-dependent. Logging does not alter memory outcomes.

Deployed queue wait, cold starts, Neon/network round trips, embedding time,
publication time and submit-to-visible timing still need actual evidence. A
provider-only 3.436s earlier canary is not an end-to-end baseline. The confirmed
read amplification is fixed and the remaining phases become easier to inspect;
this review does not claim that reasoning explained the reported extreme wait.
