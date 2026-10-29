# Top of Mind novelty rubric

Status: evaluation only. Normal refreshes do not enable semantic comparison.

Compare meaning after current source/language checks. A changed reading needs
new information, a changed question/claim or a different leading focus. An
inspiration or citation arriving again is not itself new meaning.

## Rules

- Compare the full reading in both directions. Every accepted proposed entry
  must be covered by the accepted current reading, and every accepted current
  entry must be covered by the proposal, before calling the content unchanged.
- Coverage is directional entailment. A covering set must preserve **all** of
  the row's body, belief and question, including certainty, negation and time
  scope. It must not merely mention the same subject. An empty covering set
  means missing information; it is not permission to guess.
- Splitting or merging repetitions is unchanged when both readings cover each
  other. Pairwise equivalence is insufficient: a shorter duplicate can be
  covered by a fuller entry without being its complete equivalent.
- A question's requested decision matters. A general reflection and choosing
  the next test are different. Rephrasing the same requested decision is not.
- An explicit temporary scope versus an unqualified claim can change meaning.
  Check the claim itself; do not treat a later timestamp, a fresh citation or
  an additional saved example as a changed scope automatically.
- If content is unchanged, compare the first accepted machine entries. Their
  meanings must cover each other on their own to retain the leading focus.
  Reordering secondary entries does not change focus.
- Leading-entry coverage is a separate, single-entry proof. Record the actual
  index that was compared; if quality checks reject it, fail the proof rather
  than attributing it to the next surviving entry. Redundant rows in a whole
  reading proof do not prove that focus changed.
- Formatting, type labels and citation order do not create meaning. Human
  words, pins and locks remain exact and are excluded from machine rewriting.
- Rejected content cannot establish coverage or manufacture novelty. A
  missing, duplicate, foreign, same-side or malformed coverage proof fails
  closed. Never discard part of a covering set and pretend the remaining
  subset proves the same thing.

## Fixed measurement

The synthetic corpus is in
`packages/api/test/helpers/top-of-mind-novelty-cases.ts`. Its original 13 labels
remain fixed, including the question/time-scope cases. The Korean paraphrase
preserves possibility, correcting the earlier accidental necessity claim.
Merged repetition is a separate required case.

Measure semantic comparison independently using scripted quality decisions,
then test the real quality/comparison combination separately. This prevents a
quality rejection from being mistaken for a correct no-change judgment.
Record structural failures alongside wrong semantic decisions.

Gate: at least 85% on the original 13, zero cosmetic false positives, correct
merged repetition, and correct changed-question/time-scope decisions. The
existing English/Korean source-quality checks must also pass. No labels or
thresholds may be weakened to pass a run. Keep the feature disabled until the
gate and a separate integration check pass. Report measured cost and latency.

All evaluations use synthetic text and bounded calls to the existing judge.
There are no new database reads, recurring jobs or timers.

## Recorded gate (2026-10-29)

Two candidate implementations were measured against the fixed corpus using
Flash 1017. The second added an explicit leading-entry proof after the first
run exposed false focus changes from redundant coverage rows. Both were one
measured pass per implementation; neither was retried unchanged to get a pass.

| Measurement | Directional coverage | With independent leading proof |
| --- | --- | --- |
| Original 13 accuracy | 12/13 | 11/13 |
| Cosmetic false positives, including merge | 2 | 1 |
| Changed question | Correct | Correct |
| Changed time scope | Correct | Missed |
| Merged repetition | Incorrect | Correct |
| Full pipeline integration cases | 2/3 | 3/3 |
| Source-quality suites | 2/2 | 1/2 |

The second run still called split repetition new. Its source-quality failure
rejected a supported navigation connection. The comparator is now measured
independently, so a quality rejection cannot hide a comparison mistake.
These are small synthetic measurements, not population accuracy estimates.
The feature remains disabled. Next evaluate a different comparison judge or
representation against this same corpus, including false suppression,
optional-field changes, source rejection and measured cost/latency.

