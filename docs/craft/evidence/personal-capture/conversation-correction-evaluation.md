# Conversation correction check

On 2026-10-03, two synthetic English/Korean cases checked M7-B: the next reply
must respect an explicit correction and its time limit, without inventing a
routine or claiming to edit a saved Principle. No database or account content
was sent. This narrow check is not the M8 product-quality matrix.

The first pair passed structural parsing but only one passed the semantic gate.
English kept enjoyment and the one-month limit. Korean preserved that correction
in the answer but asked about working “as usual,” implying an unstated routine.
That is a failure, not softened to a style observation. The
[baseline](conversation-correction-baseline.json) retains both outputs.

The prompt now explicitly removes rejected premises from follow-up questions,
including the assumed-routine example. The same two cases passed the narrow
gate on rerun: English retained the undecided long-term view; Korean asked
neutrally about choosing the family day within this month. Neither claimed a
Principle was changed. The [final outputs](conversation-correction-final.json)
remain unedited; their semanticReview fields are pending machine assessment,
while this document records the actual qualitative review.

Both final responses still attached an exact but unnecessary saved-source
citation while restating the user's correction. Citation relevance remains an
M8 improvement; the cited source exists and the text matches, so this is not an
invented-source or cross-profile access claim. Passing two cases is not a
statistical reliability estimate.

Four Gemini calls in total: estimated USD 0.00082875 for the first pair and
USD 0.00088625 for the rerun, totaling USD 0.001715. Estimates use returned token
usage and the runner's recorded model pricing, not an invoice. Both announced
pairs stayed within the USD 0.10 total stop limit. No further paid evaluation
is part of this checkpoint.
