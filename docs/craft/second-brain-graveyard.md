# The second-brain graveyard

Status: research, authored 2026-08-10.
Purpose: WAKA wants to be the default destination for everything a person
wants to keep — notes from a conversation, a conference, a blog post, a
YouTube link. That ambition has a graveyard. This doc names the ways
capture tools and practices actually die, with evidence, and then grades
WAKA's current design against each death: **covered / partial / exposed**.
Method: five parallel research passes over primary sources, shutdown
announcements, churned-user testimony (labeled anecdote where it is one),
and the survivors. Sources at the bottom.

## The verdict on our own hypothesis

The founding worry was "second brains failed because they were outdated and
hard to maintain." Both are real, and both are downstream of one root:
**the payback loop**. An archive rots — feels outdated — when nothing
re-reads it in present tense; it becomes hard to maintain when the human is
the re-reader. Every failure below is some form of a save that never pays
the saver back, and every survivor below has an engine that pays without
asking. WAKA's bet — the system reads so the user never has to — is the
right bet by this record. But the record also says the bet fails two ways:
when returns are hoped for instead of scheduled, and when the machine's
reading loses the user's trust even once. Those are our two exposed flanks.

One folklore warning up front: no rigorous public number exists for "% of
notes never revisited" — "90% of notes are never reread" and "70% of saved
links are never opened" both circulate unsourced. What primary data does
exist is narrower and sharper: Instapaper's 2013 disclosure that
two-thirds of users who act on a save do so 3–5 days after bookmarking,
and Pocket's 2013 data putting a saved article's median lifespan — time to
90% of the opens it will ever get — at 37 days. Everything else is
testimony, dated shutdowns, and a few company disclosures — strong enough
to design against, not strong enough to quote as statistics.

---

## Part 1 — The seven deaths

### 1. Saving feels like knowing (the collector's fallacy)

The canonical diagnosis is Christian Tietze's 2014 essay: "'to know about
something' isn't the same as 'knowing something'" — the save produces the
feeling of the work without the work, so the pile grows while understanding
doesn't. Casey Newton, after years of Roam and Notion hoards: "I waited for
the insights to come. And waited. And waited." Dan Shipper's "The Fall of
Roam": "we got a garbage dump full of crufty links and pieces of text we
hardly ever revisit." The end state is Joan Westenberg deleting 10,000
notes spanning 7 years: "my second brain became a mausoleum… Instead of
accelerating my thinking, it began to replace it."

Mechanism: the save is a promissory note, "later" is the promised payment,
and the user is the one who has to pay it. Guilt compounds; the user flees
the guilt, not the tool.

### 2. "Later" never comes without an engine

Browser bookmarks are the control group: zero friction to save, no
resurfacing engine, and 80%+ never revisited (blog-grade numbers, but
directionally undisputed; Pew found people save news "for later" only 4% of
the time and rarely return). Instagram saves and TikTok favorites show the
same shape — capture thrives, deliberate retrieval ~never happens.

The read-it-later category supplies the only primary numbers in this doc,
and they define the payback window: reads happen soon or effectively
never (Instapaper: engagement clusters 3–5 days post-save; Pocket: 37-day
median lifespan). After that window a pure capture tool has no re-entry
trigger except guilt, and guilt drives avoidance — the queue grows
monotonically, so the product degrades with loyalty. Readwise wrote the
category's epitaph in its own founding post: "your inbox runneth over,
turning your digital garden into a digital graveyard," churning would-be
power users "after a few weeks or months." "Come back whenever" is come
back never. Every tool that actually gets returns manufactures them:
Readwise's daily review (spaced repetition over your own highlights,
resurfacing as recall probability decays), Anki's scheduler, Pinterest's
feed, iOS Memories resurfacing the camera roll. The return visit is
triggered by the product, not by user virtue.

### 3. The maintenance ritual is where users break

