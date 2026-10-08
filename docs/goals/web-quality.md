# Web quality and intuitive use

Status: in progress (2026-10-08). Web implementation merged and deployed to dev; human and operational acceptance remain open.
Branch: `codex/web-quality`, based on dev `043b07ec`.

## Objective

Implement the [web quality plan](../plans/2026-10-07-web-quality-roadmap.md),
prioritizing simplicity and intuitiveness. Keep the entire five-batch objective:
baseline/prototypes, Home/Capture, return visits, reliability/AI usefulness and
human/operational acceptance. Native capture stays paused in its own checkout.

## Gates

1. Baseline: inspect the current built app at desktop and narrow widths, with
   fresh/returning/large synthetic profiles; record reachable actions, task steps,
   screenshots and failures. Prototypes must address specific observed friction.
2. First minute: one obvious Capture/Continue-draft action, stable labeled
   navigation and a helpful empty state. Plain text saves without choosing
   reflection. Audience stays visible; failed/uncertain saves preserve input.
3. Return visits: Review separates normal navigation from deletion; evidence,
   corrections and optional chat operations are progressively disclosed.
   Search, copied links and Back restore the intended item/place. Keyboard,
   touch, narrow layouts and both supported locales remain usable.
4. Dependability/usefulness: exercise write-boundary failures with no input loss
   or duplicate writes; measure deployed timing separately from local fixtures.
   Compare raw-capture-to-reading/chat quality against identical baseline cases,
   preserving the existing >=90% qualitative bar and critical safety cases.
5. Human/operations: observe the five first-time tasks without coaching and
   report completion/help/wrong turns. The proposed target is 4/5 unaided for
   each task with no accidental public share or deletion through navigation.
   Verify exercised deployment recovery/alerts, provider/source policy and actual
   recurring spending controls. Missing human/cloud evidence keeps this open.

## Verification and limits

Use targeted API/web checks and real built-browser journeys. Database writes
use an explicit disposable loopback database and synthetic identities. Model
networking is disabled for initial UI work. Reconcile the existing USD 5
evaluation ledger before any paid batch; unknown dev charges remain reserved.
Production, real-account mutation and provider administration are separate
actions. User authorization to implement all removes per-batch approval pauses.

## Log

### 2026 10 07 start

The previous planning turn made progress: it saved the detailed implementation
plan and recorded native deferral. The owner now requests implementing all.
Verified origin/dev and local dev both resolve to `043b07ec`; created a managed
worktree and `codex/web-quality`. The native checkout and uncommitted changes
remain present. Dependencies install from the unchanged lockfile.
Baseline/prototype gate starts with the existing real-auth/Hono/SQL fixture.

### 2026 10 07 baseline and prototype gate

Built dev `043b07ec` with real authentication/Hono/SQL, deterministic provider
fixtures and an explicitly verified loopback database. Six desktop/390px walks
cover an empty profile, a three-inspiration returning profile and a 2,000-item
archive. Draft return passes 6/6. All six composers expose two completion
choices, Save and Save & think further. The empty profile exposes Review even
though its hint says to save first; Inspirations has no visible empty-archive
entry. Principles and the archive move between section-specific signposts.

The [Home/Capture prototype](../craft/evidence/2026-10-07-web-quality-prototype.html)
proposes a stable labeled navigation row, a focused empty state and one Save
completion action. It is a design artifact, not application acceptance evidence.
Current screenshots and measured inventories are under `work/web-quality/baseline`.
Verdict: baseline/prototype gate passes; first-minute implementation is next.

Retained failures: the first driver used wrong case for Continue your draft
and timed out; corrected the selector without changing the draft assertion.
A fixture seed initially omitted schema search_path, so its trigger rejected
the statement; the explicit loopback schema retry inserted exactly 1,997 rows.
No provider or hosted-account calls were made.

### 2026 10 07 first minute gate

Criterion: one Save completion action, stable named destinations, visible
audience, preserved drafts and ordinary Back behavior.

The composer exposes one completion action in 4/4 desktop/390px inventories,
down from two in every baseline. Home uses a stable Home/Inspirations/Principles/
Find row; the empty state gives one capture invitation and omits unusable Review.
Archive loading/retry and exact/capped counts remain accessible. The companion's
activity narration is separate from the Capture action.

