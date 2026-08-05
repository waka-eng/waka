import { describe, expect, it, vi } from "vitest";

import { combinations, groupTopOfMindNotes, users } from "../db/index.js";
import { eraseUserAccount } from "./account-erasure.js";

function selectDocuments(rows: Array<{ path: string }>) {
  return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) };
}

function selectAttachments(rows: Array<{ s3Key: string | null }>) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    })),
  };
}

function selectCombinations(rows: Array<{ id: string }>) {
  return {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    })),
  };
}

function fixture() {
  const order: string[] = [];
  const whereDelete = vi.fn(async () => undefined);
  const db: any = {
    select: vi
      .fn()
      .mockReturnValueOnce(selectDocuments([{ path: "user-1/signals/indexed.md" }]))
      .mockReturnValueOnce(
        selectAttachments([{ s3Key: "one" }, { s3Key: "one" }, { s3Key: "two" }]),
      )
      .mockReturnValueOnce(selectDocuments([{ groupId: "group-1" }] as any))
      .mockReturnValueOnce(selectAttachments([{ groupId: "former-group-1" }] as any))
      .mockReturnValueOnce(selectCombinations([{ id: "subset-combination-1" }]))
      .mockReturnValueOnce(selectDocuments([{ roomId: "room-1" }] as any))
      .mockReturnValueOnce(selectDocuments([{ roomId: "room-1" }] as any)),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        order.push(table === users ? "database" : "derived");
        if (table === users) await whereDelete();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => order.push("derived")) })),
    })),
  };
  db.transaction = vi.fn(async (work: (tx: typeof db) => Promise<void>) => work(db));
  const vault = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (path: string) => {
      order.push(`vault:${path}`);
    }),
    list: vi.fn(async function* () {
      yield "user-1/signals/indexed.md";
      yield "user-1/context/unindexed.md";
    }),
  };
  const deleteAttachmentObjects = vi.fn(async () => {
    order.push("attachments");
  });
  return { db, vault, deleteAttachmentObjects, order, whereDelete };
}

describe("eraseUserAccount", () => {
  it("erases indexed and unindexed vault files plus uploaded objects before the user row", async () => {
    const value = fixture();
    await eraseUserAccount("user-1", value as any);

    expect(value.vault.list).toHaveBeenCalledWith("user-1/");
    expect(value.vault.delete).toHaveBeenCalledTimes(2);
    expect(value.deleteAttachmentObjects).toHaveBeenCalledWith(["one", "two"]);
    expect(value.order.at(-1)).toBe("database");
    expect(value.whereDelete).toHaveBeenCalledTimes(1);
    expect(value.db.delete).toHaveBeenCalledWith(groupTopOfMindNotes);
    expect(value.db.delete).toHaveBeenCalledWith(combinations);
    expect(value.db.delete).toHaveBeenLastCalledWith(users);
  });

  it("keeps the database inventory when external erasure fails so the operation is retryable", async () => {
    const value = fixture();
    value.deleteAttachmentObjects.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(eraseUserAccount("user-1", value as any)).rejects.toThrow(
      "storage unavailable",
    );
    expect(value.db.transaction).not.toHaveBeenCalled();
  });
});
