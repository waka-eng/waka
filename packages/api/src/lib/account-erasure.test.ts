import { describe, expect, it, vi } from "vitest";

import { accounts, topOfMinds } from "../db/index.js";
import { eraseAccount } from "./account-erasure.js";

/**
 * A Drizzle query is chainable AND thenable: you can await it straight off
 * `.where()`, or keep building with `.orderBy()` and await that. The mock used
 * to return a promise from `.where()`, which worked only while every caller
 * stopped there — the moment the eraser added an ordered member roll, the next
 * call landed on a Promise. This mirrors the real shape, so a query can end
 * wherever the code ends it.
 *
 * `ordered` lets a case return a different row set from `.orderBy()` than from
 * a bare await, which is how the member roll is expressed.
 */
function selectResult(rows: unknown[], ordered?: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(async () => ordered ?? rows);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function fixture(input: {
  profiles?: Array<{ id: string }>;
  attachments?: Array<{ s3Key: string | null }>;
  memberships?: Array<{ groupId: string }>;
  citations?: Array<{ groupId: string | null }>;
  ownedGroups?: Array<{ groupId: string }>;
} = {}) {
  const order: string[] = [];
  const db: any = {
    select: vi
      .fn()
      .mockReturnValueOnce(
        selectResult(input.profiles ?? [{ id: "profile-human" }, { id: "profile-agent" }]),
      )
      .mockReturnValueOnce(
        selectResult(
          input.attachments ?? [{ s3Key: "one" }, { s3Key: "one" }, { s3Key: "two" }],
        ),
      )
      .mockReturnValueOnce(selectResult(input.memberships ?? [{ groupId: "group-1" }]))
      .mockReturnValueOnce(
        selectResult(input.citations ?? [{ groupId: "former-group-1" }]),
      )
      /*
       * INSIDE THE TRANSACTION, the erasure now asks which rooms this account
       * OWNS, so that a successor can take the seat before the membership rows
       * cascade away — otherwise a room outlives its creator (as of migration
       * 0004) but with nobody able to administer it.
       *
       * Two more `select` calls follow: the owned-rooms query, then one member
       * roll per owned room. The defaults below describe an account that owns
       * nothing, which is what every pre-existing case in this file assumes.
       */
      .mockReturnValue(selectResult(input.ownedGroups ?? [])),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          order.push("promote-successor");
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        order.push(table === accounts ? "account" : "group-top-of-mind");
      }),
    })),
  };
  db.transaction = vi.fn(async (work: (tx: typeof db) => Promise<void>) => work(db));

  const deleteAttachmentObjects = vi.fn(async () => {
    order.push("attachment-objects");
  });

  return { db, deleteAttachmentObjects, order };
}

describe("eraseAccount", () => {
  it("erases uploaded objects before the rows that inventory them", async () => {
    const value = fixture();

    await eraseAccount("account-1", value as any);

    expect(value.deleteAttachmentObjects).toHaveBeenCalledWith(["one", "two"]);
    expect(value.order[0]).toBe("attachment-objects");
    expect(value.order.at(-1)).toBe("account");
  });

  it("drops the account row last so the cascade takes every profile with it", async () => {
    const value = fixture();

    await eraseAccount("account-1", value as any);

    expect(value.db.delete).toHaveBeenLastCalledWith(accounts);
    expect(value.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("removes group artifacts that cite a departing member, including groups already left", async () => {
    const value = fixture({ memberships: [], citations: [{ groupId: "former-group-1" }] });

    await eraseAccount("account-1", value as any);

    expect(value.db.delete).toHaveBeenCalledWith(topOfMinds);
    expect(value.order).toEqual(["attachment-objects", "group-top-of-mind", "account"]);
  });

  it("leaves group artifacts alone when nothing of theirs came from this account", async () => {
    const value = fixture({ memberships: [], citations: [] });

    await eraseAccount("account-1", value as any);

    expect(value.db.delete).not.toHaveBeenCalledWith(topOfMinds);
    expect(value.db.delete).toHaveBeenCalledWith(accounts);
  });

  it("skips the inventory lookups when the account owns no profiles", async () => {
    const value = fixture({ profiles: [] });

    await eraseAccount("account-1", value as any);

    // One select for the profiles themselves, and nothing keyed off them.
    expect(value.db.select).toHaveBeenCalledTimes(1);
    expect(value.deleteAttachmentObjects).toHaveBeenCalledWith([]);
    expect(value.db.delete).toHaveBeenCalledWith(accounts);
  });

  /**
   * A ROOM OUTLIVES ITS CREATOR, AND STAYS ADMINISTRABLE.
   *
   * `groups.created_by_profile_id` used to be `ON DELETE cascade`, so deleting
   * your account deleted every room you had ever made — for everyone still in
   * it, along with the join code, their shares and the artifact the room built
   * together. Migration 0004 makes the column a historical credit that goes
   * null. That alone would leave a room nobody can administer, because the
   * departing owner's `group_members` row cascades away too, so the erasure
   * hands the seat on first — the same rule `promoteSuccessorOwner` applies
   * when someone merely leaves.
   */
  it("hands ownership on before erasing, so no room is left ownerless", async () => {
    const value = fixture({ ownedGroups: [{ groupId: "group-1" }] });
    /* awaited bare -> the owned-rooms answer; awaited off .orderBy() -> the
       member roll, departing owner first and the successor behind them */
    value.db.select.mockReturnValue(
      selectResult(
        [{ groupId: "group-1" }],
        [
          { id: "member-departing", profileId: "profile-human" },
          { id: "member-heir", profileId: "someone-else" },
        ],
      ),
    );

    await eraseAccount("account-1", value as any);

    expect(value.db.update).toHaveBeenCalled();
    expect(value.order).toContain("promote-successor");
    // and the account still goes last
    expect(value.order.at(-1)).toBe("account");
  });

  it("keeps the database inventory when external erasure fails so the operation is retryable", async () => {
    const value = fixture();
    value.deleteAttachmentObjects.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(eraseAccount("account-1", value as any)).rejects.toThrow(
      "storage unavailable",
    );
    expect(value.db.transaction).not.toHaveBeenCalled();
  });
});
