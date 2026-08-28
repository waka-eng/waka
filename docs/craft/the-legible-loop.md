# The legible loop — research, and what WAKA should build

Written 2026-08-23 on the founder's ask: people will not read every
signal, the way a GEPA practitioner does not read every evolved
candidate — they live at the outputs (principles, top of mind) and what
they actually want is to **understand and recalibrate the loop that
produces them**. Is that a gap, and how should WAKA fill it?

This document is the research half and the design directions it forces.
It feeds `goals/no-quiet-corners.md` Phase 9 ("the loop shows its
hands") and sharpens it in a few places.

---

## Part 1 — What the field knows

Ten findings from five adjacent fields, each with a one-line lesson for
WAKA.

**1. GEPA itself: practitioners steer the metric, not the candidates.**
In GEPA (Genetic-Pareto reflective prompt evolution, ICLR 2026 oral),
the optimizer builds a whole tree of evolved prompt candidates — and
the practitioner's real interface is not that tree. It is (a) the
metric, deliberately made to *speak*: "textual feedback provides GEPA
more visibility into why the system got the score that it did" —
compiler errors, medical guidelines, domain notes, not bare numbers;
(b) the eval suite as the arbiter of whether the loop is working; and
(c) reflection traces when something needs debugging. The candidate
text stays auditable but is not the surface.
*Lesson: the person's gestures are the feedback function. Design them
as the loop's inputs, and make the eval — "is the loop reading me
right?" — the surface people actually visit.*

**2. Folk theories are inevitable; an unexplained loop writes bad ones**
(Eslami et al., CHI 2015/2016). 62.5% of studied Facebook users did not
know a feed algorithm existed. The title quote — *"I always assumed
that I wasn't really that close to [her]"* — is a person attributing an
algorithm's curation to a human relationship. People always build a
theory of the loop; when the loop is invisible the theory is wrong, and
wrong theories drive behavior that feeds back into the loop. The
FeedVis probe — showing the curated feed against the raw one — reshaped
those theories, and most participants came out more satisfied, not
less.
*Lesson: the most theory-correcting view is the DELTA the loop caused —
what it chose, against what it saw — not the internals.*

**3. Explanation and correction must be one gesture apart** (Kulesza et
al., "Principles of Explanatory Debugging," IUI 2015; EluciDebug).
Users built the best mental models with the most complete explanations,
and — the key result — users who could correct the model *through the
explanation itself* (instance feedback and feature feedback on the same
surface) both understood the system better and fixed it faster. The
principles: iterative, sound (never a simplified lie), complete, and
reversible.
*Lesson: a "why" panel with no handle breeds helplessness; a handle
with no "why" breeds superstition. Every explanation surface carries
its gesture; every gesture explains what it taught.*

**4. Advisory controls destroy trust when their effect decays** (2026
Northeastern sock-puppet audit of TikTok's "Not Interested"; the
"Why Am I Still Seeing This" Meta audit). Flagged content resurfaces
within minutes; "See less" does not measurably reduce; users learn the
control is a hint to a scorer, not a rule, and stop believing the
system.
*Lesson: WAKA's gestures must be LAWS to the loop, never hints — and
the standing effect needs a receipt (the suppression log) so the person
can see the law still holding weeks later. This is already house
doctrine at L3 (dismissals never re-proposed); Phase 4 extends it to
the ground.*

**5. Transparency buys acceptance even when the output is wrong;
opaque learning gets fought** (Yang & Newman, "Learning from a Learning
Thermostat," 2013). Nest users showed reactance when the thermostat
changed things opaquely and acceptance when its operation was
transparent — *even when the temperature was outside their preference*.
Opaque learning produced workarounds and people fighting their own
thermostat.
*Lesson: show the learned schedule. WAKA's poster is the learned
schedule — what is missing is the loop-level "because" behind it, and
the visible difference between what the person has ratified and what
only the machine believes.*

**6. Memory surfaced as rows is the wrong mental model** (ChatGPT
memory, 2024–2026). The market leader ships memory as a deletable list
of rows over a synthesis, and the complaint literature is exactly the
founder's point: people are surprised what was stored, deleting a chat
does not delete the memory, and "anything from past chats could affect
results in ways that are hard to predict." Managing rows is the
experience; understanding the synthesis is impossible.
*Lesson: WAKA's four layers are already the right shape. The missing
surface is the RELATION — how ground became sky became poster — not a
better row manager. The founder's instinct is the market's open wound.*

**7. The best loop-level lever shipped anywhere is input-scoping**
(Spotify, "Exclude from your Taste Profile," 2023–2025). Not
per-track thumbs: a person marks a playlist (white noise, the kids'
songs) as *not me*, and the taste profile stops reading it — while the
playlist keeps existing. It answers the algorithmic-identity problem
("my Discover Weekly thinks I am ambient rain") with scope, not
deletion.
*Lesson: WAKA lacks exactly this lever: "keep this, but do not read me
from it." A capture, a source, a season of life — held in the field,
withdrawn from evidence, as a rendered state. Fading never deletes;
this is fading's deliberate cousin.*

**8. A vague explanation is worse than none** (Kim et al., "Why Am I
Seeing This Ad?", JCR 2019; NDSS 2018 ad-transparency audit).
Incomplete or misleading explanations — and explanations that reveal
norm-violating flows — reduce trust and effectiveness below the
no-explanation baseline. The platforms' explanation strings are
disconnected from the mechanism, and people can tell.
*Lesson: WAKA's advantage is structural — the rules surface can be
rendered FROM the same drift-locked constants that govern the code, so
the explanation is mechanically incapable of lying. Use that; never
hand-write the loop's description.*

**9. The canonical guideline pair** (Amershi et al., "Guidelines for
Human-AI Interaction," CHI 2019): G11 *make clear why the system did
what it did* and G17 *provide global controls* — validated across
products as the pairing users need. Global customization is a
first-class expectation, not an advanced setting.

**10. Seams, shown on purpose, at the points of consequence** ("Seamful
XAI," CSCW 2024). Strategic seams — showing where the system is
uncertain, where data was transformed, where a limit was hit — beat
both black-boxing and full-internals dumps. Reveal the seam where a
wrong belief would cost the person something.
*Lesson: the loop surface is not a firehose. Show the seams that
matter: what was refused, what is contested, what is unratified, what
is waiting.*

---

## Part 2 — The synthesis, in one paragraph

Nobody wants to read the candidates. Everybody builds a theory of the
loop anyway, and an invisible loop writes false theories that get fed
back as behavior. The systems that earn trust do four things: they show
the *delta* the loop caused rather than its internals; they make
explanation and correction the same surface; they treat the person's
gestures as *law* and keep receipts that the law held; and they scope
what counts as *you* without deleting anything. The systems that lose
trust do the opposite: advisory buttons that decay, explanations
disconnected from mechanism, learning that moves things silently, and
memory managed as rows. WAKA's doctrine already sits on the winning
side of every one of these — the gap is that none of it has a surface.

## Part 3 — The experience for WAKA

The loop's world-name: **the weather.** The field is the ground, the
sky holds the patterns, the poster is what the season amounts to — and
the loop is the weather that moves between them: it can be read, it
can be told as days, and you tend to it rather than program it. (The
GLOSSARY's one-universe rule holds: no dashboards, no knobs, no
sliders.)

Five parts, ordered by leverage:

**A. The pass, told — the weather report** (findings 2, 5, 10).
After each derivation/synthesis pass, one sentence in world voice on
the record: "read two new memories; the sky held." · "a pattern grew a
root." · "refused a candidate — too close to something you dismissed."
Assembled entirely from what the loop already writes (derivation
summaries, explicit no-change versions, Phase 1 consultations, Phase 4
suppressions). On return after time away, the world's existing
pan-the-edge arrival (the Outer Wilds move already in Home) rides this
record instead of a digest — seeing first, telling second, numerals
never. The FeedVis pane lives here as **the antechamber**: on request,
the dim place where read-but-not-kept candidates stand — the delta
view, the single most theory-correcting surface in the literature.

**B. Gestures that legislate, and say so** (findings 3, 4).
Each existing gesture gains one line, at the moment of the act, naming
what it taught the loop — and each is a law with a receipt:
- dismiss → "the ground will refuse anything this close from now on"
  (Phase 4's anchor; the suppression log is the standing receipt);
- a verdict → "this weighs on whether the pattern is spoken";
- the star → "these words are law to the rewrite" (already true,
  already shown — the pattern to copy);
- release → "WAKA may read this one again."
No new controls. The controls exist; they become legible as teaching.

**C. Ratified light on the poster** (findings 5, 3).
The poster's entries already carry roots; add the loop-level "because":
grounds the person has answered (verdict, star) hold full ink; grounds
only the machine believes sit dimmer. One glance separates "what we
have agreed about me" from "what it currently thinks" — the learned
schedule made visible, in the layout's only meaning channel. The
recalibration gesture is then obvious and already exists: answer the
dim ones. **The loop asks; you answer; the light moves.** This is the
GEPA lesson made human — the person edits the metric (their verdicts),
never the candidates.

**D. "Kept, not read" — scope what counts as you** (finding 7).
The one genuinely new lever: mark a memory — later a source, an agent,
a stretch of time — as *kept but not evidence*. It stays in the field
(fading never deletes), renders as a state (a memory the weather passes
over), and the derivation excludes it. Spotify's exclude-from-taste-
profile, landed in WAKA's world. Guards: owner-only, reversible,
logged like a suppression so the silence is legible, and the vocabulary
must never say "hide" or "mute" — the memory is kept; it is simply not
*about you*.

**E. The reading — how WAKA reads you** (findings 8, 9, 1).
The rules page, rendered from the drift-locked constants table so it
cannot lie: "When three of your memories say the same thing, WAKA says
it back as a pattern. A pattern nobody feeds begins to set. Your own
words are never rewritten. When two patterns disagree, both stand until
you settle it." Second person, present tense, no numerals in the prose
beyond the constants the drift test pins into words. One tap from the
poster; the same rendering ships to agents in the wire format, because
the reading contract is the same contract for every kind of mind.

**Cadence:** none of this asks for daily attention. The weather report
accrues silently; the world tells it on arrival; the antechamber and
the reading answer curiosity when it strikes. The loop never notifies —
"the reward for opening it was seeing, and telling first spends that."

## Part 4 — What this changes in Phase 9

Phase 9's three parts stand; this research sharpens them and adds one:
part 2 (the diary) gains the **antechamber** as its request-side view
(the FeedVis delta, built on Phase 4's suppression log); part 3
(gestures named) gains the **receipt** requirement (a law must show it
still holds); part C above (**ratified light**) is added to the phase —
it was implicit in "recalibration through gestures" and the Nest
finding makes it load-bearing; and **"kept, not read"** (part D) is
new scope — small schema (a state on the evidence standing of an
inspiration), one derivation-side exclusion, one rendered state — and
goes to the founder with this document before it is built, because it
touches what "evidence" means.

## Sources

- GEPA: Reflective Prompt Evolution Can Outperform Reinforcement
  Learning (arXiv:2507.19457, ICLR 2026); gepa-ai/gepa (GitHub); DSPy
  GEPA docs.
- Eslami et al., "'I always assumed that I wasn't really that close to
  [her]': Reasoning about Invisible Algorithms in News Feeds" (CHI
  2015); "First I 'like' it, then I hide it: Folk Theories of Social
  Feeds" (CHI 2016).
- Kulesza et al., "Principles of Explanatory Debugging to Personalize
  Interactive Machine Learning" (IUI 2015).
- Kaplan, Sapiezynski et al., Northeastern sock-puppet audit of
  TikTok's "Not Interested" (2026); "Why Am I Still Seeing This"
  (arXiv:2408.11910).
- Yang & Newman, "Learning from a Learning Thermostat" (UbiComp 2013).
- OpenAI memory FAQ + third-party UX critiques of ChatGPT memory
  (2024–2026).
- Spotify Engineering, "Exclude from Your Taste Profile" (2023);
  TechCrunch, track-level exclusion (2025).
- Kim, Barasz & John, "Why Am I Seeing This Ad? The Effect of Ad
  Transparency on Ad Effectiveness" (JCR 2019); Andreou et al.,
  "Investigating Ad Transparency Mechanisms" (NDSS 2018).
- Amershi et al., "Guidelines for Human-AI Interaction" (CHI 2019).
- Ehsan et al., "Seamful XAI: Operationalizing Seamful Design in
  Explainable AI" (CSCW 2024).
