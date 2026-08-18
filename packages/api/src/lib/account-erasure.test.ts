import { describe, expect, it, vi } from "vitest";

import { accounts, topOfMinds } from "../db/index.js";
import { eraseAccount } from "./account-erasure.js";

/** Every select in the eraser is awaited straight off `.where()`. */
function selectResult(rows: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(async () => rows);
  return chain;
}

function fixture(input: {
  profiles?: Array<{ id: string }>;
  attachments?: Array<{ s3Key: string | null }>;
  memberships?: Array<{ groupId: string }>;
  citations?: Array<{ groupId: string | null }>;
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
      ),
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

  it("keeps the database inventory when external erasure fails so the operation is retryable", async () => {
    const value = fixture();
    value.deleteAttachmentObjects.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(eraseAccount("account-1", value as any)).rejects.toThrow(
      "storage unavailable",
    );
    expect(value.db.transaction).not.toHaveBeenCalled();
  });
});
