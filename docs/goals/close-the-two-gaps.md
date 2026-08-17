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

#### 4a in practice — the order, the method, and what stops it

**Five commits, smallest first.** Not because the small ones matter, but because
the method has to be proven on something cheap before it is pointed at the
forty-two-variable one.

| # | group | count | why here |
|---|---|---|---|
| 1 | the field's pour | 9 | the rehearsal: few names, one concern, obvious blast radius |
| 2 | the sky | 15 | already known to be cohesive; this is the group 4b is really about |
| 3 | viewport and clock | 10 | read by everything, written by almost nothing — proves the method under wide reach |
| 4 | the character | 33 | large but self-contained |
| 5 | camera and travel | 42 | last: biggest, most entangled, and the one travel bugs live in |

**The method, per group.**

1. Declare the object where the `let`s were, with the same initial values:
   `const pour = { active: false, poured: false, step: 35, … }`. Not a `let` —
   the object is never reassigned, only its fields.
2. Delete the `let`s. Every use site is now a compiler error.
3. Rename with `packages/web/scripts/rename-identifier.mjs`, which masks
   comments and string literals exactly as the vocabulary gate does — a plain
   regex rewrote 142 comment lines the last time one was used here.
4. Fix what the compiler still complains about by hand. Expect collisions:
   several of these names (`col`, `settle`, `prev`) also exist as locals inside
   nested functions, and TypeScript will say so.
5. `pnpm test` (vocabulary gate, 65 tests) and `tsc --noEmit`. Commit.

**Assignment still works.** `pour.active = true` behaves exactly as `pouring =
true` did — the closure captures the object, not the field. That is the whole
reason this is safe: nothing about lifetime, ordering or identity changes.

**What stops the phase.** If a group cannot be named without also touching
another group's variables in the same commit, the grouping is wrong — stop and
regroup rather than widening the commit. The five above are a hypothesis from
name prefixes, not a proof.

**Do not start this without finishing it.** Half-renamed state is worse than
none: the file then has two vocabularies for the same concept and no compiler
error to say so. One group per sitting, committed green.

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

### 4a — done (2026-08-17), in six commits, not five

`4b81b82 dc97e22 0fba6a7 4799f30 5b1afd7 3487686`

113 loose `let`s are now 13, and eleven of those are locals inside nested
functions that were never in scope. Every commit: vocabulary clean, 65 tests
green, `tsc` clean.

| object | fields | what it owns |
|---|---|---|
| `view` | 8 | the viewport, and what the display asked for |
| `cam` | 10 | where the world is looked at from, both axes |
| `trip` | 10 | a crossing from one wall to the next |
| `companion` | 33 | one body's posture at one instant |
| `gesture` | 24 | one hand on the world |
| `sky` | 11 | layer 2, and what the pointer is doing to it |
| `pour` | 5 | staging orbs into the field |
| `clock` | 4 | whether the loop turns, and since when |
| `stir` | 2 | how alive the world is right now |
| `poster` | 2 | what the peek row rests on |
| `hinted` | 2 | which one-time hints have been said |

`mech` and `ground` stay loose — each is a single value with one meaning and
no partner to be incoherent with.

**The plan's five groups were wrong three times, and the same way each time:
they were prefix guesses, and reading the use sites moved things.** `settle`
and `stirAt` were filed under the pour and are read by four subsystems, none
of them the pour. `primed` and `motesPlaced` were filed under the pour and are
first-sizing flags. `provenance` and `wallProv` sat in the sky's block and
belong to the poster. The rule that caught all three: **name the group after
what reads it, not after what it sits next to.**

**The tool did the real work, and it was wrong twice before it was right.**
`packages/web/scripts/rename-identifier.mjs` is now on the TypeScript AST:

- Both regex versions corrupted prose — the first rewrote 142 comment lines,
  the second survived comment and string masking and still rewrote JSX text,
  because `<div>Waka could not be poured</div>` is neither.
- `--decl <line>` resolves symbols, which mattered enormously: `prev` appears
  112 times and 4 are the variable; `layout` 153 and 44; `col` throughout and
  36. A text rename at this scale would have been unrecoverable.
- `{ vh }` is both a property and a reference, and the checker answers about
  the property. The shorthand guard compared the wrong symbols and silently
  skipped two sites; `tsc` caught it. It now asks
  `getShorthandAssignmentValueSymbol`, and the fix is proven on a fixture.

**The order matters and is not obvious**: rename while the `let` is still
there, THEN delete it. Delete first and the inner references resolve to
whatever they shadow, and the tool faithfully renames the wrong variable.

### Next: 4b, and what would stop 4c

4b is now a real measurement rather than an estimate, because the signatures
exist to read. The gate stands as written: **if the sky still needs four or
more groups, it is not a module** — and that answer, whichever way it comes
out, gets written here rather than worked around.
