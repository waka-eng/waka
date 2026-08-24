# Goal: every workflow works, the way a person performs it

Status: **Phase 2 passed (2026-08-22).** Phase 3 next.
Branch: `claude/repo-sync-qlndc3`. Base `dev` @ `c6a64b2`.

**What this goal owns:** does each workflow actually work, end to end, proven
by driving it rather than by reading it.

**What it does not own:** the craft of those workflows — the migration into the
world, the palette, the menu, the doorway. That is
[`docs/goals/everything-in-the-world.md`](everything-in-the-world.md), and where a finding belongs there
this goal names it and hands it over rather than repeating it. A workflow can
be beautiful and broken; it can also work and be ugly. Two goals, because they
fail in different ways and are measured differently.

## Why

**The API is well covered. The product is not covered at all.**

Six end-to-end harnesses exist and they are good — `organic`, `signals`,
`top-of-mind`, `groups`, `cold-start`, `principles`. Each drives the real
stack: real Postgres, real queue, real model. Between them they prove that a
client calling the API gets a memory system back.

Every one of them speaks HTTP. **Not one opens a browser.** So what is proven
is that the workflows work the way `waka-mcp` performs them, and what is
unproven is that they work the way a person does — through a canvas, a menu,
a form, a keyboard, a phone. The 2026-08-22 audit found that gap the
expensive way: the world rendered as a black rectangle for anyone whose
network could not reach a font CDN, while every API suite would have stayed
green, because the API was fine. The product was gone.

Three more things follow from the same shape:

1. **Five of the six suites are not registered as scripts.** `package.json`
   has `e2e:organic`, `e2e:first-paint` and `e2e:fixtures`; `signals`,
   `top-of-mind`, `groups`, `cold-start` and `principles` run only as raw
   `pnpm tsx tools/e2e/<name>.ts`. A gate nobody can name is a gate nobody
   runs.
2. **Some workflows have no prover at all** — Google OAuth, attachments and
   image description, account deletion, connection revocation, the public
   profile page.
3. **One workflow does not exist.** There is no password recovery: no route,
   no token table, no mail transport. It cannot be proven because there is
   nothing to prove. Owned by `everything-in-the-world.md` Phase 4, deferred there pending
   a mail provider, and named here so the inventory is honest.

## The inventory

Every workflow, and what proves it today. **"API" means proven over HTTP and
unproven in a browser.**

