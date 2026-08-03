# Design research: products that tell you something about yourself

Gathered 2026-08-03. Findings and mechanisms, deliberately not recommendations —
the previous rounds jumped to a design position and six of six were rejected.

## Note on method

Two kinds of source. Sections 1–9 are written analysis, research papers and
product documentation. Section 0 below is **measured**: eight current Awwwards
Site-of-the-Day winners, fetched and their stylesheets read directly. Typeface
names and hex values are counted from the source, not described from memory.

What reading source cannot give: composition, motion, and how any of it feels
in sequence. Screenshots of work you admire would still close that gap.

---

## 0. What award-winning sites are actually built from

Measured from the stylesheets of eight current Awwwards Site-of-the-Day
winners: 2xa.studio, bymonolog.com, 21hrs.space, vectrfl.com, dragonfly.xyz,
depoluxe.xyz, glitchandgrit.com, normalisboring.es.

### Typefaces

| Site | Faces |
|---|---|
| dragonfly.xyz | **FK Roman Standard** (575 uses) · NON Natural Grotesk · NON Natural Mono |
| bymonolog.com | **Khteka** · Animo · **Suisse Mono** |
| 2xa.studio | **Geist** sans + Geist Mono |
| 21hrs.space | **Futura Std** · **Akkurat Mono** |
| vectrfl.com | **Söhne Buch** |
| depoluxe.xyz | **EB Garamond** |

**Two observations.**

**A three-role system is the norm, and WAKA already has its shape.** Dragonfly
runs serif + grotesk + mono; bymonolog runs primary + secondary + mono; 2xa
runs sans + mono. WAKA's Instrument Serif / Inter Tight / JetBrains Mono is
structurally the same idea.

**The faces are not.** Söhne, FK Roman Standard, Khteka, Suisse Mono, Akkurat,
NON Natural — independent foundry licences, chosen deliberately. Instrument
Serif and Inter Tight are both free Google Fonts, and Inter in particular is
the most-used interface face on the web. *The structure is right; the
specificity is missing.*

### Colour — the sharpest finding

Counted hex values across the same eight stylesheets:

**Grounds are cool and near-neutral.** `#f2f2f2` · `#e6e6e8` · `#fcfcfc` ·
`#f5f4f2` · `#efeeec` · `#fafafa`

**Darks carry a blue bias, not a warm one.** `#050419` · `#020420` · `#1c1c1c`
· `#252729` · `#080807`

**Every site has exactly one loud, saturated accent:**
`#3932dc` indigo · `#fa4c14` orange · `#0000fe` pure blue · `#ff5100` safety
orange · `#ec39b6` magenta · `#5014fa` violet

That is the pattern: **a quiet cool ground, and one accent that is genuinely
loud.** Not a palette of five agreeable tones — one colour doing all the work,
usually near full saturation.

**WAKA is the inverse on both axes.** The ground is warm parchment `#f4f2ee`;
there are five muted pastels and no accent at all. The one saturated colour in
the product — the salience gold — appears at 26% opacity, which is the only
place a real accent could have lived.

### One craft detail worth stealing

bymonolog ships optical trim tokens:
`--font--primary-trim-top: .33em` / `--trim-bottom: .38em`. Per-face
compensation for the gap between a font's box and its actual letterforms, so
vertical rhythm is measured from the type rather than from the em box. That is
the level of care the "high craft" label refers to.

---

---

## 1. Co-Star — the closest analogue to WAKA's payoff

An astrology app whose product is one short statement about you per day.

**Mechanisms**

- **Deliberately stark against its own category.** Black ground, white text,
  blunt language — positioned against the pastels and mystical imagery every
  other astrology app used. The aesthetic itself was the differentiation.
- **One notification per day.** A hard constraint that creates anticipation
  rather than a feed to check.
- **Voice does the personalisation work, not visuals.** Analysts attribute the
  "it's talking to me" feeling to the tone — "fresh, quirky, sometimes
  extremely brutal" — more than to any visual mechanism.
- **Screenshot-native.** The daily insight became a Twitter meme format. The
  artifact was shaped to leave the app.
- **A social object.** People open it together and talk over it, rather than
  consuming it alone.

**Cost:** the brutal voice is polarising, and reviewers note the AI-generated
insights vary in quality. Restraint means a bad day is very visible.

