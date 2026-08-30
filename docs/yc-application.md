# Waka — YC application draft

Drafted 2026-08-30 from the repo's own canon (`README.md`, `docs/data-model.md`,
`docs/generation.md`, `docs/craft/second-brain-graveyard.md`,
`docs/craft/the-legible-loop.md`). The product, progress, idea, and competitor
answers are written and defensible from the codebase. Slots marked **[FILL]**
are facts only the founder has — verify every one before submitting. Voice is
"we"; switch to "I" throughout if applying solo.

---

## Founders

**Who writes code, or does other technical work on your product? Was any of it
done by a non-founder?**

> **[FILL — suggested shape; verify every claim before using:]** All product
> code is written or directed by the founder(s). Development is AI-native: much
> of the codebase is built with Claude Code operating under working agreements
> checked into the repo, and the mechanics documentation is drift-locked to the
> implementation in CI — a documented constant that disagrees with the code
> fails the build, so agent-written changes cannot silently diverge from the
> spec. No non-founder humans have written product code.

**Are you looking for a cofounder?**

> **[FILL]**

**Founder video (1 minute) — suggested beats:**

1. "Every AI lab is building memory about you that you can't see, can't
   correct, and can't take with you."
2. Show Waka: save something → the pattern it becomes, citing your exact
   words → your top of mind → a principle.
3. Show an agent reading your principles over MCP and deciding differently
   because of one.
4. "Memory is the evidence. What Waka forms from it is the prior your agents
   choose by. You own every layer."

---

## Company

**Company name:** Waka

**Describe what your company does in 50 characters or less.**

"A memory system for people and their AI agents" (46/50)

Alternates: "Memory your AI agents choose by" (31/50) · "Owned memory for
people and their AI agents" (43/50)

**Company URL / demo video / product link:**

> **[FILL]**

**What is your company going to make? Please describe your product and what it
does or will do.**

Waka is a memory system with two kinds of users: people and their AI agents.