Two real-auth/Hono/SQL journeys confirm one inspiration each after a double
click, zero duplicate writes, zero automatic reflections, explicit optional
Reflect and search reopening of the exact saved words. Four candidate draft
returns pass; navigation to field/sky, Home, Find and browser Back pass at both
widths. Audience remains Only me and its explanation remains visible. Current
screenshots were inspected; receipts are in `work/web-quality/candidate`.

Web typecheck/build and the full vocabulary/seam/design checks pass; 859 web
tests across 117 suites pass. Added behavior checks cover save-without-reflection,
pending-save refusal and real-router section/Back transitions. Existing archive,
loading and narration assertions remain; their selectors follow the new controls.
The first broad run caught missing archive states and narration, plus unused
translations and noncanonical identifiers. Fixed those without weakening gates.
Verdict: first-minute gate passes locally. Deployed timing and human comprehension
remain open; no provider call or deployment occurred. Return visits are next.

### 2026 10 07 return visits gate

Criterion: separate deletion from Review navigation, disclose occasional chat
actions and evidence, keep reflection completion clear and preserve keyboard/
Back/source ownership behavior.

Review keeps Reflect/Next visible and moves Remove under native item actions,
retaining confirmation and revision fencing. Reflections expose Save thought;
a confirmed save stays visible without requesting a question. Explore another
question explicitly requests it. Principle editing/ordering appears only after
selecting the words. Chat groups correction/takeaway actions and reference cards
behind labeled disclosures; explicit rewriting/adoption still governs takeaways.

Two real-auth/Hono/SQL desktop/390px journeys pass save, double-click protection,
explicit reflection, save-before-question, one explicit question request, exact
search reopening, Review Next retention, keyboard disclosure/escape and chat
reference/correction access. Four draft-return/navigation inventories pass.
The provider fixture made two reflection and two conversation calls, with zero
external provider requests; these are behavior checks, not AI quality evidence.
The actual profile language setting drives two additional Korean layouts at
320×568 and 390×844. All four navigation targets remain inside the viewport and
at least 44×44 pixels; one Save action and readable drafts were inspected.
The synthetic profile's English preference was restored afterward.

The browser walk reproduced loss of keyboard ownership after a focused action
disappeared. DialogSurface now reclaims body focus during active-sheet transitions;
it preserves focus in an editor or another explicit target. Escape after Review
advance and after nested item actions passes. A real-DOM regression covers that
loading transition. Fixed a driver race by awaiting the actual question/message
POST receipt before asking the deterministic fixture worker to process it.

Verification: 862 web tests across 117 suites pass, web types/build and manual
driver types pass, vocabulary/seam/design checks pass. A standard React event
prop, onClickCapture, has one documented vocabulary exception; product capture
identifiers remain refused. The Principle-control edit initially used the wrong
state name; corrected it to the existing selection after types/render checks
failed. Current screenshots and numeric receipts remain under
`work/web-quality/candidate` and `work/web-quality/locales`.
Verdict: return-visits gate passes locally. Live AI usefulness, write-fault and
deployed timings, human tasks and operating safeguards remain required.

### 2026 10 07 dependability and quality checkpoint

Four actual write-boundary cases pass: request loss, loss of both create/replay
responses, offline save and second-file upload failure. Draft words remain,
each recovery keeps exactly one inspiration, and reload does not create another.
The transport's bounded same-identity replay remains intact; after both responses
are lost, the durable receipt settles without a third POST. Upload retries keep
both attachments and only two stored objects. The first driver incorrectly
expected a failed socket response to remain unresolved even after the client's
existing reconciliation; forced browser aborts exercise the intended uncertain
state instead of weakening the write invariant.

Observed signed-PUT defect: all three same-origin upload attempts carried the
WAKA cookie. Explicit `credentials: omit` fixes it. The repeated real-browser
check measures zero cookies/authorization, exact image/png, 68 bytes and the
same SHA-256 for original, failed and retried PUT bodies. No payload or audience
policy changed. This is a browser contract check, not native File Transfer acceptance.

The fixed 24-case live chat baseline passes 24 structural/23 qualitative cases.
The observed miss declared an actual course/family conflict and ruled out a small
trial without confirming overlap/duration. A bounded prompt repair preserves
conditional tradeoffs and consistent Korean conversational endings. Identical
inputs/digest on the candidate pass 24 structural/24 qualitative cases, with zero
critical safety failures. The prior edited-en label miss did not reproduce;
Korean kept wording still receives a cautious qualification. These are agent
reviews against the fixed rubric, not a human usefulness study.

