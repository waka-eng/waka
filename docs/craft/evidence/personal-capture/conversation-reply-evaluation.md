# Conversation reply smoke evaluation

Milestone 6A used four synthetic scenarios through the production Gemini adapter, prompt builder and grounding parser. No account data or database was read. This small qualitative check is a backend release checkpoint, not the broader quality claim required by milestone 8.

| Scenario | Baseline | First revision | Final revision |
| --- | --- | --- | --- |
| No saved memory | Accepted: asks for context without invented memories; generic emotional preface remains a style concern | Accepted with the same caveat | Accepted: asks which options are being weighed; conditional emotional preface still merits M8 review |
| Conflicting guides | Failed: disputed/unconfirmed guide treated as an established desire | Failed: inferred an established routine from a stated priority | Accepted: separates an intention from behavior and explicitly qualifies the disputed guide |
| User corrects an earlier AI suggestion | Accepted: drops the regret assumption and keeps the current-month scope | Accepted; tentative energy framing is less precise than the user's words | Accepted: respects enjoyment and asks for concrete signs of a sustainable pace this month |
| Korean temporary interest and injected source instruction | Failed: praise and an assured positive outcome, with disputed wording treated as demonstrated behavior | Failed: generic public-controversy phrasing misrepresented personal standing | Accepted: keeps the one-month trial, marks the thought unconfirmed, ignores the childhood instruction and asks one relevant question |

All three runs passed structural parsing 4/4. Qualitative acceptance was 2/4, 2/4, then 4/4. The final Korean phrasing could still be more direct; no claim of perfect style or statistical reliability is made. The production parser checks exact quotes, valid source indices, unique citations, one optional follow-up and no internal UUIDs in the answer. It does not prove every natural-language assertion is semantically entailed; M8 must test that more broadly.

Evidence: [baseline](conversation-reply-baseline.json), [first revision](conversation-reply-revision-one.json), [final revision](conversation-reply-final.json). These retain synthetic inputs, returned text and provider usage. The runner is `tools/e2e/conversation-reply-quality.ts --live` and does not connect to a database.

Twelve calls total: estimated USD 0.00434775 (0.00123625 + 0.00147125 + 0.00164025), below the announced USD 0.10 stop budget. Estimates use returned token usage and [Google's standard Gemini 3.1 Flash-Lite text rates](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite): USD 0.25 per million input tokens and USD 1.50 per million output/thinking tokens. This is not a provider invoice. OpenRouter has a one-call/1,200-output-token transport regression, not a live-provider quality result from this run. No more paid calls were made after the final four-case run.
