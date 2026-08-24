#!/usr/bin/env tsx
/**
 * ROOMS: joining, leaving, being removed, and closing the door behind you.
 *
 * `groups.ts` proves what CROSSES between people while everyone is still in
 * the room — the wall, the boundary, the proposal that materialises. It never
 * changes the membership, so every question about the exits was untested, and
 * `every-workflow-works.md` carried G4 as **partial** with no reason attached.
 *
 * WHAT THIS DRIVES, AND WHY EACH ONE IS WORTH A CHECK
 * ──────────────────────────────────────────────────
 *
 *   1. **Removal re-keys the door; leaving does not.** The invite link carries
 *      a join code, the code does not expire, and `joinGroupByCode` asks only
 *      whether the code matches. Deleting a membership row ends the person's
 *      access to exactly nothing — anyone removed who had ever seen the link,
 *      or a screenshot of it, walks straight back in and the room cannot tell
 *      that from a normal join. Removal is the one exit that means "not you,
 *      not again", so it is the one that rotates. Leaving is voluntary and the
 *      person may be asked back, so re-keying there would invalidate the link
 *      in everyone else's hands for nothing.
 *
 *      `rotateJoinCode` has a unit test and no end-to-end proof. A unit test
 *      shows the function makes a new code; only this shows the OLD one has
 *      stopped opening the door.
 *
 *   2. **Removal takes their votes out of THIS room and no further.** A real
 *      bug lived here: `group_top_of_mind_affirmations` has no `group_id`, so
 *      a delete keyed on the profile alone meant "their votes ANYWHERE".
 *      Removing someone from a room you own reached into every other room they
 *      were in — rooms you cannot read and that were never named in the
 *      request — and the agreements there simply stopped existing, which is
 *      indistinguishable from never having voted. So this suite puts the same
 *      person in two rooms and checks the second one is untouched.
 *
 *   3. **The exits are the owner's to control, and not the owner's to abuse.**
 *      Only an owner may remove or close; removing yourself is refused and
 *      pointed at the door that exists for it.
 *
 *   4. **A closed room is closed for everyone**, not just for the person who
 *      closed it.
 *
 * NO MODEL CALLS. Membership, permissions and proposals need no derivation, so
 * this is fast and free and there is no reason it should not run on every
 * change. What a departing member's SIGNALS do to the wall is layer 2's
 * question and stays in `groups.ts`, which already spends for it.
 *
 *     pnpm e2e:rooms [--base-url http://127.0.0.1:3010]
 */
import { health, signUp, type Session } from "./organic.js";

const DEFAULT_BASE_URL = "http://localhost:3010";

const results: Array<{ ok: boolean }> = [];

async function step(title: string, run: () => Promise<string>): Promise<void> {
  const index = results.length + 1;
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ ok: true });
    console.log(`PASS ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
  } catch (err) {
    results.push({ ok: false });
    console.log(`FAIL ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function api<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T; raw: string }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body: body as T, raw };
}

interface Room {
  id: string;
  joinCode: string;
}

async function makeRoom(owner: Session, name: string): Promise<Room> {
  const created = await api<{ group: Room }>(owner, "/api/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`create room → ${created.status}: ${created.raw.slice(0, 200)}`);
  }
  return created.body.group;
}

async function joinWith(session: Session, joinCode: string): Promise<number> {
  const joined = await api(session, "/api/groups/join", {
    method: "POST",
    body: JSON.stringify({ joinCode }),
  });
  return joined.status;
}

/** The code as it stands right now, read by somebody who is still inside. */
async function currentJoinCode(member: Session, groupId: string): Promise<string | null> {
  const rooms = await api<{ groups?: Array<{ id: string; joinCode?: string }> }>(
    member,
    "/api/groups",
  );
  return (rooms.body.groups ?? []).find((g) => g.id === groupId)?.joinCode ?? null;
}

