# Plain words — revising WAKA's vocabulary to be understood on first contact

**Status: proposal, awaiting the founder's word choices. Re-verified against `dev` 2026-09-07 — see [the addendum](2026-09-07-plain-words-addendum.md) for what moved (Korean shipped; copy moved into the i18n catalog; `index.html` is already deleted; layer 4 gained a second name).** Written 2026-08-28 on
the founder's ask: the names are too abstract and dreamy; revisit the glossary
and the terms used across the product so they are intuitive. Nothing here is
applied. The word choices at the end are the founder's; everything else is
mechanical once they are made.

The evidence below comes from a full sweep of `packages/web/src`,
`packages/api/src`, and the canonical docs, done for this proposal.

---

## Diagnosis — why the names feel wrong

**1. Three dialects means three names per mechanism, and the user always gets
the coined one.** The glossary gives every mechanism an infrastructure name, a
world name, and a docs name (`locked` / **star** / "user-locked immutable
statement"). The person on screen is served the one name that cannot be
guessed. The coinages a first-time user must absorb before the screen reads:
field, sky, headquarters, orb, wall, star, roots, the weather, the
antechamber, agreed light, refused ground — plus seasons, campfire, door, and
setting reserved, plus poster and dial in the docs. The glossary's own
principle 2 called the failure mode: *"Too many coined words make a riddle,
not a poem."* The riddle threshold is behind us.

**2. The ban list made the coinage mandatory.** GLOSSARY.md bans the plain
words — lock, source, version, history, audit — from the UI. With the plain
words outlawed, a metaphor was the only legal name for every mechanism. The
dreaminess is not a taste that crept in; it is the direct output of that rule.

**3. Every metaphor legally requires a chaperone.** The mom test demands a
plain line on hover for each metaphor — which concedes that the metaphor does
not carry the meaning. A name that cannot go anywhere without its explainer is
the explainer's understudy. The plain lines are uniformly excellent ("the
memories this signal grew from"); they have been doing the real naming all
along.

**4. The founder's explaining voice already uses the plain names.** GOAL.md,
written to explain the product plainly, says "the field of **memories**, the
sky of **patterns**". The warmest strings shipped in the product — "kept",
"let go", "room", "the room so far", "you agreed" — are plain words that
coined nothing. The target register is not something to invent; it already
exists in the product's best copy.

**5. The plain words keep breaking through on their own.** Two live
inconsistencies, found in the sweep:

- `Home.tsx:11692` says **"this pattern in your own words"** to the user,
  while two dialogs nearby say "signal" for the same concept — and
  `check-vocabulary.mjs` forbids `pattern` in identifiers.
- `lib/api/inspirations.ts:117,134` says **"Failed to save this capture"** /
  "your captures" to the user, while the same gate forbids `capture`.

When the copy wants to be understood, it reaches for the banned plain word.

**6. "Signal" is already treated as unspeakable.** The founder ruling at
`Home.tsx:2783–2789` filters the word out of the weather feed because signals
are "plumbing and must never be spoken" — yet it still leaks into two dialogs,
four error strings, and the board copy. A name so wrong the product censors it
is not a name; it is a liability. (Outside WAKA, "signal" means an event, a
notification, or an encrypted messenger — everything this thing is not.)

**7. The repo has already paid for one rename — in the wrong direction.**
`check-vocabulary.mjs` documents it: the frontend originally said `captures`
and `patterns` and was renamed to `inspirations`/`signals` to match the canon.
The plain words were there first. The machinery built for that migration (the
vocabulary gate, the copy gate, the drift-locked generation doc) is exactly
what makes the reverse migration stick.

**8. The actual rename surface is small.** Once comments are stripped, the
rendered world-language is roughly **twenty strings**. "campfire" appears
nowhere in the repo; "seasons", "door", "dusk" render never; "roots" never
renders in the web UI; "star" renders exactly once. Most of the dreaminess a
user meets is carried by a handful of frames — *the antechamber*, *the
ground*, *the sky*, *the weather* — around sentences that are already plain.

## What this proposal does NOT change

- **The five laws.** Light as the only meaning channel, motion explains,
  stillness, fading never deletes, states render / numerals never — these are
  *rendering* rules, not names. The world looks identical after the rename.
  Agreed light stays a light difference with no badge (`Home.tsx:11660`); only
  what the docs call it changes.
- **The legible-loop designs.** The delta view, receipts, gestures-as-laws,
  ratified light (`docs/craft/the-legible-loop.md`) keep every mechanism.
  The narration sentences themselves are mostly already plain ("your top of
  mind was rewritten", "a quiet fortnight — nothing moved") and mostly survive
  verbatim.
- **The world.** The geometry (memories below, patterns above, one column per
  mind), the orbs, the canvas, the arrival — untouched. Sections stop being
  *named* field/sky/headquarters in copy and start being labeled by what they
  hold; the geography words remain fine in comments, where they say where a
  thing is drawn.
- **The good names.** top of mind, principle, kept, let go, room, wall,
  experience, space, "how WAKA reads you" — already plain, already the proof
  that plain does not mean cold.

## The proposal

**One vocabulary instead of three dialects.** The same word in the schema, the
route, the identifier, the screen, and the doc. Where a term benefits from
warmth, the UI keeps a short explanation line — the old plain line, demoted
from chaperone to subtitle.

**The ban list becomes a style rule.** Lead with the plain word everywhere;
keep true jargon (provenance, audit, immutable) for docs and legal. "History"
and "sources" stop being crimes.

**A metaphor budget.** A metaphor may stay only if it explains itself without
a tooltip. *Fading* passes — everyone knows what fading means, and it is
literally what the pixels do. *Antechamber* does not. New metaphors clear the
same bar or stay out.

### Canon renames (the two feeling-words among the four layers)

| now | proposed | why |
|---|---|---|
| **inspiration** | **memory** | The canon's own definition is "a capture event"; every doc reaching for clarity says "memory" ("one orb per memory", "the memories this signal grew from", "a room's field is its members' public memories"). WAKA already introduces itself as a memory system. `waka_add_memory` is self-documenting to an agent in a way `waka_add_inspiration` never was. Alternate: **capture** (mechanism-true, colder). |
| **signal** | **pattern** | The canon defines a signal as "an evidence-backed **pattern**"; GOAL.md glosses the sky as "the sky of patterns"; the UI already says it (`Home.tsx:11692`). Collision note: the L3 entry type `pattern` renames to `statement` — data-model.md already describes entries as "statements/questions/tensions". Alternate: **theme** (no collision, slightly narrower). |

Unchanged: **top of mind**, **principle**, **evidence**, **profile**,
**group** (human word **room**), **space**, **experience**, **account**.

States: the signal enum is `emerging | active | retired`
(`schema-signals.ts:46`) — all serviceable; optionally `emerging` → `forming`
(says what is happening rather than how it feels). Note the glossary's
`dormant_at` row describes a state that does not exist in the schema; the
future word for it is **fading**. Principle states: `held` →
**demonstrated** (the one state name that actively misleads — "held" reads as
*on hold*); `aspirational` and `contested` stay; `yielded` → **overruled**
(optional).

### The UI strings, one by one

The complete rendered world-language surface, current → proposed. Receipts and
narration lines that are already plain are marked *keep*.

| where | today | proposed |
|---|---|---|
| regeneration toast, `Home.tsx:1637` | "the sky was redrawn — your stars kept their places" | "rewritten — your own words kept their places" |
| receipt `starHeld`, `receipts.ts:58` | "your own words — WAKA will not rewrite them" | *keep* — this was always the real name |
| empty suppression log, `AntechamberPanel.tsx:48` | "nothing stands here — the ground has refused nothing" | "nothing here yet — nothing has been set aside" |
| panel title + account-sheet link, `AntechamberPanel.tsx:42`, `Home.tsx:14174` | "the antechamber" | "set aside" |
| loading state, `AntechamberPanel.tsx:45` | "still fetching the refusals…" | "still fetching what was set aside…" |
| receipt `groundRefuses`, `receipts.ts:53` | "the ground will refuse anything this close from now on" | "WAKA won't suggest anything this close again" |
| dismissal receipt, `receipts.ts:45` | "set aside — it will not return to your top of mind" | *keep* — already the proposed register |
| privacy title, `Home.tsx:12823` | "Only you can read this. Nothing leaves your own ground." | "Only you can read this. Nothing leaves your own memories." |
| delete dialog, `Home.tsx:13121` | "the signal loses this ground, and can no longer point back to where it came from." | "the pattern loses this evidence, and can no longer point back to where it came from." |
| visibility dialog, `Home.tsx:13143` | "Making it private takes it off your rooms' ground" | "Making it private takes it out of your rooms" |
| room description, `Home.tsx:14217` | "…have marked public become part of its ground." | "…have marked public become part of what it reads." |
| aria, `Home.tsx:13744` | "Your ground — left and right arrows read through your memories…" | "Your memories — left and right arrows…" |
| aria, `Home.tsx:13530` | "Whose inspirations are on the ground" | "Whose memories are shown" |
| empty sky panel, `Home.tsx:11561,11565` | "…keep capturing, and this sky will start to fill." | "…keep saving, and patterns will start to form." |
| capture mouth, `Home.tsx:12594,12597` | "Capture inspiration" | "Save a memory" |
| i18n catalog, `en-US.json` | "Saved inspirations", "Inspiration saved." | "Saved memories", "Saved." |
| signal dialogs, `Home.tsx:13119,13141` | "A signal was read from this memory…" | "A pattern was read from this memory…" |
| error copy, `lib/api/signals.ts` | "Failed to load your signals" | "Failed to load your patterns" |
| error copy, `lib/api/groups.ts:312` | "Failed to load this room's field" | "Failed to load this room's memories" |
| error copy, `lib/api/weather.ts:57` | "Failed to read the weather" | "Failed to read the activity" |
| markdown export, `the-weather.ts:472` | "# The weather" | "# Activity" |
| narration sentences, `the-weather.ts` | "a signal found another memory behind it", "refused a candidate — too close to what you dismissed", "a quiet fortnight — nothing moved" | *keep*, with signal→pattern — the sentences were always plain; only the frame was weather |
| filtered line, `the-weather.ts:195` | "the sky held" | "nothing new formed" (stays filtered from the feed) |
| group panel, `GroupPanel.tsx` | "the room so far", "you agreed" | *keep* |

Concept renames with no rendered string today (identifiers, docs, and the
glossary only): **roots → evidence** (the UI's own verbs — "built from",
"standing on", "what it grew from" — already say it); **agreed light →
confirmed** (docs name; the pixels keep doing the talking); **seasons →
history**; **campfire → room** (the word campfire appears nowhere in the
repo — the row can simply die); **door → access** (`doorMarks` →
`accessMarks` or "joined/left marks"); **setting/dusk → fading**;
**headquarters** retires outright; **poster/dial** become "the top of mind" /
"the timeline" in doc prose.

### The new GLOSSARY.md (paste-ready draft)

```markdown
# WAKA GLOSSARY — one vocabulary

Every name in WAKA follows this document. A new concept gets its row here
before it gets a name anywhere else.

## Principles

1. **One word per concept, in every register.** The schema, the API, the
   identifier, the screen, and the docs use the same word. What varies by
   surface is how much explanation rides along, never the name.
2. **The name passes the mom test by itself.** If a name needs a tooltip to
   be understood, the tooltip is the better name. Explanation lines are
   welcome as subtitles; they are not allowed to be load-bearing.
3. **A metaphor must explain itself without a chaperone.** "Fading" passes.
   A metaphor that fails stays out, however beautiful. Poetry lives in the
   rendering — light, space, motion — where the laws already put meaning.
4. **Lead plain; save jargon for docs.** Provenance, audit, immutable, and
   friends belong in developer docs and legal text, not on screen.

## The words

| Word | Mechanism | Explains itself as (UI subtitle, where useful) | Rendered as | Status |
|---|---|---|---|---|
| **memory** | Layer 1 — a raw save: text, link, image | "what you saved, as you saved it" | a point of light below | today |
| **pattern** | Layer 2 — an evidence-backed statement WAKA derives | "what your memories keep saying" | forms above; lit once established | today |
| **top of mind** | Layer 3 — the one versioned artifact per profile | "what currently matters" | where you stand | today |
| **principle** | Layer 4 — how the profile chooses, stripped of context | "how you choose" | a ranked set, one document | today |
| **evidence** | pattern ↔ memory links | "the memories this stands on" | lines drawn down on demand | today |
| **your words** | a human edit locks the text against regeneration | "your own words — WAKA will not rewrite them" | held still while everything else rewrites | today |
| **confirmed** | you have answered this ground (verdict or edit) | — | full ink; unconfirmed sits dim — no badge, no label | today |
| **dismissed** | owner refusal, logged and reversible | "WAKA won't suggest anything this close again" | gone from view; the receipt stands | today |
| **set aside** | the log of what was read but not kept | "read, but not kept" | a dim list, on request | today |
| **activity** | narration derived from stored records | "what the loop did, told as days" | sentences, never numbers | today |
| **history** | versions — soft-invalidate, never delete | "kept, never erased" | scrub back through time | reserved |
| **room** | a shared space (canon: group) | "a space you share" | its own column | today |
| **access** | permissions, joins, and who was here | "who can join — and that someone was here" | joined/left marks | partial |
| **fading** | decay without deletion | "unused, not deleted" | light falls; nothing vanishes | reserved |

## Style rule

Prefer the plain word on screen. Jargon (provenance, audit, immutable,
lock as a noun) stays in docs and settings/legal text.
```

## What it costs

**Tier 1 — strings and glossary (no schema, roughly a day).** The ~20 strings
above, the GLOSSARY rewrite, `AGENTS.md`'s naming paragraph, and the tests
that pin copy verbatim: `test/antechamber-panel.test.tsx:118`,
`test/home-memory.test.tsx:604`, `test/receipts.test.ts`,
`test/group-panel.test.tsx`, plus `the-weather.db.test.ts` /
`the-reading.test.ts` on the API side. `test/copy.test.ts`'s `CANON_IN_COPY`
table is the designed extension point if any canon word needs a human alias
during the transition.

**Tier 2 — docs sweep.** `data-model.md`, `architecture.md`, `README.md`,
`GOAL.md` prose; `generation.md` moves with the code it is drift-locked to
(constants like `FIELD_CARRY_ROOTS_SHARE` rename in the same diff as the doc,
held honest by `generation-doc.test.ts`). Craft docs are history — they get
a one-line header note, not a rewrite.

**Tier 3 — the canon rename (memory, pattern).** Tables (`inspirations` →
`memories`, `signals` → `patterns`, `signal_evidence` → `pattern_evidence`),
routes (`/api/inspirations` → `/api/memories`, `/api/signals` →
`/api/patterns`, `/api/weather` → `/api/activity`), ~30 web files and ~60 api
files of identifiers, MCP tools renamed in lockstep in `waka-mcp`
(data-model naming rule 3), and the gate flip: `check-vocabulary.mjs`'s
FORBIDDEN table inverts (`signal` → "use pattern", `inspiration` → "use
memory"; `capture` keeps pointing at the L1 noun). Breaking renames are
doctrinally allowed — "no backward compatibility, no legacy aliases" — and
this exact playbook has run once before (`three-layers`). Wants its own goal
doc with gates.

**Named out of scope:** the 176 KB `index.html` at the repo root is a legacy
prototype, not the app shell (`packages/web/index.html` is), and confusingly
already speaks the *old-new* vocabulary ("pattern", "Saved inspirations").
Recommend deleting it in tier 1 so it cannot be mistaken for live surface.

## The founder's forks

Four choices only the founder can make; the recommendation is first in each.

1. **Layer 1: memory, or capture.** Recommended: memory — it is the word
   every doc already reaches for, and the product's own self-description.
2. **Layer 2: pattern, or theme.** Recommended: pattern — the canon's own
   definition; costs the entry-type rename (`pattern` → `statement`).
3. **How far: tiers 1–3, or tier 1 only.** Recommended: all three — a UI
   that says "memory" over a schema that says "inspiration" rebuilds the
   dialect tax this proposal exists to remove, and "one name per concept" is
   already doctrine.
4. **The world-section labels: adopt the layer nouns, or keep field/sky as
   pure geography in copy too.** Recommended: layer nouns in copy; geography
   in comments.

## The product, said in the proposed words

You save what moved you; WAKA finds the patterns in what you keep; the
strongest become your top of mind; what keeps surviving becomes your
principles. Your words are never rewritten, everything shows its evidence,
and nothing is deleted for being wrong.

No tooltip required.
