# Plan: build on agikee's work rather than beside it

Status: proposed (authored 2026-07-26)
Working doc — excluded from PRs by convention.

## The finding this starts from

I built `merged-reading.ts` as a second merge engine. agikee's
`group-top-of-mind-synthesis.ts` already does almost everything it does, and
several things it does not:

| | theirs | mine |
|---|---|---|
| cross-member candidate retrieval | yes, with `diversifyAcrossMembers` | yes |
| per-evidence owner attribution | yes | yes |
| private signals excluded | yes | yes |
| evidence spans ≥2 members | yes | yes |
| retry/backoff on model errors | yes | no |
| persistence + idempotency keys | yes | no |
| **member labels reach the prompt** | **no** | yes |
| **not-a-restatement-of-one-member** | **no** | yes |

Two rows. That is the entire delta, and both are additions to their file rather
than reasons for a second one. Nothing else in mine earns its existence.

## 1. Contribute two things to their synthesis, then delete mine

**1a. Let ownership survive into the prompt.** `judgeGroupWowMoment` passes
`memberUserIds` to retrieval, then `toPromptInput` drops ownership before
building `WowJudgeInput`, whose candidates carry no owner. So the judge can
answer "what do these people share" and structurally cannot answer "what does
this combination reveal" — the question the product exists to ask.

The change: carry an anonymous, stable member label on each prompt candidate
(`member A`, `member B`) and render it in the group prompt. Anonymous rather
than named, so the model reasons about juxtaposition instead of about who it
imagines these people to be. Roughly 20 lines across `wow-judge.ts`.

**1b. Reject a reading that restates one member.** Theirs enforces that
evidence spans two owners; it does not check that the *thought* needed both.
A note can cite two people and still say only what one of them already thinks
alone — which satisfies the letter of "a synthesis of 2+ people" and not its
point. Add the check beside the existing `distinctOwners.size < 2` guard in
`group-top-of-mind-synthesis.ts`. Roughly 15 lines.

**1c. Delete `merged-reading.ts`, its test, and `tools/merged-reading-eval.ts`.**
Keep `tools/post-it-eval.ts` and `tools/pooled-retrieval-probe.ts` — those
measure, they do not duplicate.

## 2. Build the read-together moment on US-051, do not retire it

The product has no moment where people read together, which is the turn the
essay hinges on. US-051 already models it: `group_room_prompts` holds a prompt
generated *from* a top-of-mind note, with a rationale, an `actionLabel`
defaulting to "Keep talking", evidence previews, and `group_room_feedback`
feeding a `postConversation.nextAction`.

That is the ceremonial arrival, with a schema behind it. The loop to build:

    merged reading lands
      → becomes a room prompt (POST /discussion-topic already exists)
      → the group reacts (POST /:roomId/feedback already exists)
      → the reaction shapes what gets read next

Everything above the arrow exists. What is missing is a surface, and the
decision about whether a reading arrives as an occasion or a board entry —
which was already answered: ceremonial async.

So PR 4 as drafted is not merely premature, it is pointed the wrong way. What
US-051 actually needs today is five lines: stop `refreshGroupRooms` running on
every page load for a surface nobody can see, and hide the discuss button until
there is somewhere to read what it writes. Nothing deleted.

## 3. Keep their foundation; layer the UI on it

`groups`, `group_members`, `shared_to_groups` and the join-code model already
encode the room-join-as-consent decision. The room cast, the contributor faces
and the provenance line all read data their API already returns — PR 3 is
byte-identical to their files and proves the layering works.

`GroupBoardBar` is the open question. `RoomTitle` currently orphans it: 241
lines and 7 passing tests, imported by nothing, which reads as "untouched" in
review while actually being replaced. Either delete it with its test, or keep
the rail and drop `RoomTitle`. Orphaning is the one option to reject.

## 4. Revised PR set

| PR | Contents | Touches their work |
|---|---|---|
| 1 `wall-bottom-bar` | 92 lines, unchanged | no |
| 2 `pulse-capture` | 198 lines, two bug fixes | additive only |
| 3 `group-foundation` | their work + room cast + faces | no removals |
| 4 `wall-craft` | serif thoughts, merged provenance, bar geometry, drawer scrim, evidence-only view | no |
| 5 `combination-aware-synthesis` | 1a + 1b inside their files; delete my parallel engine | additive |
| 6 `room-object` | `RoomTitle`, with `GroupBoardBar` deleted outright and the lost loading state restored | replaces a component |
| 7 `stop-the-dead-fetch` | five lines: no page-load room fetch, discuss hidden | no removals |

PRs 1–5 and 7 need no conversation. PR 6 does, and it is one component rather
than a feature.

## 5. Decisions still open

- **Does the group foundation ship at all?** None of it is on `origin/dev`;
  waka.im has no groups, boards or rooms. Every plan here assumes it ships.
- **Rail or title?** The rail shows rooms at a glance; the title hides them
  behind a click and reads calmer. A third option — the rooms you are not in
  peeking beside the name — gets both.
- **Room deletion.** There is no delete endpoint, and `leaveGroup` does not
  check role, so an owner leaving silently orphans a room that anyone holding
  the code can still join. Worth fixing regardless of a delete button.
