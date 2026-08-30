# Landing-page copy

Status: draft, 2026-08-30. Two paragraphs for landing-page visitors — one
for the person, one for the agents — in the glossary's sales dialect (plain
infrastructure English, no coined metaphors). Every claim is one the code
enforces; the lab contrast is dated and sourced in
[`memory-infra-comparison.md`](memory-infra-comparison.md).

---

Waka is a memory system for you and your AI agents. You save what matters
as it happens — a thought, a link, a decision — and Waka does the reading
you were never going to do: it finds the patterns your saves keep pointing
at, keeps one short account of what matters to you right now, and over time
distills the principles you actually choose by. Every sentence it writes
shows its receipts — your own words, quoted exactly. And you have the last
word: edit a sentence and Waka never rewrites it, dismiss a pattern and it
stays dismissed, and nothing you saved is ever deleted for going quiet.

Your agents run on it. An agent booking your trip or triaging your inbox
doesn't need a transcript of your life — it needs to know how you choose,
and that's what Waka serves it: one document your agents read before acting
for you. Declare a principle in your own words and your agents are bound by
it from that moment. And on the question the big labs answered in opposite
ways — OpenAI launched its agent with memory switched off (2025); Anthropic
merged its agent's memory with your chats (August 2026) — Waka is neither:
your agents keep memories of their own, in separate stacks you can always
see into, and nothing an agent writes can ever touch yours. Your memory
stays visible, correctable, and yours, whichever assistant you point it at.

---

Notes:

- The contrast names competitors on purpose — it is the datable proof that
  the separation ruling answers a live question, not a hypothetical. Both
  facts are load-bearing and verified (2026-08-30 research pass): ChatGPT's
  agent mode launched with memory disabled to prevent prompt-injection
  exfiltration (July 17, 2025, TechCrunch); Anthropic unified memory across
  chat and Cowork (August 25, 2026, Anthropic blog). If either lab moves —
  OpenAI re-enabling memory in agent mode, Anthropic adding a wall — this
  paragraph is the first thing to re-check.
- "Yours" rather than "portable": the export door shipped
  (`GET /api/export`), but keep the softer word until hosted Waka exists —
  "portable" invites "to where?"
- Kept out by the glossary's sales-dialect rule: "behavior prior,"
  "control tower," field-and-sky vocabulary.
