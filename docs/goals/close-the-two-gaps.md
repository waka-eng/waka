# Goal: close the two gaps — the state nobody owns, and the findings nobody named

Status: **draft v1 (2026-08-17).** Not started. Branch `goal/frontend-you-can-read`
carries the work this follows; nothing is merged and no PR is open.

Follows: `docs/goals/a-frontend-you-can-read.md`, which asked two questions and
answered one. Terminology is done and defended by a gate. Structure is roughly
forty per cent done and stopped against a real obstacle. Six security findings
of twelve are closed. This goal finishes both, and exists as a separate
document because the remaining work has a different shape: the first goal was
mostly relocation, and this one is mostly ownership.

Canon: `docs/data-model.md` for the nouns, `docs/architecture.md` for the three
vocabularies. Neither is amended here.

## Why

Two gaps, and they are unequal — which decides the order.

1. **Seven findings have never been named.** The count of twelve came from a
   compacted summary; five were written down and are now closed, and the
   audit meant to derive the rest never returned. So "seven remain" is not a
   backlog, it is an absence of knowledge. Everything found by actually
   looking, this week, was live: a session cookie shipping without `Secure`
   because Lambda does not set `NODE_ENV`, an invite link that enrolled you on
   click, removal that left the door key unchanged, and Google sign-in handing
   a victim's session to whoever had squatted their address. The rate at which
   looking produced real bugs is the argument for looking again.

2. **One file is half the frontend, and half of that file is one function.**
   `Home.tsx` is 10,792 lines; the simulation effect is 5,109 of them. That is
   not a size problem. 83 functions close over 113 loose `let`s, so nothing can
   leave while every function can touch everything — the sky's 18 outward
   dependencies and the three panels held by DOM refs are the same fact wearing
   two costumes.

**Security first.** An unverified session cookie cannot wait for a refactor,
and the refactor is safer once the codebase stops changing underneath it.

## Shape of the work

Four phases. Phase 1 buys knowledge, Phase 2 finishes what shipping the last
fix started, Phase 3 buys the coverage Phase 4 spends. Phase 4 is the
structural work and is deliberately last, because it is the only phase whose
failure mode is silent.

The rule that governs Phase 4: **name the state before moving anything.** Every
extraction attempted before that in the previous goal either failed on
measurement or produced a component with forty props.

---

### Phase 1 — Name the seven

The audit that was supposed to produce this list stalled twice. Run it again,
and treat "no finding in this area" as a real and useful answer rather than a
failure to look hard enough.

Areas, chosen because each one produced a live bug this week or is adjacent to
one that did:

- **Sessions and tokens** beyond the cookie: lifetime, revocation on password
  change, CLI login code entropy and reuse, whether logout invalidates server
  side.
- **Authorization on every route**: whose data can this reach, and what proves
  the caller owns it? Particularly any list endpoint that filters in JS after
  selecting rows it should never have selected.
- **The canon's privacy boundary**: an inspiration never crosses an account
  boundary, a member sees THAT a shared signal fed an entry and never which
  one, `visibility` defaults private. Over-serialization is the shape to look
  for — a row spread instead of named field by field.
- **Group membership**: can one member vote twice, or as another; does leaving
  revoke every capability; does any endpoint trust a client-supplied profile id.
- **Secrets and injection**: unsafe env fallbacks, prompt injection reaching a
  model that can then act, S3 key construction, rate limits on model calls.

Each finding needs a concrete exploit — actor, steps, what they gain. "Could be
exploited" is not a finding.

**Gate:** every area has been looked at and reported on, each finding carries
an exploit path, and the ones not being fixed are recorded here with the reason
and what would reopen them.

### Phase 2 — Make verification real

`1319a95` built email verification with the transport left out deliberately —
choosing SES over Resend is a decision about domains, DKIM and credentials that
belongs to whoever runs the infrastructure. That decision is now the only thing
standing between a working gate and a broken product.

- **Wire a provider.** One implementation of `SendVerificationEmail`, passed in
  at the edge. Nothing else in `lib/email-verification.ts` changes.
- **Verify a sending domain** before a single message leaves.
- **A `/verify-email` page** on the web side that posts the token and says
  which of the four outcomes happened — `expired` is actionable where `invalid`
  is not, which is why they are told apart.