Fresh generation calibration passes 24 structural/24 qualitative cases and all
critical cases; no weights, thresholds, cadence or wording locks changed. It used
50 calls and USD 0.016962655. Chat baseline/candidate used 48 calls and
USD 0.011058811. The initial configuration probe read an unavailable key and
returned 401 without a model output; corrected the loader and retained its
unpriced USD 0.50 reservation. The raw audio pipeline uses two Gemini calls:
speech is transcribed/committed and silence yields audio_no_speech, with a
learning job queued in both cases. Estimate USD 0.000403, with the entire
USD 0.05 reservation retained; this proves raw audio intake, not its later reading.

The evaluation ledger now has USD 3.7120571334 used or held out of USD 5,
including the old unresolved USD 1.50 dev charge and the new reservations.
All live inputs are synthetic. Google standard-model rates were checked against
[its current pricing](https://ai.google.dev/gemini-api/docs/pricing); no account
billing tier or provider privacy configuration is inferred from those rates.

Current local API measurements use 30 samples at 25/2,000/10,000 inspirations,
with provider networking disabled. At 10,000, search p95 is 20.8 ms, chat context
median/p95 is 47.78/50.2 ms, Top of Mind uses 10 statements and Principles 4.
Twenty current-build browser samples per viewport at 2,000 inspirations and
150 ms added API delay give desktop/390px Home medians 412.5/412.3 ms and p95
433/426.9 ms; Review medians 373.9/384 ms; warm-return medians 225.9/236.5 ms.
These satisfy measured local targets; they are not cloud/provider timings or a
claim of a measured speed improvement over the earlier build.

API types and 975 unit cases pass (three paid benches excluded). Web types,
862 web cases and build pass. The [quality receipt](../craft/evidence/2026-10-07-web-quality-checkpoint.json)
retains per-case verdicts, run hashes, costs and fault evidence. Raw and timing
receipts remain under `work/web-quality`.

Phase 4 remains in progress: full raw text/link/image/Korean-audio-to-reading
evidence, the full browser request window and deployed timing/recovery still need
verification. Five first-time participants, monthly budget scope/enforcement,
provider/source-policy attestation and exercised alerts remain phase 5 work.
The pending owner questions are not treated as consent or as passed gates.

### 2026 10 07 raw input and link follow up

The full first-minute request window passes at 2,000 inspirations/150 ms added
delay: 30 requests, zero unsolicited original-detail reads and zero room-content
reads. URL drafts now join the frozen authored text on explicit Save, removing
the Link/Add confirmation. Invalid schemes retain the draft and explain the
field error; duplicate URLs are canonicalized. Real desktop/390px journeys
restore the URL draft, save one inspiration/attachment, clear the matching draft
and reopen the exact note and URL. Keyboard save follows the same manifest.

The new raw-input baseline exposed unsupported extraction: eight of nine cases
broadened an event, wish or time limit; one also invented a gender reference.
The old extraction instruction explicitly required a pattern true next month.
Corrected it to preserve supported current interests, uncertainty and time scope,
without changing matching, promotion, confidence or wording locks. Generation
documentation now states that standalone wording need not remain true forever.

The real pipeline run covers English/Korean text, fetched article bodies, pixels,
speech and silence through enrichment, embedding, extraction, reading and chat.
The matched candidate observations pass 9/9 qualitative cases and contain no
unsupported gender reference. Raw words remain unchanged, all citations stay
owned and one source creates no Principle. Article boilerplate is excluded,
image lettering is transcribed, both speech languages survive and silence
produces no signal/reading or inferred preference. Two earlier Korean-audio
attempts ended without an assistant message; their exact request failure code
was not captured. The later bounded run completed. Retain that limitation rather
than claiming universal provider reliability. The existing live extraction bench
passes 16/16, with zero meta-references, for USD 0.00156764.

The [raw comparison receipt](../craft/evidence/2026-10-07-web-quality-raw.json)
records completed cases, failures, hashes and costs. Raw calls retain conservative
Gemini upper estimates as held amounts, alongside returned OpenRouter charges;
unused pre-run ceilings were released after request accounting. The cumulative
used/held evaluation total is USD 3.7823478004 of USD 5. The old unknown dev/auth
reservations and raw-audio reservation remain held; unpriced requests are not free.

A no-network generation replay passed 23/24 structural cases. The remaining
case needed an unrecorded relation-model call, which the replay correctly refused.
This is a harness coverage limit, not another live quality result. The earlier
full live 24-case generation result remains recorded; extraction edits did not
change its request builders, weights or thresholds.

Read-only dev audit [37736288170](https://github.com/waka-eng/waka/actions/runs/37736288170)
completed against deployed `043b07ec`, skipping deployment/migrations/secrets.
Both configuration reads and numeric log/metric reads succeed. Trusted origins,
secure cookies, absent fixture overrides, matching approved models and identical
API/worker database bindings are verified. Four recovery metric periods each
show one check, with zero overdue jobs/exhausted leases. Two idle-worker cold
samples are not controlled request/provider latency evidence. Monetary caps,
provider privacy, proxy topology/source trust and alert delivery remain unverified.
The Function URL uses NONE/public-principal policy; no CloudFront service grant
was observed. This does not imply unauthenticated access to account memory.

The [first-time task kit](../craft/evidence/web-quality/first-time-check.md) and
blank results CSV are prepared. No participant observation is invented. Candidate
dev delivery, controlled deployed measurements and the final human/operating
gates remain open.

### 2026 10 08 approved dev delivery

The owner approved continuing and merging to dev. PR
[#362](https://github.com/waka-eng/waka/pull/362) merged at checked head
`9b413a94`, producing dev commit `b2bae5df`. Required CI passed before the merge.
Automatic [deployment 37785618707](https://github.com/waka-eng/waka/actions/runs/37785618707)
succeeded, including the separate configured database targets, memory schema,
approved API/worker models and database bindings, and domain connection checks.

Two real deployed browser journeys at 1280px and 390px pass one Save action,
private audience, draft return, one saved item after a double click, no automatic
reflection, exact-word search reopening and Home/Inspirations/Principles/Back
navigation. Review keeps both saved items; More/Remove disclosure and Escape
remain reachable without deletion. One explicit chat reply arrives with one
source button, and the correction editor opens. All three disposable synthetic
accounts, including the first attempt and the precise Review check, were erased;
their sessions return 401.

The first driver incorrectly expected Home after opening a search result and
closing its detail. Search opens the item in Inspirations. The corrected walk
establishes Home before testing Home→Inspirations→Back; the failure is retained.
No application repair or gate relaxation was needed for that driver assumption.

The [deployed receipt](../craft/evidence/2026-10-08-web-quality-dev.json)
records these observations. Initial Home readiness is 1,668/2,105 ms, confirmed
Save is 3,321/2,314 ms, and warm Home return is 24/26 ms for desktop/390px.
One chat reply is visible after 17,560 ms, including queue/provider time. These
are small observed samples, not percentiles or a measured improvement. Runtime
coldness and per-stage attribution were not established. The driver's 16 ms
Review reading only awaited an already-visible card, so it does not establish
next-item readiness and is excluded from the latency acceptance claim. A separate
390px check then awaited the advance endpoint's 200 response and the exact next
item words becoming visible: 3,297 ms, both originals still saved. This is one
confirmed sample, not a Review latency percentile.

Post-release read-only [audit 37786141801](https://github.com/waka-eng/waka/actions/runs/37786141801)
again passes configuration checks with no read failures. Four recovery metric
periods report one check each and zero overdue/exhausted work. Partial log pages
contain no captured model charges; they do not prove that the paid journeys cost
zero or attribute stages to the controlled synthetic requests. Provider privacy,
source/proxy trust, exercised recovery and alert delivery, and actual monthly
spending enforcement remain unverified.

The first deployed attempt retains a USD 0.50 evaluation reservation; the
corrected attempt and precise Review check each retain another USD 0.25.
Cumulative used/held is now USD 4.7823478004 of USD 5, leaving USD 0.2176521996.
Actual deployed model
charges remain unknown, and no reservation is released from incomplete logs.
The monthly operating budget remains a separate policy/enforcement gate.

Dev delivery is complete. The broader goal remains in progress until actual
first-time observations and the outstanding operational evidence meet the
recorded gates. The prepared results CSV remains blank; native capture stays
on its paused roadmap.
