# Review answer semantic evaluation

R08 passed the final scoped evaluation on 2026-10-03: ten production-provider outputs met both their structural checks and the semantic expectations below. The first run passed structure but scored 8/10 for meaning. Its two weaknesses were corrected in the prompt before repeating the identical inputs. This is a small synthetic Gemini evaluation, not a measurement of production-wide accuracy.

The [baseline](review-answer-baseline.json) and [final run](review-answer-final.json) retain complete synthetic inputs, prompt hashes, parsed output, model responses, durations and usage. Their `semanticReview: pending` fields reflect the runner's deliberate refusal to score meaning automatically; this document records the subsequent qualitative review.

| Scenario | Calls per run | Baseline | Final observation |
| --- | ---: | --- | --- |
| One recording repeated as transcript and reflection | 1 | Pass | One qualified wish for a quiet morning and focused work; no invented additional experiences. |
| An article quoted and explicitly rejected | 2 | Pass | The work-first claim is unsupported; new wording preserves disagreement and the family-dinner preference. |
| Pottery as a temporary experiment | 1 | Pass | October and the short experiment remain explicit. No enduring creativity principle is inferred. |
| A changed preference after a new experience | 2 | Discovery marginal/fail | Strict scheduling is unsupported; the replacement explicitly retains “For now” and Sunday mornings. |
| A suggestion made only by the AI | 1 | Pass | No personal statement is created. |
| Korean correction of an old belief | 2 | Discovery fail | The former overtime belief stays joined to its withdrawal; the current six-o'clock family-dinner intention retains its start this month. |
| Temporary interest compared with an enduring criterion | 1 | Pass | Judge returns independent. The fixed 0.99-cosine raw control returns attach; review matching requests the semantic judgment. |

The prompt change requires complete qualifications inside each statement and its quote, refuses an isolated belief that the person explicitly says they no longer hold, and asks for natural first-person wording. It does not alter raw inspiration thresholds or the independent-evidence promotion count.

Each run was announced as at most ten calls, estimated below USD 0.05, with a USD 0.10 stop. Observed provider: Gemini 3.1 Flash Lite. Estimated costs from returned token usage were USD 0.00251375 and USD 0.00286625, totaling USD 0.00538. These are standard-text estimates, not invoices, using [Google's published input/output rates](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite). The script stops if a successful response cannot be priced or the call/cost limit is reached.

Run with `pnpm exec tsx tools/e2e/review-answer-quality.ts --live`. The script reads only configured provider keys and synthetic cases; it clears the database URL and opens no database. It uses the normal provider selection, prompt builders and parsers. This run selected Gemini because of the available local configuration. A deployment using OpenRouter still needs its configured-provider check in Q03.

The live cases prove interpretation, not arithmetic or storage. Separate real-SQL suites prove that raw audio/transcript/reflection share one origin, a review session counts at most once per signal, the same origin cannot be spent twice, selected items alone create no belief, stale support is withheld, and authored wording/explicit withdrawal survive regeneration. No live embeddings, new audio transcription, image interpretation or physical-device verification were performed here.
