/**
 * listReadingsForSignal — shaping logic.
 *
 * The fake db dispatches on the table passed to `.from(...)`, with a FIFO
 * queue per table, so the solo and group paths each consume their own rows
 * regardless of Promise.all interleaving. What these tests pin down is the
 * arrangement work this module owns: merging scopes in order, excluding the
 * signal itself from its neighbors, marking whose neighbors are whose, and
 * normalizing previews. The joins and the membership gate are SQL and are
 * exercised against a real database, not here.
 */

import { describe, expect, it } from "vitest";

import {
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  signals,
  topOfMindNoteSignals,
  topOfMindNotes,
  users,
} from "../db/index.js";
import { listReadingsForSignal } from "./signal-readings.js";

const userId = "00000000-0000-4000-8000-000000000001";
const jaegyuId = "00000000-0000-4000-8000-000000000002";
const signalId = "00000000-0000-4000-8000-000000000011";
const neighborMine = "00000000-0000-4000-8000-000000000012";
const neighborTheirs = "00000000-0000-4000-8000-000000000013";
const soloNoteId = "00000000-0000-4000-8000-000000000021";
const groupNoteId = "00000000-0000-4000-8000-000000000022";
const groupId = "00000000-0000-4000-8000-000000000031";

/**
 * Each `db.select(...)` returns a thenable chain; awaiting it shifts the next
 * row-set queued for the table its `.from(...)` received. Join/where/order
 * arguments are accepted and ignored — this fake tests shaping, not SQL.
 */
function fakeDb(queues: Map<unknown, unknown[][]>) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = queues.get(table)?.shift() ?? [];
        const chain: any = {
          innerJoin: () => chain,
          where: () => chain,
          orderBy: async () => rows,
          limit: async () => rows,
          // Thenable, so a query that ends at `.where(...)` resolves when
          // awaited rather than yielding the builder itself.
          then: (resolve: (value: unknown) => void) => resolve(rows),
        };
        return chain;
      },
    }),
  } as any;
}

const soloCitation = {
  noteId: soloNoteId,
  title: "Tools that make thinking visible",
  kind: "recurrence",
  beliefStatement: "You keep circling tools that make thinking visible.",
  why: "Three saves in two weeks orbit the same instinct.",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  role: "anchor",
  reason: "The save that started the thread.",
};

const groupCitation = {
  noteId: groupNoteId,
  groupId,
  groupName: "잡소리",
  title: "Performing ideas before they are finished",
  kind: "bridge",
  beliefStatement: "The four of you are drawn to performing ideas before they are finished.",
  why: "The same save lands differently beside Jaegyu's clip.",
  createdAt: new Date("2026-07-15T00:00:00.000Z"),
  role: "related",
  reason: "Sharpens the group's version of the pattern.",
};

describe("listReadingsForSignal", () => {
  it("returns solo readings first, then group readings, each with its citation", async () => {
    const db = fakeDb(
      new Map<unknown, unknown[][]>([
        [
          topOfMindNoteSignals,
          [
            [soloCitation],
            // Neighbor pass: includes the signal itself, which must not
            // appear in its own neighbors.
            [
              { noteId: soloNoteId, signalId, sortOrder: 0, text: "self row" },
              {
                noteId: soloNoteId,
                signalId: neighborMine,
                sortOrder: 1,
                text: "  a   note\nabout visible   thinking  ",
              },
            ],
          ],
        ],
        [users, [[{ name: "Yunji", avatarUrl: null }]]],
        [
          groupTopOfMindNoteSignals,
          [
            [groupCitation],
            [
              {
                noteId: groupNoteId,
                signalId: neighborTheirs,
                sortOrder: 0,
                text: "the clip of the crowd going quiet",
                ownerUserId: jaegyuId,
                ownerName: "Jaegyu",
                ownerAvatarUrl: "https://example.com/jaegyu.png",
              },
              {
                noteId: groupNoteId,
                signalId,
                sortOrder: 1,
                text: "self row",
                ownerUserId: userId,
                ownerName: "Yunji",
                ownerAvatarUrl: null,
              },
            ],
          ],
        ],
      ]),
    );

    const readings = await listReadingsForSignal(db, { userId, signalId });

    expect(readings).toHaveLength(2);

    const [alone, inRoom] = readings;
    expect(alone.context).toEqual({ scope: "alone" });
    expect(alone.note.beliefStatement).toBe(
      "You keep circling tools that make thinking visible.",
    );
    expect(alone.note.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(alone.myRole).toEqual({
      role: "anchor",
      reason: "The save that started the thread.",
    });
    // The signal never neighbors itself; whitespace collapses to one line.
    expect(alone.neighbors).toEqual([
      {
        signalId: neighborMine,
        textPreview: "a note about visible thinking",
        ownerUserId: userId,
        ownerName: "Yunji",
        ownerAvatarUrl: null,
        isMine: true,
      },
    ]);

    expect(inRoom.context).toEqual({
      scope: "group",
      groupId,
      groupName: "잡소리",
    });
    expect(inRoom.myRole.reason).toBe("Sharpens the group's version of the pattern.");
    expect(inRoom.neighbors).toEqual([
      {
        signalId: neighborTheirs,
        textPreview: "the clip of the crowd going quiet",
        ownerUserId: jaegyuId,
        ownerName: "Jaegyu",
        ownerAvatarUrl: "https://example.com/jaegyu.png",
        isMine: false,
      },
    ]);
  });

  it("truncates long neighbor previews to one bounded line", async () => {
    const longText = "word ".repeat(100);
    const db = fakeDb(
      new Map<unknown, unknown[][]>([
        [
          topOfMindNoteSignals,
          [
            [soloCitation],
            [{ noteId: soloNoteId, signalId: neighborMine, sortOrder: 0, text: longText }],
          ],
        ],
        [users, [[{ name: "Yunji", avatarUrl: null }]]],
        [groupTopOfMindNoteSignals, [[], []]],
      ]),
    );

    const readings = await listReadingsForSignal(db, { userId, signalId });

    const preview = readings[0]?.neighbors[0]?.textPreview ?? "";
    expect(preview.length).toBeLessThanOrEqual(180);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns an empty list when nothing cited the signal", async () => {
    const db = fakeDb(
      new Map<unknown, unknown[][]>([
        [topOfMindNoteSignals, [[]]],
        [groupTopOfMindNoteSignals, [[]]],
      ]),
    );

    await expect(listReadingsForSignal(db, { userId, signalId })).resolves.toEqual(
      [],
    );
  });
});