You save what matters as it happens — a thought, a link, a decision. Waka does
the reading you were never going to do: it distills your saves into
evidence-backed patterns ("you keep choosing depth over breadth"), keeps one
short, versioned account of what currently matters to you, and nightly mints
principles — how you choose, stripped of context ("have something working
before you put more money in"). Every machine-written sentence cites the exact
words of yours it rests on, and the quote is verified in code before it can
ship. A statement with no receipts doesn't exist in Waka.

Agents consume this over MCP. An agent acting for you doesn't mainly need
facts about you; it needs your prior — how you choose. Waka serves your
principles to your agents as one canonical, ranked, machine-readable document,
and a principle you declare in your own words is binding on your agents from
the moment you say it. Agents also keep memory of their own: each gets a
separate stack it fully owns. It can read yours; it structurally cannot write
into yours.

You govern the formation process, not just the output. Your edits lock — the
machine never rewrites your words. Dismissing a pattern is a law with a
standing receipt, not a hint to a scorer. And when the machine derives two
conflicting beliefs about you, it must hold both and show you; it never picks.
Only you resolve what's true about you.

Teams get rooms: shared memory a group actually governs. A room distills its
own patterns from what members make public to it — a pattern needs at least
two members' memories behind it before it can wear the room's name — and the
room's shared reading is adopted by majority vote, where a member is a member,
human or agent.

**Where do you live now, and where would the company be based after YC?
Explain your decision regarding location.**

> **[FILL]**

---

## Progress

**How far along are you?**

The full loop is built and running on AWS: capture → pattern derivation
(extraction, embeddings, match-or-mint with a judged ambiguity band) →
top-of-mind synthesis (versioned, every citation validated against the
database) → nightly principle minting under five qualification tests — plus
rooms with proposal-and-majority-vote governance, per-profile revocable agent
credentials, and MCP access via a companion client. Trust properties are
enforced in the database, not just described: tenancy by composite foreign
keys, promotion thresholds by trigger, and the whole audit chain walkable from
any decision back to the person's own words. A full end-to-end pass of the
four live test suites costs under a dollar in model calls.

> **[FILL: how long you've worked on it, how much full-time, and current
> usage — your own daily use and any outside users, stated honestly.]**

**What tech stack are you using? Include AI models and AI coding tools.**

TypeScript monorepo. Hono API on AWS Lambda (SST), Neon Postgres via Drizzle,
React 18 + Vite web app, S3 presigned uploads. Generation runs on Gemini
(flash-lite for extraction, judging, and synthesis; embedding-001 at 768
dimensions), every call temperature-0 and schema-constrained, metered by a
per-account budget on a Postgres job queue — worst-case model spend is bounded
and tested. Agents connect over MCP with per-profile credentials. Built
largely with Claude Code; the generation docs are machine-checked against the
code in CI, both directions, so documentation and implementation cannot drift
apart.

**Are people using your product?**

> **[FILL — honest answer. If it's you and your agents daily, say exactly
> that; for an agent-memory product, founder-as-user-zero is a real answer.]**

**Do you have revenue?**

> **[FILL — presumably "No."]**

**If you applied with this idea before, what changed? Any other accelerators?**

> **[FILL]**

---

## Idea

**Why did you pick this idea to work on? Do you have domain expertise? How do
you know people need what you're making?**

> **[FILL — the personal origin story only you can tell.]**

What we can show for diligence: before committing to the design we wrote a
pre-mortem of the entire category from primary sources — how Evernote, Roam,
Pocket, Mem, and Rewind actually died — and graded our own design against each
of the seven deaths (it's in the repo). Two findings shaped everything. First,
archives rot because nothing re-reads them in present tense, and the human was
never going to be the re-reader — every failure in the category is some form
of a save that never paid the saver back. Second, the AI products that tried
passive reading — Mem at a $110M valuation, Rewind at $350M, Napkin — all
retreated to chat-on-demand, because their reading couldn't be audited and one
visible unexplained miss poisons the whole corpus.

The need is now loud on both sides. People: the biggest complaint literature
in consumer AI is memory people don't control — surprised at what was stored,
unable to see how it shapes outputs, unable to take it anywhere. Agents: every
framework is bolting on a memory module, because an agent without one re-asks
everything and an agent with a bad one guesses.

**Who are your competitors? What do you understand about your business that
they don't?**

Three camps. Developer memory infrastructure (Mem0, Zep, Letta, LangMem)
sells app builders fact recall — what to remember about a user so the next
session doesn't start cold. Lab-native memory (ChatGPT memory, Claude memory)
is a deletable list of rows over a synthesis you can't inspect, owned by the
lab and siloed inside it. Behind both, the note-keeping category: a graveyard
(Evernote, Roam, Mem, Rewind, Pocket) and a few disciplined survivors (Notion,
Obsidian, Readwise).

What we understand:

1. **Agents are the return engine this category always died without.** Every
   second-brain death traces to a save that never paid the saver back, because
   the only re-reader was a guilty human. Agents re-read constantly, natively,
   in present tense — the missing re-reader now exists, and it isn't the user.
   Products built for human retrieval don't serve the new reader; products
   built for the new reader don't let the human govern what it reads. We're
   built for both at once.

2. **Delegation runs on a prior, not a lookup.** "The user's dog is named Rex"
   is commodity retrieval — RAG over chat history gets you there. "Has
   something working before spending more; chooses depth over breadth; their
   stated word overrides your inference" is what an agent needs to decide as
   you would. Nobody else derives that layer from evidence, ranks it, makes it
   decidable, and makes the person's own declaration binding on their agents.

3. **Trust in machine-read memory dies retroactively, of unauditability** —
   that's why an entire generation retreated from the exact product we're
   building. So we made lying structurally hard: every derived sentence
   carries verbatim-verified quotes of the person's own words; corrections are
   laws with standing receipts; and the document that explains the loop is
   compiled from the same constants that run it, so the explanation is
   mechanically incapable of drifting from the mechanism.

4. **A lab's memory is a moat around the lab. Waka is a moat around the
   person.** Their memory exists to retain you inside one assistant; ours
   exists to condition anything you point it at — which is why ours can be
   trusted with the whole of it, and theirs never will be.

**How do or will you make money? How much could you make?**

Membership for individuals — the survivors in personal memory (Readwise,
Obsidian, Reflect) all settled near $100–150/yr, and we price to be trusted,
not to extract. Per-seat rooms for teams — the category's own history says
coordination, not solo memory, is where the durable business was (Notion). And
the multiplier the incumbents don't have: agent seats. Every agent gets its
own memory stack; a person with five working agents and two rooms is running
eight stacks, not one. At a blended $10/seat/mo, a million people at that
shape is roughly $1B/yr — the shape of the upside, not a forecast. The long
game: if delegation becomes the default way people use software, the profile
an agent consults before acting for someone is infrastructure priced like
identity, not like a notes app.

**Which category best applies?**

> **[FILL — suggest: AI / agents infrastructure, per the current form's
> options.]**

**If you had other ideas you considered applying with, list them.**

> **[FILL]**

**Something surprising or amusing you've discovered (if the form asks):**

The read-it-later category's own data condemned it: Instapaper disclosed that
two-thirds of users who ever act on a save do so within 3–5 days of saving;
Pocket measured a saved article's median "lifespan" at 37 days. The category
then monetized permanent storage of a pile its own numbers said nobody was
coming back to — and when Pocket shut down, the paid "Permanent Library"
turned out not to be exportable at all. Also: 77% of Pinterest group boards
are exactly two people. Shared memory's natural unit is a pair — which is why
our rooms are built for two before twenty.

---

## Equity

> **[FILL — legal entity formed?, investment taken?, currently fundraising?,
> any noncompete or IP agreements overlapping the project?]**

---

## Curious

**What convinced you to apply to Y Combinator? How did you hear about YC?**

> **[FILL]**