## Judge comparison (2026-10-29)

The same prompt, corpus, labels, token cap and thresholds were used once for
each candidate. A test-only `WAKA_NOVELTY_EVAL_MODEL` overrides just the
comparison request. Real integration keeps source-quality review on DeepSeek
Flash 1017. No application setting or generation model changed.

| Comparison judge | Original 13 | All 14 | Integration | Median comparison | Mean comparison cost |
| --- | --- | --- | --- | --- | --- |
| GPT-4.1 mini | 11/13 | 11/14 | 1/3 | 1,167 ms | $0.000278 |
| Gemini 2.5 Flash | 13/13 | 13/14 | 2/3 | 776 ms | $0.000245 |
| GPT-4.1 | 10/13 | 10/14 | 1/3 | 890 ms | $0.001418 |

All three failed the zero-cosmetic-false-positive gate on merged repetition.
Both OpenAI candidates also falsely labeled split repetition new and missed
time scope; GPT-4.1 additionally missed the changed question. There were no
protocol errors. The unchanged Flash source-quality suites passed 2/2 in the
Gemini run and 1/2 in each OpenAI run; a quality rejection also affected the
mini integration case. Those are baseline quality failures, not evidence about
the comparison candidate's own source-quality ability.

Gemini is the leading candidate in this small sample, not an approved
replacement. Its merged-case coverage recognized that both readings contained
the same information; its leading-entry proof incorrectly made that a focus
change. The next representation review should distinguish a changed leading
**theme** from compacting the same theme into fewer entries. Whole-reading
coverage must continue to catch changed questions, certainty and time scope.
Keep the existing labels and gate intact when testing that hypothesis.

Each run made 22 paid requests: 17 comparison calls and five unchanged quality
calls. All 66 requests were priced, totaling $0.034634084. Comparison maxima
were 1,662 ms (mini), 1,405 ms (Gemini), and 3,172 ms (GPT-4.1). These are
synthetic observations, not production latency or a per-user cost forecast.
No real memory was used. The feature stays disabled.

Raw decisions, coverage witnesses, usage summaries and source hashes are in
[`20261029-judge-comparison.json`](../craft/evidence/top-of-mind-novelty/20261029-judge-comparison.json).