**Where WAKA sits:** same payoff shape — a short statement about you — with the
opposite aesthetic stance. WAKA's parchment-and-serif is the *conventional*
look for reflective software, where Co-Star's black was a rejection of its
category's convention.
[analysis](https://medium.com/demagsign/how-the-design-of-the-astrology-app-co-star-is-conquering-the-masses-d6b6d235c806) ·
[critique](https://ixd.prattsi.org/2022/02/design-critique-co-star-iphone-app-2/)

---

## 2. Spotify Wrapped — data reframed as identity

**Mechanisms**

- **Reframing, not reporting.** Not *"you listened to 47,283 minutes"* but
  *"you spent 788 hours finding yourself."* Identical data, and the framing is
  the entire product.
- **Design the shareable artifact first**, then build the experience around it.
  Aspect ratio, type and contrast are chosen knowing it will be a story post
  within seconds.
- **It showcases the user, not the brand.** People spread it because it
  represents *them*.
- **Annual, not continuous.** Scarcity makes it an event.

**Where WAKA sits:** WAKA produces the same class of artifact — a sentence
about who you are, derived from your own behaviour — continuously rather than
annually, and with no thought given to whether it can leave the product.
[analysis](https://uxplaybook.org/articles/spotify-wrapped-ux-design-lessons) ·
[Spotify's own case study](https://ourcasestudy.byspotify.com/2022wrapped-design)

---

## 3. Calm technology — the vocabulary for restraint

Weiser and Seely Brown, Xerox PARC, 1995; codified by Amber Case.

**Mechanisms**

- **The periphery is the default position.** Technology sits at the edge of
  attention and moves to the centre only when it must, then returns.
- **"A person's primary task should not be computing, but being human."**
- **Restraint is care, not omission.** The design question is *"what can we
  leave out?"* rather than *"what else can we add?"* — every element earns its
  place.
- **The HVAC test:** when the system works, you simply feel comfortable and
  never think about it.

**Where WAKA sits:** relevant to the founder's stated position that a top of
mind *not* shifting is itself signal — this is the literature for designing
something that is allowed to be quiet.
[principles](https://principles.design/examples/principles-of-calm-technology) ·
[calmtech.com](https://calmtech.com/)

---

## 4. Rewind / Limitless — memory products, and how they fail

The closest commercial analogue to a personal memory archive.

**Mechanisms**

- **Ask, don't browse.** Recall is natural language: *"what did John say about
  the budget on Tuesday?"* There is no archive view as a destination.
- **Latency is a design property.** Reviewers distinguish 320ms (feels instant)
  from 1.2s (feels sluggish) — for a memory product, speed *is* the experience.

**Failure modes reviewers name:** reliability and polish — inconsistent
transcription, weak non-English support, battery drain. Not features. The
criticism is never "it needed more surfaces."

**Where WAKA sits:** the same ask-don't-browse conclusion the PKM literature
reaches independently. WAKA's search is a box at the bottom of the screen.
[reviews](https://www.producthunt.com/products/rewind-2/reviews) ·
[analysis](https://agent-finder.co/reviews/limitless)

---

## 5. Confidence and trust calibration

Directly relevant to "how long has this reading held up."

**Mechanisms**

- **Map uncertainty to a decision, not a number.** A percentage is not a
  design; what the person should *do* differently is.
- **Signals, reasons, escape hatches, safe defaults** — the four parts of a
  confidence UI that people actually trust.
- **Confidence over time is shown as a band or overlay**, not a static score —
  prediction plus its interval, so change is visible.
- **The named failure mode:** teams build an accurate model, wrap it in an
  interface that communicates *false certainty*, and users trust it completely
  until the first visible error, then abandon the feature entirely.

**Where WAKA sits:** every reading is currently presented at identical
confidence. The system computes `reconfirmedNoteIds` — which readings a pass
reached again — and discards it. That is the raw material for exactly this
pattern, thrown away each run.
[confidence UI](https://medium.com/@Modexa/the-confidence-ui-pattern-that-users-actually-trust-ff27e1a8a956) ·
[Google PAIR](https://pair.withgoogle.com/chapter/explainability-trust/) ·
[agentic patterns](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns)

---

## 6. Day One — resurfacing as the most-loved feature

**Mechanisms**

- **"On This Day"** surfaces entries from previous years. Users describe it as
  the best part of journaling — perspective no other tool provides.
- **Rich media makes revisiting vivid.** Photos from the day are why looking
  back works.
- **Capture is frictionless and separate from reflection.** Opening and writing
  takes seconds; looking back is a different mode.

**Where WAKA sits:** WAKA has the raw material for resurfacing — every save is
dated, and the timeline now resolves any past board — and no feature that
brings the past to you unprompted. The rail requires you to go operate it.
[features](https://dayoneapp.com/features/)

---

## 7. Claim–evidence interfaces

- **PaperTrail** decomposes an answer and its sources into discrete claims and
  evidence, mapping which assertions are supported, unsupported, or absent from
  the sources. Built on *overview first, zoom and filter, details on demand*.
- **EvidenceLens** replaces citation footnotes with a **triage view**, so a
  claim backed by several sources reads differently at a glance from one
  resting on a single soft text span.
- The general pattern: exposing what a system relied on turns output from
  *trust me* into *check me*.

**Where WAKA sits:** salience just shipped at 13% coverage. The triage idea —
making "this part is pinned, that part is inferred" visible at a glance — has
no equivalent.
[PaperTrail](https://arxiv.org/html/2602.21045v1) ·
[EvidenceLens](https://arxiv.org/pdf/2606.23724) ·
[six patterns](https://medium.com/@markusnissl/designing-for-intelligence-six-patterns-for-ai-driven-interfaces-a84136b78184)

---

## 8. Two voices in one document

- Systems distinguish text by **source** (user-written vs machine) and by
  **voice** (content vs text-about-text) — a two-axis model.
- **Separation reinforces the writer as decision-maker**; blending blurs
  authorship. Where suggestions appear in the user's own workspace, ownership
  gets murky.
- **The AI ghostwriter effect:** people do not *feel* ownership of
  machine-written text while still declaring themselves the author.

**Where WAKA sits:** the reflections surface sets the machine's question larger
than the person's answer, with no visual distinction of authorship.
[co-writing](https://arxiv.org/pdf/2504.12488) ·
[Who owns the text?](https://arxiv.org/pdf/2601.10236) ·
[ghostwriter effect](https://arxiv.org/pdf/2303.03283)

---

## 9. Archives past a few hundred items

- Past a few hundred, **the problem stops being organisation and becomes
  retrieval**. A large archive with weak retrieval is "only a storage habit."
- Search, questions, backlinks and review cycles replace the folder tree.
- Semantic search over keyword; hybrid for names, dates and titles.

**Where WAKA sits:** the founder's stated design target is hundreds of saves a
year in. The current surface is a scrollable list.
[8,000 notes at scale](https://www.dsebastien.net/personal-knowledge-management-at-scale-analyzing-8-000-notes-and-64-000-links/)

---

## Patterns that recur across all nine

Stated as observations, not recommendations.

1. **Voice carries personalisation more than visuals do.** Co-Star's analysts
   and Wrapped's both land here independently.
2. **Reframing beats reporting.** The same data, said differently, is the
   product.
3. **Scarcity creates weight.** One notification a day; once a year. Every
   analogue that produces a statement about you rations it.
4. **Restraint is the stated principle in every one of them** — and each pays a
   price for it, most visibly when the output is bad.
5. **Memory products converge on ask-don't-browse**, from two independent
   directions.
6. **Resurfacing unprompted is what people love**, and it is the one mechanism
   WAKA has the data for and no feature.
7. **Confidence shown badly destroys trust faster than being wrong does.**

## Questions this raises, which I am not answering here

- WAKA's aesthetic is the *conventional* one for its category, where the
  closest analogue won by rejecting its category's convention. Is that a
  deliberate position or an inherited one?
- Every analogue rations its statements. WAKA produces six at once, on demand.
- Nothing in WAKA ever arrives. The founder chose "go and get" — every
  reference here that produces a statement about a person does the opposite.
- Confirmation over time is computed and discarded. Every confidence pattern
  found treats that as the primary material.

## What research is still missing

- **Visual reference.** I cannot see the sites you named. Screenshots from you
  would close this.
- **Any user other than the founder.** Every finding here is literature.
- **The material itself.** Whether these four people are surface-different and
  deep-shared is answerable by reading the 63 saves, and nobody has.