const canSeeWall = async (session: Session, groupId: string): Promise<boolean> =>
  (await api(session, `/api/groups/${groupId}/wall`)).status === 200;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--base-url");
  const baseUrl = flag >= 0 ? args[flag + 1]! : DEFAULT_BASE_URL;

  console.log(`[rooms] base url: ${baseUrl}\n`);
  await health(baseUrl);

  const owner = await signUp({ baseUrl });
  const walker = await signUp({ baseUrl });
  const removed = await signUp({ baseUrl });
  const bystander = await signUp({ baseUrl });

  let room: Room | undefined;
  let elsewhere: Room | undefined;
  let elsewhereProposal = "";

  await step("a room opens and three people walk in", async () => {
    room = await makeRoom(owner, "Things that were used");
    for (const person of [walker, removed, bystander]) {
      const status = await joinWith(person, room.joinCode);
      if (status !== 200 && status !== 201) throw new Error(`join → ${status}`);
    }
    const members = await api<{ members?: unknown[] }>(
      owner,
      `/api/groups/${room.id}/members`,
    );
    const count = members.body.members?.length ?? 0;
    if (count !== 4) throw new Error(`expected 4 members, saw ${count}`);
    return `room ${room.id.slice(0, 8)} with ${count} people`;
  });

  await step("the same person also keeps a room of their own elsewhere", async () => {
    /* The second room exists for one reason: to catch a removal that reaches
       out of the room it was asked about. `removed` is a member of both. */
    elsewhere = await makeRoom(bystander, "A different room entirely");
    const status = await joinWith(removed, elsewhere.joinCode);
    if (status !== 200 && status !== 201) throw new Error(`join elsewhere → ${status}`);

    const proposed = await api<{ proposal: { id: string } }>(
      bystander,
      `/api/groups/${elsewhere.id}/proposals`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "add_entry",
          body: "We keep what we actually reach for.",
          rationale: "Both of us keep landing here.",
        }),
      },
    );
    if (proposed.status !== 200 && proposed.status !== 201) {
      throw new Error(`propose elsewhere → ${proposed.status}: ${proposed.raw.slice(0, 160)}`);
    }
    elsewhereProposal = proposed.body.proposal.id;

    const affirmed = await api(
      removed,
      `/api/groups/${elsewhere.id}/proposals/${elsewhereProposal}/affirm`,
      { method: "POST" },
    );
    if (affirmed.status !== 200) throw new Error(`affirm elsewhere → ${affirmed.status}`);
    return "a second room, with a proposal they have agreed to";
  });

  await step("leaving is voluntary, so the door is NOT re-keyed", async () => {
    const before = await currentJoinCode(walker, room!.id);
    if (!before) throw new Error("a member cannot read the room's join code");

    const left = await api(walker, `/api/groups/${room!.id}/leave`, { method: "POST" });
    if (left.status !== 200) throw new Error(`leave → ${left.status}`);

    if (await canSeeWall(walker, room!.id)) {
      throw new Error("someone who left can still read the wall");
    }

    const after = await currentJoinCode(bystander, room!.id);
    if (after !== before) {
      throw new Error(
        "leaving rotated the join code — every other member's invite link just died for nothing",
      );
    }
    return "they are out, and everyone else's link still works";
  });

  await step("a person who left can be asked back with the same link", async () => {
    const status = await joinWith(walker, room!.joinCode);
    if (status !== 200 && status !== 201) {
      throw new Error(`re-join after leaving → ${status} — a voluntary exit should not lock out`);
    }
    if (!(await canSeeWall(walker, room!.id))) {
      throw new Error("they re-joined and still cannot see the wall");
    }
    /* And straight back out, so the rest of the suite counts what it expects. */
    await api(walker, `/api/groups/${room!.id}/leave`, { method: "POST" });
    return "back in with the code they already had";
  });

  await step("only the owner can remove somebody, and never themselves", async () => {
    const byMember = await api(
      bystander,
      `/api/groups/${room!.id}/members/${removed.profileId}`,
      { method: "DELETE" },
    );
    if (byMember.status !== 403) {
      throw new Error(`a plain member removing someone answered ${byMember.status}, not 403`);
    }
    if (!(await canSeeWall(removed, room!.id))) {
      throw new Error("a member without the right to remove anyone removed someone");
    }

    const self = await api(owner, `/api/groups/${room!.id}/members/${owner.profileId}`, {
      method: "DELETE",
    });
    if (self.status !== 400) {
      throw new Error(`the owner removing themselves answered ${self.status}, not 400`);
    }
    return "403 for a member, 400 for removing yourself";
  });

  let codeBeforeRemoval = "";
  await step("removal DOES re-key the door", async () => {
    codeBeforeRemoval = (await currentJoinCode(removed, room!.id)) ?? "";
    if (!codeBeforeRemoval) throw new Error("could not read the code before removal");

    const gone = await api(owner, `/api/groups/${room!.id}/members/${removed.profileId}`, {
      method: "DELETE",
    });
    if (gone.status !== 200) throw new Error(`remove → ${gone.status}: ${gone.raw.slice(0, 160)}`);

    if (await canSeeWall(removed, room!.id)) {
      throw new Error("a removed person can still read the wall");
    }

    const after = await currentJoinCode(bystander, room!.id);
    if (!after) throw new Error("the room lost its join code entirely");
    if (after === codeBeforeRemoval) {
      throw new Error(
        "the join code did not change — the removed person still holds a working key, " +
          "and a re-join would be indistinguishable from any other",
      );
    }
    return `the code changed, and they are out`;
  });

  await step("the key they still hold no longer opens the door", async () => {
    /* THE ASSERTION A UNIT TEST CANNOT MAKE. `rotateJoinCode` has one, and it
       proves a new code is written. Only this proves the OLD one is dead. */
    const status = await joinWith(removed, codeBeforeRemoval);
    if (status === 200 || status === 201) {
      throw new Error("the old join code let a removed person walk straight back in");
    }
    if (await canSeeWall(removed, room!.id)) {
      throw new Error("the re-join was refused and they can read the wall anyway");
    }
    return `their old code answers ${status}`;
  });

  await step("their agreement in the other room is untouched", async () => {
    /* The bug this is shaped against deleted affirmations by profile alone,
       with no room in the predicate — so removing someone here silently
       withdrew their votes from rooms nobody named. */
    if (!(await canSeeWall(removed, elsewhere!.id))) {
      throw new Error("removing them from one room removed them from another");
    }
    /* `affirmations` is WHO agreed, not how many — the law is that states
       render and numerals never, and the payload obeys it. The first version
       of this check compared that array to a number: `array < 2` coerces to
       `NaN < 2`, which is false, so it passed without asserting anything.
       Naming the person is both correct and stronger. */
    const proposals = await api<{
      proposals?: Array<{
        id: string;
        affirmations?: Array<{ profileId: string; name: string }>;
      }>;
    }>(bystander, `/api/groups/${elsewhere!.id}/proposals`);
    if (proposals.status !== 200) throw new Error(`proposals elsewhere → ${proposals.status}`);
    const theirs = (proposals.body.proposals ?? []).find((p) => p.id === elsewhereProposal);
    if (!theirs) throw new Error("the other room's proposal vanished");
    const who = theirs.affirmations ?? [];
    if (!who.some((a) => a.profileId === removed.profileId)) {
      throw new Error(
        "their agreement in the other room is gone — a removal reached into a room it " +
          `was never asked about (${who.length} affirmation(s) left: ${who
            .map((a) => a.name)
            .join(", ")})`,
      );
    }
    return `still a member elsewhere, and still among the ${who.length} who agreed there`;
  });

  await step("only the owner can close the room, and it closes for everyone", async () => {
    const byMember = await api(bystander, `/api/groups/${room!.id}`, { method: "DELETE" });
    if (byMember.status !== 403) {
      throw new Error(`a member closing the room answered ${byMember.status}, not 403`);
    }
    if (!(await canSeeWall(bystander, room!.id))) {
      throw new Error("a refused close closed the room anyway");
    }

    const closed = await api(owner, `/api/groups/${room!.id}`, { method: "DELETE" });
    if (closed.status !== 200) throw new Error(`close → ${closed.status}`);

    for (const [who, session] of [
      ["the owner", owner],
      ["a member", bystander],
    ] as const) {
      if (await canSeeWall(session, room!.id)) {
        throw new Error(`the room is closed and ${who} can still read its wall`);
      }
    }
    /* And the other room is still standing — closing one is not closing all. */
    if (!(await canSeeWall(bystander, elsewhere!.id))) {
      throw new Error("closing one room closed another");
    }
    return "403 for a member; closed for everyone once the owner did it";
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(`[rooms] ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`[rooms] harness error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
