import { describe, expect, it, vi } from "vitest";

import type { GroupReadingRefreshPayload } from "../db/index.js";
import { runGroupReadingRefreshJob } from "./queue.js";

const payload: GroupReadingRefreshPayload = {
  groupId: "00000000-0000-4000-8000-000000000101",
  requestedByUserId: "00000000-0000-4000-8000-000000000001",
  preferredLocale: "en-US",
  materialFingerprint: "fingerprint",
  reason: "bootstrap",
};

const loaded = {
  group: {
    id: payload.groupId,
    name: "studio",
    role: "owner",
    joinCode: "ABCD2345",
    memberCount: 2,
    createdAt: "2026-08-04T00:00:00.000Z",
  },
  members: [
    { userId: payload.requestedByUserId, name: "A", role: "owner" },
    {
      userId: "00000000-0000-4000-8000-000000000002",
      name: "B",
      role: "member",
    },
  ],
};

describe("runGroupReadingRefreshJob", () => {
  it("reads the ambition even when the room-note pass is cooldown-skipped", async () => {
    const refreshNotes = vi.fn(async () => ({ refreshed: false } as never));
    const refreshCombination = vi.fn(async () => null);

    await runGroupReadingRefreshJob(payload, {
      db: {} as never,
      loadGroup: vi.fn(async () => loaded),
      refreshNotes,
      refreshCombination,
    });

    expect(refreshNotes).toHaveBeenCalledTimes(1);
    expect(refreshCombination).toHaveBeenCalledTimes(1);
  });

  it("still attempts the ambition stage when note generation fails, then retries the job", async () => {
    const noteFailure = new Error("note provider unavailable");
    const refreshCombination = vi.fn(async () => null);

    await expect(
      runGroupReadingRefreshJob(payload, {
        db: {} as never,
        loadGroup: vi.fn(async () => loaded),
        refreshNotes: vi.fn(async () => {
          throw noteFailure;
        }),
        refreshCombination,
      }),
    ).rejects.toBe(noteFailure);
    expect(refreshCombination).toHaveBeenCalledTimes(1);
  });

  it("does no generation work until a second member joins", async () => {
    const refreshNotes = vi.fn();
    const refreshCombination = vi.fn();

    await runGroupReadingRefreshJob(payload, {
      db: {} as never,
      loadGroup: vi.fn(async () => ({ ...loaded, members: loaded.members.slice(0, 1) })),
      refreshNotes,
      refreshCombination,
    });

    expect(refreshNotes).not.toHaveBeenCalled();
    expect(refreshCombination).not.toHaveBeenCalled();
  });
});