| # | Workflow | Proven today by |
|---|---|---|
| A1 | Sign up → onboarding → first capture | API + **Browser** (`journeys:cold-start`) ✅ |
| A2 | Sign in / sign out, email + password | API (`organic`) |
| A3 | Sign in with Google | **nothing** — needs OAuth configured; blocked on a founder decision, not on effort |
| A4 | Password recovery | **does not exist** — unproven because there is nothing to prove: no route, no token table, no mail transport. Deferred by founder decision 2026-08-24 pending a provider. The only row here that can lock a real person out |
| B1 | Capture text | API + **Browser** (`journeys:keep`) ✅ |
| B2 | Capture a link, enriched from its page | API (`organic` step 7) ✅ — was wrongly logged unproven; see the 2026-08-22 correction |
| B3 | Capture an image, described so it is searchable | by URL: API (`organic` step 8) ✅. Real upload (presign→PUT→HEAD): **proven 2026-08-24 against the stub** (`erasure` step 1–2) — the object lands, enrichment reads it back. Nothing about S3's own IAM or durability |
| C1 | Search and recall across the archive | API + **Browser** (`journeys:seek`) ✅ |
| C2 | Open, edit, delete an inspiration | API + **Browser** (`journeys:let-go`) ✅ |
| C3 | Reflect on an inspiration | **Browser** (`journeys:reflect`) ✅ |
| D1 | Captures become signals; promotion at 3 evidence | API (`signals`) |
| D2 | Lock, edit, let go a signal | API (`signals`) |
| D3 | Cascade when the evidence under a signal is deleted | API (`signals`) |
| E1 | Top of mind synthesised, versioned, citations resolve | API (`top-of-mind`) |
| E2 | Entry actions — read again, say in my words, not this, undo | **Browser** (`journeys:entry-actions`) ✅ 2026-08-24 — and proving it found all four unreachable on every desktop; see finding 18 |
| F1 | Principles minted nightly under the five tests | API (`principles` step 6), **partly, and flaky by nature** — 2026-08-24. The row overstated itself until then: the step skips unless the stack carries four overrides, so the suite printed 5 passed and F1 read as proven while the path had never run. A pass proves the promotion path end to end; it fails about one run in two because the distiller returns no candidate, which no wait fixes — so this is a diagnostic, not a gate, and its failures now name their own cause. **Minting from nothing stays unproven**: step 2's declaration collides with the fixture by design, so the judge matches and redeems rather than minting |
| F2 | Declare a principle — both destinations | API (`principles`), fixed 2026-08-22 |
| F3 | Edit, reorder, delete; `principles.md` renders | API (`principles`) |
| G1 | Create a room, join by code | API (`groups`) |
| G2 | Share a signal in; **the evidence must not cross** | API (`groups`) |
| G3 | Room top of mind by proposal and approval | API (`groups`) |
| G4 | Leave, close a room; join code rotates on removal | API (`rooms`) ✅ 2026-08-24 — 9 checks, no model calls: removal re-keys and leaving does not, the old key is dead, and a removal reaches no further than the room it named |
| H1 | Agent profile: its own stack, its own capture | API (MCP live gate) |
| H2 | Cross-profile permission matrix | API (MCP live gate) |
| I1 | Terminal consent, credential binding | API (MCP live gate) |
| I2 | Capture and recall from a terminal | API (MCP live gate) |
| J1 | Rename, locale, make a public page | **Browser** — rename (`journeys:account`) ✅ and the public page (`journeys:public-page`) ✅ 2026-08-24, read as an anonymous stranger with the raw capture searched for by phrase. Locale still unproven |
| J2 | List and revoke connections | API (`connections`) ✅ 2026-08-24 — 7 checks, no model calls |
| J3 | Delete the account | API (`erasure`) ✅ 2026-08-24 — 11 checks, including the bytes, the room's own artifact, and that the bystander keeps everything |
| K1 | The world renders on a hostile network | Browser (`first-paint`) ✅ |

~~Twenty-one proven at the API. One proven in a browser. Seven by nothing.~~
**After Phase 2: eight proven in a browser** (seven journeys plus
`first-paint`), five still proven by nothing (A3, B3, E2, J2, J3), one
nonexistent. Every browser row carries a negative control.

## Budget

Model spend, because these harnesses call Gemini for real. `tools/e2e/README`
prices a full pass of four suites at "well under a dollar"; six plus the MCP
live gate should stay in the same order.

| Phase | Expected | Actual |
|---|---|---|
| 1 — run the six suites + MCP live | ~1 full pass, < $2 | ~1 pass + 1 principles re-run; within estimate |
| 2 — browser harness (no model calls beyond setup) | < $1 | negligible; journeys never call the model |
| 4 — re-runs after fixes | ~2 passes, < $4 | — |

**Running total: ~1 full pass of all suites plus one re-run.** Stop and report if any phase exceeds double its
estimate.

---

### Phase 1 — Run what already exists

Nothing is written in this phase. Six suites exist, are documented, and have
never been run in this line of work. Run them, and the MCP live gate, and
find out.

- `pnpm tsx tools/e2e/organic.ts --fixture-port 8791` (needs
  `WAKA_ENRICHMENT_ALLOWED_HOSTS` set for the fixture host)
- `pnpm tsx tools/e2e/signals.ts`
- `pnpm tsx tools/e2e/top-of-mind.ts`
- `pnpm tsx tools/e2e/groups.ts`
- `pnpm tsx tools/e2e/cold-start.ts`
- `pnpm tsx tools/e2e/principles.ts`
- `pnpm test:live` in `waka-mcp`

