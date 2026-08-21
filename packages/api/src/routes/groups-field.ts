/**
 * A room's ground — the one place the group module reads layer 1.
 *
 * Everything else about a group stops at layer 2: members share *statements*,
 * and what a statement was distilled from never crosses an account boundary.
 * A room's field is the single exception, and it sits alone in this file on
 * purpose, so that "can a private memory escape a room?" is a question with
 * one short file for an answer rather than a route module to search.
 *
 * `group-authorization.test.ts` reads this file as text and fails if a query
 * here selects from `inspirations` without the visibility gate, so the rule
 * survives someone adding a second query without reading the canon first.
 */

import { and, desc, eq } from "drizzle-orm";

import { groupMembers, inspirations, profiles } from "../db/index.js";
import { getDb } from "../lib/db.js";

type WakaDb = ReturnType<typeof getDb>;

/* One page of a room's ground. A room of five people each keeping a couple of
   hundred public memories is a thousand orbs, past what the field lays out
   legibly — so this is a real ceiling, named here rather than discovered as a
   wall that quietly stops filling. */
const GROUP_FIELD_LIMIT = 400;

/**
 * A room's ground: every PUBLIC capture belonging to every CURRENT member.
 *
 * A named loader rather than an inline query, so it can be injected in tests
 * the same way `loadGroupWall` is — the convention every other read in this
 * module follows, and the reason those reads have tests and this one did not.
 *
 * Both halves of the predicate are explicit: the author is in this room AND
 * marked the capture public. Neither is inferred, and `visibility` defaults to
 * private at the column, so any bug upstream shows an empty field rather than
 * somebody's private memory.
 */
export async function loadGroupField(
  db: WakaDb,
  groupId: string,
): Promise<
  Array<{
    id: string;
    text: string;
    kind: string | null;
    source: string;
    createdAt: Date;
    updatedAt: Date;
    ownerProfileId: string;
    ownerName: string;
    ownerType: string;
  }>
> {
  const rows = await db
    .select({
      id: inspirations.id,
      text: inspirations.text,
      kind: inspirations.kind,
      source: inspirations.source,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
      ownerProfileId: profiles.id,
      ownerName: profiles.name,
      ownerType: profiles.type,
    })
    .from(inspirations)
    .innerJoin(profiles, eq(profiles.id, inspirations.profileId))
    .innerJoin(groupMembers, eq(groupMembers.profileId, profiles.id))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(inspirations.visibility, "public"),
        /* THREE HALVES, NOT TWO. docs/data-model.md rule 5: "Group membership
           is between human profiles for now; agent profiles do not join walls."
           `routes/groups.ts:132` enforces that when somebody joins, and this
           read did not enforce it when somebody looks — so a member row for an
           agent, however it arrived, put that agent's public captures into a
           room belonging to other accounts. Six such rows exist in the dev
           database today, which is why this is a predicate and not a comment.

           Enforced here as well as at the join because the two answer different
           questions: the join asks "may this profile become a member", and this
           asks "whose memories is this room's ground made of". A rule checked
           only on the way in is a rule that a bad row silently repeals. */
        eq(profiles.type, "human"),
      ),
    )
    .orderBy(desc(inspirations.createdAt))
    .limit(GROUP_FIELD_LIMIT);
  return rows;
}