- **Decide the backfill, and say which was chosen.** Joining a group now
  requires a proven address. Every pre-existing account is unproven, which is
  honest but means they cannot join anything until mail works. Either wire the
  transport before deploying, or mark accounts created before `0006` as
  verified so only new signups are gated. The second is a deliberate weakening
  and should be written down as one.
- **Resend endpoint**, throttled by the cooldown already implemented.

**Gate:** a real address receives a real link, following it proves the address,
and a person who signed up yesterday can join a group.

### Phase 3 — The net sees more than one thing

The net asserts one invariant and one count over 5,109 lines, and it stayed
GREEN through a real bug — the provenance key that left every group's poster
standing on nothing. That is the coverage Phase 4 would be leaning on.

The harness exists and the expensive part is built. This is fixture work.

- **The sky**: no candidate currently reaches the harness at all, so layer 2 is
  entirely unobserved. Assert that a signal with evidence becomes a nebula with
  satellites, and that adopting one condenses it.
- **The poster**: the drift readout — a word that survived a rewrite stays lit,
  a new one arrives — has no test, and it is the product's most-read surface.
- **The dial**: scrubbing changes what is present. Assert `present` falls as
  the dial winds back.
- **Three-point probes.** The vocabulary gate reported clean over half a file
  for a week because it was only ever proven at one location. Every check this
  repo trusts should be proven to fail at more than one point.

**Gate:** each new case is demonstrated to fail against the code that would
break it, not merely to pass against the code that works.

### Phase 4 — Give the state an owner

5,109 lines, 113 mutable variables, 83 functions. In four steps, and the first
one moves nothing.

**4a. Name the state.** The 113 already group by theme:

| count | group |
|---|---|
| 42 | camera and travel |
| 33 | the character |
| 15 | the sky |
| 10 | viewport and clock |
| 9 | the field's pour |
| 4 | judged individually |

`let camY = 0` becomes `cam.y`. Every use site is a compiler error until it is
carried through — the same property that made the vocabulary rename safe.
Nothing changes file, nothing changes behaviour, and the net stays green
throughout or the step is wrong.

**4b. Read the dependencies off the signatures.** A function that only touches
`sky` now says so. The sky engine's 18 outward dependencies should collapse to
two or three objects, because most of the 18 were fields of one theme. This is
the gate for 4c: **if a candidate still needs four or more groups, it is not a
module** — that measurement, not enthusiasm, decides.

**4c. Extract what 4b proved separable**, taking its group as a parameter:
`stepSky(sky, view, dt)` rather than a closure over everything. The sky is the
expected first at roughly 950 lines.

**4d. The three blocked panels.** Their DOM refs are a distinct seam — React
owns the elements, the loop measures them. Collect them into one `measured`
object written by React and read by the loop, and the refs stop being props
threaded through children.

**Gate:** `Home.tsx` under 6,000 and the effect under 2,000, with the net green
at every step. If 4b shows the sky still needs four groups, this phase stops
and says so rather than forcing a module that is a wall drawn through code.

## Out of scope

- The `packages/admin` surface.
- Any change to the canon's nouns.
- `ApiTopOfMindEntryType` is still `"pattern" | "tension" | …` in the API. The
  frontend must keep saying `"pattern"` in that one string until the backend
  adopts its own renamed canon. That is a change in `waka`'s API, not here.
- Visual redesign.

## Log

_(appended per phase at execution)_

### Starting state (2026-08-17)

- **Terminology: done.** `vocabulary: clean`, enforced by `pnpm test`, and
  proven to fail at three points across the file — including line 9013, where
  the gate had been blind because an apostrophe in JSX text opened a string
  that swallowed half of `Home.tsx`.
- **Security: six of twelve.** Closed: migration `0003` bricking derivation,
  the session cookie without `Secure`, `?join=` silent enrolment, join codes
  surviving removal, Google pre-hijacking, and unverified email addresses. Five
  are held by a test that goes red without the fix.
- **Structure: thirteen modules out, one file still half the frontend.**
  `Home.tsx` 13,516 → 10,792. All three canon layers have a directory;
  `space/signal/` did not exist before this work.
- **Two corrections carried forward**: the sky engine is NOT separable as first
  measured, and three of the five JSX panels are blocked on DOM refs the loop
  writes into. Both were measured optimistically the first time.