Compatibility was checked against the
[OpenRouter model catalog](https://openrouter.ai/api/v1/models),
[structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs),
and the official [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
and [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) documentation.
The official mini page marks its snapshot deprecated even though OpenRouter
still lists the route; it was evaluated as a reference, not recommended for
adoption. Listed availability alone does not establish lifecycle suitability.

## Focused Terra recheck (2026-10-29)

At the owner's request, the unchanged `same-idea-merged` fixture was measured
once at low reasoning and once at medium with `openai/gpt-6.1-terra`. Each
setting ran the isolated comparison and the real quality/comparison
combination. No labels, prompts, source guards or application settings changed.
The test-only Terra request uses strict JSON schema, excludes sampling
temperature and retains the existing 1,800-token comparison cap.

| Comparison reasoning | Comparison alone | Real quality + comparison |
| --- | --- | --- |
| Low | Failed: changed=true, expected false | Failed: all three entries rejected by quality review |
| Medium | Failed: changed=true, expected false | Failed: all three entries rejected by quality review |

Both isolated runs recognized mutual coverage between the merged entry and
the first old entry, but did not consider the old saving/returning repetition
covered. This differs from the earlier Gemini run's leading-focus failure:
Terra's first-entry proof succeeded, while whole-reading coverage failed on
the remaining duplicate. Whether the explicit saving/returning detail is
entailed by the broader navigation wording needs a criterion/fixture review;
the result does not by itself establish that a stronger model solves the
problem. Preserve the existing frozen label when measuring that review.

The integrated runs returned changed=false only after rejecting all entries.
The test explicitly requires all three expected source approvals as well as
the correct novelty decision, so this empty result cannot count as success.
Source-quality review stayed on Terra low in both runs. The other 13 corpus
cases were not rerun; these measurements do not update their accuracy scores.

All six model responses were priced, totaling $0.009413. The four comparison
calls took 1,743–2,882 ms. Inputs were synthetic. The model-only tests used the
unit runner with environment loading and no database provisioning, reads or
mutations. No worker, recurring DB check, timer, deployment or push occurred.
The pure merged-coverage unit case and API typecheck passed. The live gate
remains failing and the semantic feature remains disabled.

The targeted opt-in tests are named `rechecks merged repetition` in
`packages/api/test/top-of-mind-review-eval.test.ts`. The test-only
`WAKA_NOVELTY_EVAL_REASONING` accepts low or medium for Terra comparisons;
ordinary application routing does not consume it. Raw verdicts, numeric
usage, source hashes and the unchanged expected decision are retained in
[`20261029-terra-merged-recheck.json`](../craft/evidence/top-of-mind-novelty/20261029-terra-merged-recheck.json).

## Boundary review and bounded fixes (2026-10-29)

Two deterministic defects were reproduced before editing the implementation:
an exact duplicate later in the opposite reading overrode a valid leading
comparison, and rejecting every entry was reported as unchanged. Both new
regressions failed first and now pass. Whole-content witnesses and the actual
leading pair are now evaluated separately. An all-rejected comparison throws
before its novelty callback. No normal refresh enables the experiment.

The source diagnostic identified a substantive problem in the legacy example.
One source observes hesitation caused by a hidden Save control. The other
reports where a visitor expected Close to return; it does not observe an
effect on hesitation. The proposed causal benefit is therefore stronger than
the supplied joint observations. A neutral connection between finding Save
and anticipating Close was approved, while a new memory-recovery outcome,
invented motives and a single-source paraphrase were refused. This explains
the source rejections without treating every rejection as a model defect.

Independent controls keep both actions explicit and connect them without
claiming an unobserved benefit. Eight isolated comparisons passed: genuine
merge, split and a later exact duplicate remain unchanged; lost action detail,
a changed action, a new belief, a new question and time scope remain changed.
The first real-review pass rejected the clean split case. The grounding prompt
was then clarified: originals may jointly support an abstraction without each
stating the whole connection; observations, expectations and outcomes remain
distinct, and hedging supplies no missing evidence. All three clean real
quality/comparison controls passed that changed prompt. English and Korean
source/language controls then passed 14/14, including wrong-language optional
fields, decorative citations, invented motives and unsupported outcomes.

The frozen corpus was not edited or relabelled. Its first broad pass in this
iteration scored 12/13 on the original labels and 12/14 overall, still calling
the old split/merge examples new. Questions and time scope were correct.
All three legacy integration cases failed after source rejection; the Korean
legacy quality suite also failed. Those runs preceded the grounding-prompt
clarification and were not rerun unchanged to obtain a pass. The later
targeted controls establish their own results, not a new score on that corpus.
The broader navigation versus explicit saving/returning wording still needs
benchmark adjudication under the strict information-preservation rule.

API verification: 1,077 unit cases and API typecheck passed. Two defect-first
cases and all 37 pure quality cases passed after the fixes. Only synthetic
model requests were made: no database provisioning, reads, mutations,
persistent workers, timers or recurring checks. Nothing was deployed or
pushed. The novelty gate remains open and the feature remains disabled.

Source rationales, unchanged-corpus hashes, raw retained legacy decisions,
numeric costs/timings and phase summaries are in
[`20261029-boundary-review.json`](../craft/evidence/top-of-mind-novelty/20261029-boundary-review.json).
All 48 responses reported prices, totaling $0.072197.
The reporter suppressed successful per-entry console payloads; those control
outcomes are supported by passing assertions and suite summaries, not claimed
as retained raw model verdicts. The initial three-entry diagnostic likewise
retains usage only; the seven-entry diagnostic records its actual rationales.