Every methodology has a processing step, and the processing step is where
every methodology dies. Zettelkasten dies at literature-notes → permanent
notes ("an insurmountable number of unprocessed notes — it's a digital
mess"). GTD and PARA die at the weekly review ("they stop reviewing… The
guilt spiral begins"; one user built PARA in Notion and "abandoned it
within two weeks — twice"). Digital gardens die at tending — Maggie
Appleton's own garden-history page reads "last tended about 5 years ago."
Setup is the fun part and a procrastination trap in itself: three weeks of
plugins and CSS "without actually writing a single meaningful note."

Who sustains maintenance? Only people with an output valve that *consumes*
the notes: Luhmann was a salaried professor producing sociology daily
(5–6 notes/day, and he "liked to cultivate the myth that the box — not he —
produced the books"); Ryan Holiday's notecards exist to manufacture
specific books; Anki survives 200–400 reviews/day for two years because
med boards are dated and existential — and attrition follows the exam.
Gwern's data point: under 0.5% of casual spaced-repetition users continue
past a first session. Maintenance survives stakes; it never survives
virtue. Andy Matuschak's razor over the whole genre: "People who write
extensively about note-writing rarely have a serious context of use."

### 4. Auto-organization defers the tax to retrieval time, as trust

The AI generation promised to delete death #3 — and mostly converted it
into a subtler one. You pay nothing at save-time and everything the first
time the system visibly misfiles or misses something you know you saved.
mymind users searching "Red Chair" and getting nothing; Mem "making
changes to the wrong note"; Ask Rewind lacking "the accuracy needed for
reliable use." One reviewer named it precisely: "The core problem is
trust. MyMind asks you to trust its search and AI categorization instead
of your own organizational system." One visible failure poisons the whole
corpus, because the user can't audit what the AI did.

The pattern across the generation is stark: **every auto-organizer
retreated from passive resurfacing to user-initiated retrieval.** Mem 1.0
(ambient self-organizing, $110M valuation) relaunched as Mem 2.0 with
auto-sync and ambient features killed, replaced by chat-on-demand. Rewind
(record everything, $350M valuation) pivoted to a meetings pendant — the
one context where retrieval is predictable — then sold to Meta, which
killed the product the same day. Napkin, whose whole thesis was AI
resurfacing your own ideas, retreated to a small iOS reflection app.
Nobody shipped resurfacing good enough to interrupt you correctly. WAKA is
betting the direction everyone retreated from. That is either the moat or
the repeat — decided entirely by reading quality and auditability.

### 5. The archive outlives the self

Westenberg again: "a dusty collection of old selves, old interests, old
compulsions." Roam veteran josephg on HN: "Brains forget for a reason,
roam doesn't… the system becomes a junkyard of half-formed thoughts."
This is the real mechanism behind "outdated": not that content ages, but
that identity drifts while the archive stands still, so retrieval surfaces
a person you no longer are. Tools with eternal graphs age into mausoleums;
gardens normalize their own staleness with "last tended" stamps. The only
structural antidote observed: surfaces that speak present tense — rereading
the archive through who you are now (iOS Memories, Readwise resurfacing,
are.na blocks recontextualized by new connections).

### 6. Nobody notices a solo archive decay

Solo tools have no one who notices neglect, so neglect is free. The
survivors all have witnesses. Notion escaped the second-brain trap by
selling team coordination — colleagues are the deadline that keeps pages
alive (individual:company mix went 90:10 → 50:50 in 2023; the "beautiful
dashboard" solo use case churned). are.na has survived ~12 years with no
pivots because **other people are the resurfacing algorithm**: a block
displays every channel strangers have connected it into, so your save gets
recontextualized by other people's taste, and the gardening tax is
distributed across channel collaborators. Pinterest's group boards are the
mass-market proof, and their shape is striking: 98% of group boards have
≤5 people, 77% are exactly two — weddings, renovations, trips. Sublime
solved day-one emptiness socially: the first save immediately returns
related saves from the community. Solo AI tools are empty mirrors on day
one; social ones have something to show before you own anything.

### 7. The business dies around the archive

Trust shocks, not gradual decay, mark the churn inflection points:
Evernote's 2013 breach, the 2016 privacy-policy fiasco, the 2023 Bending
Spoons repricing (Personal $69.99→$129.99/yr, free tier capped at 50
notes) — each a dated event that converted simmering dissatisfaction into
exodus. Logseq lost its community to a 4-year rewrite and its cofounder's
own words: "it's unacceptable that Logseq still loses data." And when the
company dies, the archive dies with it. Pocket's shutdown (2025) exported
a bare CSV of URLs — the full-text Permanent Library that premium users
had paid for was not exportable at all, and community tooling scrambled
to rescue article text before permanent deletion. Omnivore (2024) gave
users roughly two to four weeks before deliberate data deletion; one
user's reaction stands for the lesson: "If I were on an extended
vacation… my data would be gone." Destination apps proved to be
custodians, not vaults — and users remember.

The funding pattern is its own finding. Dead or pivoted: Mem ($110M
valuation), Rewind ($350M), Roam ($200M seed valuation, no round since).
Alive: are.na (~18,000 paying members funding six people, "we grow
slowly"), Reflect (5 people, profitable, one $120/yr plan), Readwise
(bootstrapped on purpose for a market they sized honestly at "8-9
figures"), Obsidian (no VC, ~7 people, revenue from optional sync).
Personal memory generates revenue that a venture-scale cost structure
cannot service; every product priced above its natural revenue died of
the gap. Obsidian's Steph Ango stated the durable trust position:
"Obsidian will eventually become obsolete" — so notes are plain files the
user owns ("File over app"). The survivors sell membership in something
built to outlast them, or at least to exit gracefully.

### Read-it-later: the category study

**Pocket** (2007, as Read It Later; Mozilla's first acquisition, 2017;
shut down July 8, 2025). Mozilla's stated reason — people's saving habits
"evolved" — papers over the loop that never worked: the save button sold
relief, the queue sold guilt, and Premium monetized permanent storage of
the unread pile. The user testimony is uniform: "this became yet another
place for my bookmarks to go to die"; "around 500 links that I've never
got to read… I didn't even know where to start"; "a virtual junk drawer…
time never really freed itself up and content just kept piling in." At
death, even export betrayed: URLs only, not the archived text people had
paid to keep.

**Omnivore** (2021; open-source, donation-funded — about $7,400 lifetime;
shut down Nov 2024 in an ElevenLabs acqui-hire). No business model, and
infrastructure that "parsed every new webpage — a large percentage of
which would never actually be read": the economics of hoarding, borne by
the operator. Its code being open source softened but did not prevent
the archive loss.

**Instapaper** (2008; passed through betaworks and Pinterest, spun back
out 2018). Neither died nor grew: small, paid, independent, low burn. It
now feeds on the category's corpses — a surge of Pocket imports the day
of the announcement, and the Kobo e-reader integration Pocket vacated.
Its 2013 disclosure is the category's honest measurement: engagement
clusters 3–5 days after the save, then decays.

**Matter** (YC S20, $7M Series A, 2021). Alive by serial pivot: social
feed stripped out, then audio, then AI summaries — value migrating step
by step from "read it later" toward consumption that demands no
willpower. The pivots are the finding: the pure save-then-read loop did
not retain.

**Readwise Reader** (2021+) is the counter-move that proves the
diagnosis: paid from day one, triage that treats deletion as success
(read now / later / never), and the Daily Review resurfacing your own
highlights on a decay schedule (items return as recall probability
drops). It sells memory, not storage — and it absorbed the category's
power users when Pocket fell.

---

## Part 2 — Why the survivors survive

Ranked properties, strongest first. A tool needs several; none of the
dead had more than one.

1. **Saving is itself the reward.** Pinterest, 600M MAU: users save ~6.7
   pins per visit; pinning and browsing are the same pleasurable act, so
   the collection never becomes deferred work or guilt. UC Berkeley
   research with Pinterest found 10 min/day of inspiration-seeking
   buffered burnout in Gen Z. The save must be consumption, not a
   promissory note.
2. **The system manufactures the return.** Readwise's daily review (auto-
   imported highlights, spaced repetition, arrives by email — maintenance
   cost ≈ zero, and aggregator estimates put >60% of users touching it,
   flagged unverified); Anki's scheduler; Pinterest's feed; iOS Memories.
   An appointment beats an open door.
3. **Concrete, dated stakes.** The Anki condition: 86%+ of US med
   students, 200–400 reviews/day sustained for years — because the exam
   is real. The only condition under which humans sustain maintenance,
   and it expires with the stakes.
4. **Other people keep it alive.** Notion teams, are.na channels,
   Pinterest two-person boards: an audience makes decay visible and
   return social. Solo = death row.
5. **Data trust and portability.** Obsidian's files, the camera roll:
   people commit years of material only where loss and lock-in feel
   impossible. Retains deeply but narrowly — it prevents leaving more
   than it causes returning.
6. **Zero-friction capture at the impulse moment.** Screenshots (~2,000+
   photos in the average camera roll; a DIS 2023 study catalogs nine
   capture motivations), one-tap saves, pins. Necessary and NOT
   sufficient — bookmarks have it and are the deadest archive of all.
7. **Identity and community.** Obsidian's plugin culture, Anki's
   med-school ecosystem, are.na's "It doesn't produce anxiety" ethos —
   sustains a niche core through rough edges; a moat, not a growth engine.

The sharpest contradiction in the set: Notion, the app most associated
with abandoned solo second brains, is the biggest business of all — by
selling coordination instead of memory. And the null hypothesis worth
keeping in a drawer (Newton's): maybe every organizing scheme is simply
outmatched by the infinite feed it competes with.

---

## Part 3 — The pre-mortem: how WAKA dies each death today

Graded against what is actually shipped or locked as of 2026-08-10:
capture-asks-nothing with out loud/held (shipped), walls of six notes with
the first-six defect (`wall-that-evolves.md` Steps 1–4 planned, Step 1
built-unmerged), the wow engine (bounded candidates, background
best-effort), readings-of-a-signal (spec'd), the metabolism-game direction
(brainstormed 2026-08-09, not yet a doc).

**Death 1, saving feels like knowing — COVERED, conditionally.** The
thesis inverts the fallacy: a save is a pulse (a signal about you), not a
deferred reading assignment, and the system does the reading. No surface
presents a backlog; nothing gatekeeps a save; TOM always emits. The
anti-guilt discipline is already written law ("no counters age, no badge
reddens"; "a ritual that renags is a chore list"; a pass counts as
sat-with). The condition: this holds only while the readings are good.
The moment walls read as generic, a save quietly reverts to being a
promise nobody keeps — death 1 returns wearing death 4's clothes.

**Death 2, no return engine — EXPOSED. The biggest one.** We chose
event-driven returns over any scheduled cadence. The graveyard is
unambiguous here: every surviving loop manufactures its return (daily
review, scheduler, feed), and "come back whenever" tools die regardless
of capture quality. Today WAKA's returns depend on wow moments (generated
best-effort, failures swallowed) and wall changes (which require room
activity — and currently don't even fire on member arrival). Solo
cold-start makes it worse: few pulses → few wows → no reason to return →
no pulses. The metabolism-game direction (unread walls, heartbeat,
unopened bridges) builds the right *event* engine; the record says we
also need at least one *manufactured beat*. We already own a latent one:
the /sit invitation is a designed-no-guilt daily ritual, and a
first-reading digest ("what your pulses were read as this week") is a
second candidate. Two sharper constraints from the primary data: the
payback window is days wide — a save's first payment (a first reading, a
bridge, a wall picking it up) has to land within days, not whenever the
graph gets around to it — and WAKA must stay on the right side of the
monotonic-queue law: the dead tools degraded with loyalty (bigger pile,
worse product), while WAKA's surfaces must visibly improve with volume
(more pulses, better readings, richer bridges). This is a founder
decision to revisit, with this evidence on the table.

**Death 3, the maintenance ritual — COVERED, best in the graveyard, one
residual.** Nothing asks the user to file, tag, link, review, or prune —
the entire tax the methodologies died of is absent by design, and the
reflection system is invitation-only with passes recorded. The residual:
the wall's refresh button makes a human ask the product to think
(`wall-craft-plan.md` B1 already flags it) — asking users to run the
metabolism is a chore in embryo. Re-reads must become automatic on the
events that matter (new saves, arrivals). Watch item, not a violation:
reflection prompts must never accumulate into an inbox; today they don't.

**Death 4, the retrieval-time trust tax — PARTIAL, the second flank.**
WAKA is structurally the thing every predecessor retreated from: an AI
that passively reads and resurfaces. What we hold that they didn't:
readings cite their evidence (rows with quotes and faces — the audit
trail mymind users begged for and never got), model output is labeled as
what it is (the machine goes unnamed; "A QUESTION FROM THIS PULSE"), and
keep/cut is a native correction verb with cut-rate already designated a
health metric. What's missing: correction isn't yet everywhere a reading
appears (walls, readings, wows should all take "this is wrong" as cheaply
as TOM does), and wow quality has no evaluation loop — operational
failures are swallowed as best-effort, which is right for uptime and
silent about mediocrity. The rule the record dictates: never ship a
reading that can't show its receipts, and never let a wrong reading be
unanswerable. One visible unexplained miss starts the corpus-wide trust
decay; a correctable miss is just a conversation.

**Death 5, the archive outlives the self — PARTIAL.** Our surfaces are
present-tense by design: walls re-read as the room changes, TOM
dissolves, Pulls are supposed to drift with the person. That is the
structural antidote the dead tools lacked. Two live risks. First, walls
that don't actually change — our own doc admits one room circling a
single idea, and the wall shows the first six notes, not the best six;
Step 3 is the anti-staleness work, not a nicety. Second, the solo
archive: years of pulses will contain old selves, and nothing should ever
make the user re-meet the pile raw — resurfacing must always pass through
present context (the wow engine's freshness term and Pull drift carry
this; keep it true as surfaces multiply).

**Death 6, the solo death — COVERED in architecture, EXPOSED at
activation.** Rooms are precisely the survivors' prescription:
distributed maintenance (the room's wall is nobody's chore), witnesses
(decay is visible), and social resurfacing (a stranger's connection
recontextualizes your save — are.na's exact mechanism, which our
readings-of-a-signal surface mirrors). Pinterest's board data validates
the wedge: two-person rooms are the natural unit; we should build for
two before twenty. The exposure is day one: a user with no rooms and few
pulses is holding an empty mirror — the failure that killed the Mem
generation's activation. Sublime's answer (first save returns the
community's neighbors) suggests ours: the solo surface has to pay back on
save #1 (first reading, first bridge to your own past), and joining or
starting a two-person room has to be nearly day-one.

**Death 7, the business dies around the archive — EXPOSED, with known
fixes.** Three sub-exposures. (a) *Trust shocks:* refresh currently
destroys wall history in production — our own class of Evernote-2013
event, already built, sitting unmerged; Step 1 is not infrastructure, it
is churn prevention. (b) *Unit economics:* ~20 AI calls per wall pass
with only a timer guarding it is the Mem cost curve; Step 2 (skip
unchanged passes) is the fix and is small. (c) *The exit door:* asking
people to make WAKA the default destination for everything they keep
means eventually answering "what if WAKA dies" — the Pocket/Omnivore
lesson, and Obsidian's counter-position. An export that preserves pulses
and readings isn't a launch requirement; it is a prerequisite of the
"default destination" claim at any real scale. On revenue shape: the
survivors of exactly our category are membership-priced, small, and
"grow slowly" on purpose (are.na is the closest kin in soul and
economics). Worth saying out loud: the graveyard's valuations died of
the gap between memory revenue and venture cost structure.

---

## Part 4 — House rules this research dictates

Checkable, and mostly already ours; the new ones are marked. The build
plan that enacts rules 1–6 is `docs/goals/metabolism-game.md`.

1. **A save is never a debt.** No unread piles, no inbox counts, no
   surface that presents the archive as work owed. (Already law.)
2. **The system reads so the user never must.** No processing step may
   ever stand between a save and its value. (Already law.)
3. **One manufactured heartbeat, minimum.** Pure event-driven return is
   the graveyard's most repeated death; pick one scheduled beat — /sit
   as the daily invitation, or a weekly first-reading digest. (NEW —
   founder decision to revisit.)
4. **Every reading shows receipts and takes correction.** Evidence rows
   everywhere model output appears; keep/cut as a universal verb; a
   wrong reading must be answerable in one tap. (Half-law — extend to
   walls, readings, wows.)
5. **Present tense only.** Surfaces re-read the archive through who the
   person and room are now; a wall unchanged for a month is a defect
   (ship Step 3), not stability. (Direction locked; Step 3 pending.)
6. **Other people are the resurfacing algorithm.** Two-person rooms are
   the wedge; arrivals trigger re-reads; a save's return-payment is
   partly other hearts beside it. (Architecture locked; arrival re-read
   and activation path pending.)
7. **Never break the archive's trust.** Ship Step 1 now; no data loss,
   ever; changes to what rooms can see are announced, never discovered;
   an export door before we ask anyone to move their keeping here at
   scale. (Step 1 pending merge — urgent.)
8. **Stay revenue-sized.** Cost per reading bounded (Step 2); membership
   over extraction; growth rate chosen, not suffered. (NEW — business
   posture, founder's call.)

---

## Sources

PKM / note graphs: every.to/superorganizers/the-fall-of-roam ·
news.ycombinator.com/item?id=30320977 · news.ycombinator.com/item?id=44023423 ·
platformer.news/why-note-taking-apps-dont-make-us (Aug 2023) ·
jasonkincaid.net/2014/01/evernote-the-bug-ridden-elephant ·
blakeir.com/evernotes-ceo-on-the-companys-long-tricky-journey-to-fix-itself ·
techcrunch.com/2023/11/27/evernote-pushes-users-to-upgrade ·
sifted.eu/articles/bending-spoons-italy-startup-ipo ·
forbes.com (Bending Spoons, Jul 2026) · retentioncheck.com/blog/evernote-churn-analysis ·
discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744 ·
solanky.dev/p/logseq-migration-journey · investing101.substack.com/p/i-wish-i-knew-how-to-quit-roam-research ·
oh-kayyyy.medium.com (Notion abandoned three times) · theinformation.com (Roam $200M seed)

Methodology: zettelkasten.de/posts/collectors-fallacy ·
notes.andymatuschak.org (serious context of use) ·
joanwestenberg.com/i-deleted-my-second-brain ·
chrisaldrich.wordpress.com/2023/02/03 (cargo cult) ·
brennan.day/what-have-note-taking-pkms-accomplished-really ·
forum.zettelkasten.de/discussion/1069 & /3034 ·
digitalorganizationdad.substack.com (literature-notes breakdown) ·
super-productivity.com/blog/gtd-weekly-review-guide ·
fortelabs.com/blog/why-i-will-no-longer-teach-building-a-second-brain ·
forum.obsidian.md/t/the-para-method-and-the-hard-facts-of-life/22279 ·
maggieappleton.com/garden-history · sashachapin.substack.com/p/notes-against-note-taking-systems ·
nesslabs.com/productivity-porn · ryanholiday.net (notecard system) ·
writing.bobdoto.computer/zettelkasten · gwern.net/spaced-repetition

AI memory / social curation: get.mem.ai/blog/introducing-mem-2-0 &
/mem-2-dot-0-transition-guide · techcrunch.com/2024/04/17 (Rewind pivot) ·
9to5mac.com/2025/12/05 (Meta acquires Limitless) ·
andrewschreiber.substack.com (Rewind early adopter) ·
blog.saner.ai/mymind-reviews · arslan.io/2023/01/30 (mymind review) ·
pins.substack.com/p/sari-azout · sublime.app · kernelmag.io/3/charles-broskoski-interview ·
are.na/editorial/on-pricing · fannyvassilatos.com/getting-friendly-with-are-na ·
artnews.com (doesn't produce anxiety) · nesslabs.com/reflect-app-featured-tool ·
napkin.one · techcrunch.com/2025/02/03 (Tana) · fabric.so/posts/meet-fabric

Survivors: stephango.com/file-over-app · blog.readwise.io/why-were-bootstrapping-readwise ·
fortelabs.com/blog/interview-with-readwise-founders ·
fueler.io (Readwise estimates, unverified) · ncbi.nlm.nih.gov/pmc/articles/PMC12662189 (Anki med) ·
my-senpai.com/insights/ankiburnout · research.contrary.com/report/notion ·
taptwicedigital.com/stats/notion · socialmediatoday.com (Pinterest Q3 2025) ·
medium.com/pinterest-engineering (pinner progression; retention) ·
business.pinterest.com/blog/positivity-research-pinterest-berkeley ·
madpinmedia.com (group boards) · dl.acm.org/doi/10.1145/3563657.3596067 (screenshots, DIS 2023) ·
reallifemag.com/screen-memories · photoaid.com/blog/mobile-photography-statistics ·
linkamatic.com/blog/why-bookmarks-fail · medium.com (Instagram saves paradox)

Read-it-later: en.wikipedia.org/wiki/Pocket_(service) ·
9to5mac.com/2025/05/22 (Pocket shutdown) · support.mozilla.org/kb/future-of-pocket ·
news.ycombinator.com/item?id=44063662 & 41985118 (user postmortems) ·
github.com/ArchiveBox/pocket-exporter (export betrayal) ·
fastcompany.com (37-day lifespan, Nov 2013) · niemanlab.org 2011 & 2013
(Read It Later / Pocket engagement data) · blog.omnivore.app (joining
ElevenLabs; shutdown details) · techcrunch.com/2024/10/29 (Omnivore
acqui-hire) · creativerly.com (Omnivore postmortem) ·
blog.instapaper.com/post/61764950884 (3–5 day window) ·
techcrunch.com/2021/10/06 (Matter Series A) ·
blog.readwise.io/readwise-reading-app (digital-graveyard diagnosis) ·
docs.readwise.io (recall half-lives) · facilethings.com (why I stopped
using Pocket)