**Every failure is triaged into exactly one of two buckets, with its output
quoted in the log: a product defect, or a harness defect.** That distinction
is the whole value of this phase and it is the one that gets skipped under
pressure — "the suite is flaky" is not a bucket.

**Gate:** all seven pass, **or** every failure is triaged with evidence and a
named owner. Passing is not required to proceed; *knowing* is. A suite that
cannot be run at all (missing fixture, missing bucket) is recorded as
unproven rather than counted as passing.

### Phase 2 — A harness that opens a browser

The gap this goal exists for. `tools/e2e/first-paint.ts` is the pattern:
Playwright, numbered PASS/FAIL, non-zero exit, driven against a stack serving
the production build.

Extend it into `tools/e2e/journeys.ts` covering the workflows a person
performs and no API suite can reach:

- **A1** cold start in a browser: sign up, onboarding, first capture, the
  empty world (`#262` made the empty wall say something — nothing proves it)
- **B1** capture, and the confirmation that it landed (finding 7's gate)
- **C1/C2** find a memory again; edit it; delete it and get it back
- **E2** the entry actions and their undo (`putEntryBack`)
- **J1** rename, locale switch, publish a page
- Keyboard traversal and the accessible-name floor at each step. This was
  written to double as the craft goal's accessibility work; that work is now
  out of scope by founder decision, so it stands alone here — it is a
  regression check on the names that exist, not a claim that the world is
  usable without sight

**A journey is only added with a case that fails first.** Where the workflow
already works, the failing case is constructed by breaking it (as
`first-paint` withholds a chunk) — a green-on-first-run browser assertion
proves the harness ran, not that it works.

**Gate:** each journey above drives in a browser and its case demonstrably
fails against a deliberately broken build. A journey that only ever passes is
removed rather than kept as decoration.

### Phase 3 — The workflows nothing proves

Stand up what is missing so the unproven rows become provable:

- **B3 attachments.** Needs a bucket. Local S3-compatible storage or a
  documented skip — but a skip is recorded in the inventory as unproven, not
  quietly dropped.
- **A3 Google OAuth.** Needs a client. Decide whether it is provable in CI at
  all; if not, say so once, in the inventory.
- **C3 reflections, J2 connections, J3 account deletion.** Plain API
  workflows with no harness. Account deletion is the sharp one — it is
  irreversible and nothing tests it.
- **G4** join-code rotation on member removal, which `groups.ts` covers only
  partially.

**Gate:** every row in the inventory reads *proven by <name>* or *unproven,
because <reason>*. No row is blank.

### Phase 4 — Fix what the proofs found

Product defects from Phases 1–3, closed in severity order, each with the case
that fails before the fix. Findings already owned by `everything-in-the-world.md` are
handed there and named here rather than fixed twice.

**Gate:** every defect closed, or logged with a reason and the conditions
that would reopen it. No defect leaves this goal unnamed.

### Phase 5 — Keep it proven

- **Register the five unregistered suites** as `pnpm e2e:*` scripts. A gate
  nobody can name is a gate nobody runs.
- **Wire the browser gates into CI**: `e2e:first-paint` and `e2e:journeys`.
  These are the ones that catch what unit suites structurally cannot, and
  neither runs automatically today.
- **Model-spending suites stay manual** unless a key exists in CI — recorded
  as a decision, with what it costs to leave them out.

**Gate:** the browser gates run in CI and fail on `c6a64b2`. Every suite is
reachable by a named script.

---

## Rules

1. **Proven means driven, not read.** A workflow is proven when something ran
   it and would have failed if it broke. Reading the route is not proof.
2. **A case that has never failed is not a case.** Every assertion added here
   demonstrates its own failure before it is trusted — the standard
   `first-paint` was held to.
3. **"Flaky" is not a triage bucket.** Every failure in Phase 1 is a product
   defect or a harness defect, with output quoted.
4. **Unproven is a valid outcome and a recorded one.** A workflow that cannot
   be tested here says so in the inventory with its reason. Silence is what
   this goal exists to remove.
5. **No phase widens.** Craft findings go to `everything-in-the-world.md`. This goal proves
   things work; it does not redesign them.
6. **Spending is a checkpoint.** State expected calls before a phase that
   spends; stop at double.

## Log

### 2026-08-22 — written

Inventory built from the route surface (31 route modules), the six e2e
harnesses, the MCP live gate, and the 2026-08-22 experience audit. Counted:
21 workflows proven at the API, 1 in a browser, 7 by nothing, 1 nonexistent.

The structural finding that justifies the goal: every existing harness speaks
HTTP and none opens a browser, so the black-rectangle defect of 2026-08-22 —
the entire product missing for anyone behind a blocked CDN — would have left
all six suites green.

### 2026-08-22 — Phase 1 run: 45 steps passed, 2 failed, both triaged

Every suite, against a real stack with `GEMINI_API_KEY` set.

| Suite | Result |
|---|---|
| `cold-start` | **1 / 1** |
| `signals` | **6 / 6** |
| `top-of-mind` | **8 / 8** |
| `groups` | **9 / 9** |
| `principles` | **6 / 6** (with the documented overrides; 5 + 1 skip without) |
| `organic` | 6 / 8 — steps 7 and 8 failed |
| `waka-mcp` live gate | **9 / 9** |

**45 passed, 2 failed, 0 unexplained.**

Two results are worth more than their line in the table:

- **`groups` 9/9 includes step 5, "no group surface exposes another member's
  raw capture."** The audit listed the sharing boundary as read-but-never-
  driven and flagged it as the highest-stakes unaudited surface. It is
  driven, and it holds — the check greps *every* group response for a phrase
  only the other member captured. Step 9 also proves an agent-bound session
  cannot reach a wall at all.
- **`principles` step 6 now passes** — captures → signals → top of mind → a
  minted principle, **with 3 citations**, in 9.8s under
  `WAKA_PRINCIPLE_MIN_SPAN_OVERRIDE=0`, `WAKA_PRINCIPLE_MIN_TOM_OVERRIDE=1`,
  `WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER=1`. This is the deepest path in the
  product and it had never been run in this line of work.

#### Triage of the two failures — harness, not product

    FAIL 7. a saved link is enriched from the page body (90.5s)
         Timed out after 90000ms (61 attempts) … last seen: status=pending kind=null
    FAIL 8. a saved image is enriched from what it depicts (90.5s)
         Timed out after 90000ms (61 attempts) … last seen: status=pending kind=null

**Cause: no attachments bucket in this environment.** Enrichment runs on
attachments; attachments require S3. `attachments.ts:212` refuses without
`ATTACHMENTS_BUCKET`, and `signal-enrichment.ts:614` throws
`attachments_bucket_unconfigured`. The database agrees — **zero rows in
`attachments`**, and no `enrich_attachment` job was ever enqueued. Nothing was
broken; nothing could start.

**But there is a real harness finding inside it, and it is not "flaky".**
`organic.ts` already carries a written message for exactly this condition
(`:608`, `:802` — "the stack under test has no attachments bucket
configured"), yet steps 7 and 8 reach a 90-second timeout instead of
surfacing it. The operator gets two red FAILs, no reason, three minutes gone.
`principles.ts:187-188` shows the repo's own answer — detect the missing
prerequisite and `SKIP` with the reason. Steps 7 and 8 should do the same.
Filed for Phase 3, where B3 gets a bucket or a recorded skip.

**Gate verdict: PASS.** The criterion was "all seven pass, **or** every
failure is triaged with evidence and a named owner." 5 of 7 suites are clean,
the 6th is clean but for two steps whose prerequisite is absent, and that
prerequisite is named with the line numbers that enforce it. Nothing is
unexplained. Proceed to Phase 2.

#### Inventory rows now proven

B2 stays unproven (needs the bucket). B3 unproven, same reason. Everything
else in rows A1–A2, C1–C2, D1–D3, E1, F1–F3, G1–G4, H1–H2, I1–I2 is proven at
the API by a suite that ran today. **G4's join-code rotation is covered by
`groups` after all** — step 8 proves a non-member cannot tell the group
exists; the rotation-on-removal case is still worth confirming separately in
Phase 3.

### 2026-08-22 — Phase 2: `tools/e2e/journeys.ts`, 7 journeys, 7/7 both ways

The first harness in this repo that drives the product as a person does.
Seven journeys, each with a `breaks` function that sabotages the one call it
rests on, and a `--negative` mode that runs every journey against its own
sabotage and **requires it to fail**.

    positive   7 passed, 0 failed
    negative   7 passed, 0 failed   (every journey failed when broken)

| Journey | Positive | Under sabotage |
|---|---|---|
| cold-start — signup, and the world is standing there | `canvases=1 emptyStateSpeaks=true` | `canvases=0 emptyStateSpeaks=false` |
| keep — acknowledged, and there afterwards | `acknowledged=true persisted=true` | `false / false` |
| seek — found again by a word from inside it | `found=true` | `found=false` |
| reflect — survives a reload | `survivedReload=true` | `false` |
| let-go — actually gone | `goneFromArchive=true` | `false` |
| account — a new name survives a reload | `readBack="Renamed …"` | `readBack="Journey Tester"` |
| a11y-floor — every control can be named | every visible control named | `1 unnamed: button.?` |

#### Two things the gate caught that a green run would have hidden

**1. A defect I nearly filed against the product.** The `reflect` journey
failed with "keep this too" permanently disabled, even with the answer field
full. It looked exactly like a product bug: an affordance that invites you to
write and will not let you keep it. It is not. `Surface.tsx:2147` reads
`disabled={!reflectionQuestion.trim()}` — a reflection here is **two** fields,
a question the person writes for themselves and their answer to it, and the
button is gated on the first. The harness was filling only the second.
**Harness defect, and it is written at the site** so the next reader does not
repeat the diagnosis.

**2. A hole in an assertion, found only by the negative run.** `a11y-floor`
passed under `--negative` — decoration, by this goal's own rule. The first
sabotage stripped labels on an interval and lost the race against React's
re-render. Replacing it with the *real* regression shape — inject one visible
unnamed button — still passed, and that second failure was the informative
one: the assertion filtered visibility with `offsetParent === null`, which is
null for **every `position: fixed` element**. A fixed unnamed control was
invisible to the check whose entire job is finding unnamed controls. Now
measured from `getBoundingClientRect()` plus computed style.

Neither would have surfaced from a green positive run. That is the argument
for `--negative` existing, made by `--negative`.

**Gate verdict: PASS.** The criterion was "each journey drives in a browser
and its case demonstrably fails against a deliberately broken build; a
journey that only ever passes is removed rather than kept as decoration." All
seven fail under sabotage. Nothing was kept as decoration — `a11y-floor` was
reported as decoration and earned its place back by being fixed, not by
having its sabotage weakened.

#### Also done

`e2e:journeys` is registered in `package.json`. Three `[...NodeList]` spreads
became `Array.from` so the file typechecks without `dom.iterable`.

#### Still unproven after Phase 2

A3 Google OAuth · B3 attachments (no bucket) · E2 top-of-mind entry actions
and undo · J2 connections · J3 account deletion · J1's locale switch and
public page. Phase 3 owns them.

### 2026-08-22 — Phase 1's triage was WRONG, and here is the real cause

**Correction, stated first because the wrong version is written above.** Phase
1 recorded `organic` steps 7 and 8 as failing for want of an attachments
bucket. That was wrong, and re-reading the harness is all it would have taken:
step 7 calls `attachLink` — `type: "link"`, a URL, no object store touched —
and step 8 calls `attachImageByUrl`, whose own doc comment says it "needs no
object store, so the enrichment steps can run against a plain local stack."
The bucket was never involved. The evidence I cited (zero rows in
`attachments`) was real and meant something else: `organic` erases its
accounts on the way out unless `--keep-data` is passed.

**The real cause is the model budget, and the harness competes with itself for
it.** `MODEL_BUDGET_JOBS_PER_ACCOUNT` is **60 per rolling hour**
(`lib/model-budget.ts:45`). Step 4 buries its marker under **205 filler
captures**, each enqueuing a `derive_signals` job. Measured on the run:

    account 2b6c75a3…   derive_signals 212   enrich_attachment 2   started_in_window 60

Sixty is exactly the cap. On hitting it the drain calls
`deferAccountBacklogForBudget` (`queue.ts:1015`), which moves that account's
**entire** due backlog — both enrichment jobs with it — to the next window
boundary. All 155 pending jobs shared one `run_after`, `07:00:08.135`, about
an hour out. Steps 7 and 8 then waited 90 seconds for work scheduled for the
next hour.

Proof, same stack and code, only the filler changed:

| `--filler` | step 7 | step 8 |
|---|---|---|
| 205 (default) | FAIL after 90.4s | FAIL after 90.4s |
| 12 | **PASS in 1.5s** | **PASS in 1.5s** |

**Enrichment was never broken.** B2 was working the whole time and this goal
recorded it as unproven for a day.

**Fixed** by giving steps 7 and 8 their own accounts — a fresh budget for the
two jobs they need — with the measurement written at the site. `organic` now
passes **8 of 8 at default settings**, which it had never done here.

#### What this says about the harness, beyond the bug

A 90-second timeout could not distinguish "enrichment is broken" from "this
account is over its model budget and everything it owns is deferred for an
hour" — and the second was visible in the database the whole time: the job
existed, `pending`, `run_after` an hour out, `attempts = 0`. This is the same
shape as the Phase 1 finding about the missing-bucket message: the harness
times out where it could name the condition. Filed for Phase 3.

#### The S3 work landed anyway, and is honest about what it is for

I built `lib/s3-client.ts` and `tools/e2e/s3-stub.ts` to fix steps 7 and 8.
They did not fix them, because those steps never needed a bucket. Both are
kept because they make a **different** row provable — B3, the real upload path
(`attachImage`: presign → PUT → HEAD → finalize), which nothing exercises and
which genuinely does need an object store. `lib/s3-client.ts` also collapses
four byte-identical copies of the region ladder into one.

The stub verifies no signatures and stores objects in memory. B3 will be
recorded as **proven against a stub**, never as proven outright.

### 2026-08-24 — the three rows that said "nothing"

J2, J3 and E2 were each proven by nothing. All three are now covered, and one
of them turned out to be broken.

#### J3, erasure — 11 passed

The highest-stakes path in the product, and the failure is invisible by
construction: the person is gone, they cannot check, and every surface 404s
whether or not the work was done. `lib/account-erasure.ts` makes five promises
and three of them fail quietly — the bytes going FIRST while the rows still
list them (the rows are the only inventory), the group artifact deleted
EXPLICITLY because a cascade cannot reach a room's own top of mind, and no room
left without an owner.

`tools/e2e/erasure.ts` drives two people, a shared room, a real uploaded image
and a synthesised room artifact that actually cites the leaver, then erases one
account and checks all five — plus the failure in the other direction,
over-deletion, by holding the bystander to the same standard. The last step
searches seven surfaces for a phrase that exists in exactly one capture on the
stack, because a field check only ever finds the leak you thought of.

    bytes HEAD 404 · the citing entry gone · the room still owned ·
    the bystander's 3 memories and 2 signals untouched

#### J2, connections — 7 passed

A revoke that returns 200 and leaves the token working is the entire failure,
and every screen would keep saying the connection ended. No model calls, so
there is no reason it should not run on every change. The two that matter
most: revoking actually stops the token rather than just deleting a row, and a
stranger's revoke answers 404 — the same answer a nonexistent id gets, because
a 403-here-404-there difference is an oracle that hands out real session ids
one guess at a time.

#### B3, the real upload — proven on the way

Erasure needs a real object to delete, so it takes the whole path: presign,
PUT, the object landing in the store, enrichment reading it back. Against the
stub, which verifies no signatures — the row stays honest about that.

#### E2 — and the bug that writing it found

All four entry actions were `opacity: 0; pointer-events: none`, revealed by
`.jar-hq:hover .jar-board-acts`. `.jar-hq` carries `pointer-events: none` so
the world underneath stays draggable, and **an element that takes no pointer
cannot match `:hover`**. On every desktop, the four things a person can do
about the one sentence the machine concluded about them — read it again, keep
this one up, say it in my words, not this — were in the DOM and unreachable.

That is finding 14 exactly, in a second place. Fixing finding 14 patched
`.jar-edge` and never swept the file for the other rule that shared the
selector; one grep would have found it. Recorded as finding 18.

The fix also had a second half that would have shipped silently:
`pointer-events` INHERITS, so dropping the parent's `none` was not enough —
with nothing declared the children inherit it and stay unclickable while
looking perfectly fine.

**So the gate asserts hit-testing, not style.** `elementFromPoint` at each
control's own centre must come back as that control. The `--negative` run
proves why: under the original rule three of the four report **opacity 1**,
because the sabotage sits on the parent. An opacity check would have passed.

    positive   4 entry actions, all hit-testable; "read it again" previews
               its consequence
    negative   "READ IT AGAIN" cannot be hit at its own centre (opacity 1) …

#### What is left

A3 (Google) needs OAuth configured — blocked on a decision, not on effort. A4
(password recovery) does not exist and waits on a mail provider. J1's locale
and public-page halves, and G4's rotation, remain partial.

### 2026-08-24 — G4, and the exits nobody had walked

`groups.ts` proves what crosses between people while everyone is still in the
room. It never changes the membership, so every question about the EXITS was
untested and G4 sat at "partial" with no reason attached.

`tools/e2e/rooms.ts` — 9 checks, no model calls, so there is no reason it
should not run on every change.

**The one that needed an end-to-end proof.** A join code does not expire and
`joinGroupByCode` asks only whether the code matches, so deleting a membership
row ends a person's access to nothing at all: anyone removed who had ever seen
the invite link walks straight back in, indistinguishable from a normal join.
`rotateJoinCode` handles it and has a unit test — which proves a new code gets
written, and says nothing about whether the OLD one stopped working. This
suite holds the code from before the removal and tries it afterwards: 404.

And the asymmetry is checked in both directions, because getting it backwards
is also a bug. **Leaving does not re-key** — it is voluntary, the person may be
asked back, and rotating there would kill the invite link in every other
member's hands for no security gain. The suite leaves, confirms everyone else's
code still works, and asks the leaver back in with the code they already had.

**The removal that reached too far.** `group_top_of_mind_affirmations` has no
`group_id` column, so a delete keyed on the profile alone once meant "their
votes anywhere" — removing someone from a room you own withdrew their
agreements from rooms you cannot read and that were never named in the
request, leaving nothing to tell that apart from "they never voted". The suite
puts the same person in two rooms, removes them from one, and checks they are
still among the people who agreed in the other.

**A check that was passing without asserting anything.** The first version of
that step compared `affirmations` to a number. It is an ARRAY — of *who*
agreed, because states render and numerals never — so `array < 2` coerced to
`NaN < 2`, which is false, and the step passed vacuously. It names the person
now, which is both correct and stronger than a count.

#### Where the inventory stands

Every row now reads *proven by <name>* or *unproven, because <reason>* — which
is Phase 3's gate. The two that remain unproven are unproven for reasons no
harness can fix:

- **A3, Google** — needs a client configured. A decision, not effort.
- **A4, password recovery** — there is nothing to prove. No route, no token
  table, no mail transport. Deferred by founder decision pending a provider,
  and the only row here that can lock a real person out of their own memory.

### 2026-08-24 — the suite pass, and a row that had been overstating itself

All five model-spending suites run, on the merged branch: `cold-start` 1/1,
`signals` 6/6, `top-of-mind` 8/8, `groups` 9/9, `principles` 6/6. `groups`
passing also confirms lifting `mintAgentToken` into `organic.ts` did not break
its original caller, which was the one risk in that move.

#### F1 was reading as proven while its proof had never run

`principles` step 6 — *promotion: months of signals mint a held principle* —
**skips unless the stack is booted with four env overrides.** The suite then
prints "5 passed, 0 failed", and the inventory row for F1 read `API
(principles)` as though the promotion path were covered. It was not. A skip
that reports itself honestly is still a skip, and a row that reads the summary
line instead of the step list will believe it.

Booted with the overrides, the step **failed** — 184s, `principles: 2,
minted+held: 0`.

#### Two wrong diagnoses before the right one, and the third run is what found it

Worth writing down in order, because the first two were confident.

**First: "the documented override set is incomplete."** All three bars — SPAN,
SIGNALS, TOM — take env overrides through the same `bar()` helper, and the
suite's header named two. True, and a real trap for the next reader, so it is
fixed. It was **not** the cause: a re-run with all three failed identically.

**Second: "the assertion demands a duplicate the design prevents."** The
trigger had logged `status: evaluated, attached: 3, redeemed: 1, minted: 0` —
`distill` judges each candidate against the principles already standing, and
when one is the SAME it attaches the citations there and redeems an
aspirational one rather than minting a near-duplicate. The collision is
genuine and by design: step 2 declares *"Have something working before you put
more money in"* and the fixture says *"I cap spending until something ships"*.
So the assertion was widened to what the step's title claims — a principle
**held on its evidence**, by either road, reporting which.

It passed in 6.4s. **And the confirming run failed again at 184s**, which is
the only reason that explanation did not get committed as the answer.

**Third: the step raced a bar it never waited for.** Two failing runs logged
`status: below_bar` — no model work at all — against `evaluated` on the one
that passed. `computeCitationEligibility` gates on three things and the third
is **top-of-mind appearances**: how many distinct top-of-mind versions a citing
signal has been selected into. Waiting for signals to go active satisfies the
first two and says nothing about the third. It waits for the artifact now.

**Fourth: the suite held out for a stricter bar than the one under test.** It
waited for three active signals because `PRINCIPLE_MIN_SIGNALS` is 3 — while
talking to a stack where that bar is overridden, which is the only reason the
step can run at all. So it depended on the model grouping a fixed set of
captures into exactly three signals rather than two; one run stalled at two for
four full minutes. It reads the same override the server reads now.

**And then, with all four fixed, it still failed about half the time.** The
next failing run logged `status: no_candidates`: the bar passed, the distiller
ran, and the model returned nothing from the same fixture. Across eight runs
all three statuses appeared — `below_bar`, `no_candidates`, `evaluated`.

#### Where this lands: flaky by nature, and now honest about it

Three of the four fixes removed real harness faults and stay. The residual is
the model, and no wait fixes it, so two things changed instead.

**It asks three times, with a pause.** A single trigger is not what production
does — the nightly cron asks again every night, and a theme that yields no
candidate tonight yields one later. That is a faithful simulation of a
recurring job, not a retry hiding a failure.

**And a failure now names its own cause.** The trigger answers 202 and logs its
verdict server-side, so the suite cannot read it — which is why every diagnosis
above needed the server log beside it, and why two of the four wrong answers
were confidently reached. A failure now reports what it could see:

    no principle became held after three passes — active signals: 3 (bar 1),
    top-of-mind entries: 3, principles: [declared/aspirational/0cit, …].
    Everything the bar needs was present, so the distiller returned no
    candidate this time — which it does, and no wait fixes.

Measured after all of it: **still roughly one failure in two.** That makes this
unsuitable as a blocking gate and useful as a diagnostic, which is what the F1
row says. A pass proves the promotion path end to end; a failure of this shape
is the model declining, not a regression.

#### What four wrong turns have in common

Each was a confident reading of the evidence in front of me, and the evidence
in front of me was a bare timeout. The verdict that would have settled it in
one step existed the whole time — in the server's log, not the suite's output.
That is the lesson worth keeping: **a gate that cannot say why it failed will
be diagnosed wrongly, repeatedly, by whoever is most sure they understand it.**
