import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  groupConversationRooms,
  groupRoomFeedback,
  groupRoomParticipants,
  groupRoomPrompts,
  groupRoomSignals,
  inspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";

const DEFAULT_ROOM_LIMIT = 5;
const MAX_ROOM_LIMIT = 20;
const MAX_SELECTED_SIGNALS = 12;
const MAX_INVITES = 12;
const PREVIEW_LENGTH = 140;

type WakaDb = ReturnType<typeof getDb>;

const listRoomsQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_ROOM_LIMIT))
      .optional(),
  })
  .strict();

const roomParamsSchema = z.object({ roomId: z.string().uuid() }).strict();

const createRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    participantEmails: z.array(z.string().trim().email()).max(MAX_INVITES).optional(),
  })
  .strict();

const selectRoomSignalsSchema = z
  .object({
    signalIds: z.array(z.string().uuid()).min(1).max(MAX_SELECTED_SIGNALS),
    shareRaw: z.boolean().optional(),
  })
  .strict();

const createDiscussionTopicSchema = z
  .object({
    roomId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(2000).optional(),
    sourceTopOfMindNoteId: z.string().uuid().optional(),
    signalIds: z.array(z.string().uuid()).max(MAX_SELECTED_SIGNALS).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.title || value.sourceTopOfMindNoteId || (value.signalIds && value.signalIds.length > 0)),
    "title, sourceTopOfMindNoteId, or signalIds is required",
  );

const createRoomPromptSchema = z
  .object({
    seedText: z.string().trim().min(1).max(2000).optional(),
    sourceTopOfMindNoteId: z.string().uuid().optional(),
  })
  .strict();

const createRoomFeedbackSchema = z
  .object({
    promptId: z.string().uuid().optional(),
    reaction: z.enum(["useful", "unresolved", "next_topic", "action"]).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export interface GroupRoomParticipantSurface {
  id: string;
  userId: string | null;
  displayName: string;
  invitedEmail: string | null;
  role: string;
  status: string;
}

export interface GroupRoomSignalPreview {
  id: string;
  signalId: string;
  userId: string;
  /**
   * What the room may read of this signal: the whole text when its owner chose
   * `shareRaw`, otherwise a {@link PREVIEW_LENGTH}-character preview. The
   * gating happens here, at the only place room signals are turned into a
   * response, so no caller can accidentally serve the untruncated text.
   */
  textPreview: string;
  shareRaw: boolean;
  createdAt: string;
}

export interface GroupRoomPromptSurface {
  id: string;
  roomId: string;
  promptText: string;
  rationale: string;
  actionLabel: string;
  sourceTopOfMindNoteId: string | null;
  evidencePreviews: Array<Record<string, unknown>>;
  createdAt: string;
}

export interface GroupConversationRoomSurface {
  id: string;
  ownerUserId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  participants: GroupRoomParticipantSurface[];
  selectedSignals: GroupRoomSignalPreview[];
  prompts: GroupRoomPromptSurface[];
  postConversation: {
    feedbackCount: number;
    latestNote: string | null;
    nextAction: string;
  };
}

export interface GroupRoomFeedbackSurface {
  id: string;
  roomId: string;
  promptId: string | null;
  reaction: string;
  note: string;
  createdAt: string;
}

type RoomRow = {
  id: string;
  ownerUserId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
};

function isMissingGroupRoomTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCause = "cause" in error ? (error as { cause?: unknown }).cause : error;
  return Boolean(
    maybeCause &&
      typeof maybeCause === "object" &&
      "code" in maybeCause &&
      (maybeCause as { code?: unknown }).code === "42P01",
  );
}

/** Collapse runs of whitespace so a preview is one readable line. */
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncatePreview(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, PREVIEW_LENGTH - 3).trimEnd()}...`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function defaultRoomName(): string {
  return "next conversation";
}

function normalizeRoomName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultRoomName();
}

function buildPrompt(input: {
  seedText?: string;
  selectedSignals: GroupRoomSignalPreview[];
}): Pick<GroupRoomPromptSurface, "promptText" | "rationale" | "actionLabel" | "evidencePreviews"> {
  const seed = input.seedText ? normalizeWhitespace(input.seedText) : undefined;
  const signalTerms = input.selectedSignals
    .map((signal) => signal.textPreview.split(/[.!?\n]/u)[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  const base = seed || signalTerms[0] || "What is currently live for this group?";
  const contrast =
    signalTerms.length > 1
      ? ` How does that change when it is mixed with ${signalTerms.slice(1).join(" / ")}?`
      : " What would this group notice that one person alone might miss?";

  return {
    promptText: `Turn this into a discussion: ${base}${contrast}`,
    rationale:
      input.selectedSignals.length > 0
        ? "Generated from room-selected signals so the same saved idea can become a different conversation with different people."
        : "Generated from a Top of Mind seed; add room signals to make the prompt more specific to this group.",
    actionLabel: "Start with conversation",
    evidencePreviews: input.selectedSignals.map((signal) => ({
      signalId: signal.signalId,
      userId: signal.userId,
      // `textPreview` is already gated on `shareRaw` by `serializeRooms`;
      // re-truncating here was a no-op that read like a second control.
      textPreview: signal.textPreview,
      rawShared: signal.shareRaw,
    })),
  };
}

/**
 * Membership as of *now*, not membership ever.
 *
 * Both `status` columns are load-bearing and were previously ignored. A
 * participant row can outlive the participation (left, removed) and a room can
 * be ended; neither should still authorize a write. Checking them here rather
 * than at each call site means a future accept-invite or remove-member flow
 * inherits the check instead of having to remember it.
 */
async function assertRoomMembership(
  db: WakaDb,
  input: { roomId: string; userId: string },
): Promise<RoomRow | null> {
  const [row] = await db
    .select({
      id: groupConversationRooms.id,
      ownerUserId: groupConversationRooms.ownerUserId,
      name: groupConversationRooms.name,
      status: groupConversationRooms.status,
      createdAt: groupConversationRooms.createdAt,
      updatedAt: groupConversationRooms.updatedAt,
      endedAt: groupConversationRooms.endedAt,
    })
    .from(groupConversationRooms)
    .innerJoin(
      groupRoomParticipants,
      eq(groupRoomParticipants.roomId, groupConversationRooms.id),
    )
    .where(
      and(
        eq(groupConversationRooms.id, input.roomId),
        eq(groupRoomParticipants.userId, input.userId),
        eq(groupRoomParticipants.status, "active"),
        eq(groupConversationRooms.status, "active"),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function fetchOwnedSignalPreviews(
  db: WakaDb,
  input: { userId: string; signalIds: string[] },
): Promise<Array<{ id: string; userId: string; text: string }>> {
  const signalIds = unique(input.signalIds);
  if (signalIds.length === 0) return [];

  return db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
    })
    .from(inspirations)
    .where(and(eq(inspirations.userId, input.userId), inArray(inspirations.id, signalIds)));
}

async function serializeRooms(
  db: WakaDb,
  rooms: RoomRow[],
): Promise<GroupConversationRoomSurface[]> {
  if (rooms.length === 0) return [];
  const roomIds = rooms.map((room) => room.id);

  const [participants, selectedSignals, prompts, feedbackRows] = await Promise.all([
    db
      .select({
        id: groupRoomParticipants.id,
        roomId: groupRoomParticipants.roomId,
        userId: groupRoomParticipants.userId,
        displayName: groupRoomParticipants.displayName,
        invitedEmail: groupRoomParticipants.invitedEmail,
        role: groupRoomParticipants.role,
        status: groupRoomParticipants.status,
      })
      .from(groupRoomParticipants)
      .where(inArray(groupRoomParticipants.roomId, roomIds)),
    db
      .select({
        id: groupRoomSignals.id,
        roomId: groupRoomSignals.roomId,
        signalId: groupRoomSignals.signalId,
        userId: groupRoomSignals.userId,
        shareRaw: groupRoomSignals.shareRaw,
        text: inspirations.text,
        createdAt: groupRoomSignals.createdAt,
      })
      .from(groupRoomSignals)
      .innerJoin(inspirations, eq(groupRoomSignals.signalId, inspirations.id))
      .where(inArray(groupRoomSignals.roomId, roomIds))
      .orderBy(desc(groupRoomSignals.createdAt)),
    db
      .select({
        id: groupRoomPrompts.id,
        roomId: groupRoomPrompts.roomId,
        promptText: groupRoomPrompts.promptText,
        rationale: groupRoomPrompts.rationale,
        actionLabel: groupRoomPrompts.actionLabel,
        sourceTopOfMindNoteId: groupRoomPrompts.sourceTopOfMindNoteId,
        evidencePreviews: groupRoomPrompts.evidencePreviews,
        createdAt: groupRoomPrompts.createdAt,
      })
      .from(groupRoomPrompts)
      .where(inArray(groupRoomPrompts.roomId, roomIds))
      .orderBy(desc(groupRoomPrompts.createdAt)),
    db
      .select({
        roomId: groupRoomFeedback.roomId,
        note: groupRoomFeedback.note,
        reaction: groupRoomFeedback.reaction,
        createdAt: groupRoomFeedback.createdAt,
      })
      .from(groupRoomFeedback)
      .where(inArray(groupRoomFeedback.roomId, roomIds))
      .orderBy(desc(groupRoomFeedback.createdAt)),
  ]);

  return rooms.map((room) => {
    const roomFeedback = feedbackRows.filter((row) => row.roomId === room.id);
    const latestFeedback = roomFeedback[0];
    const unresolvedCount = roomFeedback.filter((row) => row.reaction === "unresolved").length;
    return {
      id: room.id,
      ownerUserId: room.ownerUserId,
      name: room.name,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      endedAt: room.endedAt?.toISOString() ?? null,
      participants: participants
        .filter((participant) => participant.roomId === room.id)
        .map((participant) => ({
          id: participant.id,
          userId: participant.userId,
          displayName: participant.displayName,
          invitedEmail: participant.invitedEmail,
          role: participant.role,
          status: participant.status,
        })),
      selectedSignals: selectedSignals
        .filter((signal) => signal.roomId === room.id)
        .map((signal) => ({
          id: signal.id,
          signalId: signal.signalId,
          userId: signal.userId,
          // The one place `shareRaw` is honored. Previously every signal was
          // truncated here regardless, which made the flag inert: a member who
          // declined to share raw text shared exactly as much as one who did.
          textPreview: signal.shareRaw
            ? normalizeWhitespace(signal.text)
            : truncatePreview(signal.text),
          shareRaw: signal.shareRaw,
          createdAt: signal.createdAt.toISOString(),
        })),
      prompts: prompts
        .filter((prompt) => prompt.roomId === room.id)
        .map((prompt) => ({
          id: prompt.id,
          roomId: prompt.roomId,
          promptText: prompt.promptText,
          rationale: prompt.rationale,
          actionLabel: prompt.actionLabel,
          sourceTopOfMindNoteId: prompt.sourceTopOfMindNoteId,
          evidencePreviews: prompt.evidencePreviews,
          createdAt: prompt.createdAt.toISOString(),
        })),
      postConversation: {
        feedbackCount: roomFeedback.length,
        latestNote: latestFeedback?.note?.trim() || null,
        nextAction:
          unresolvedCount > 0
            ? "Turn the unresolved thread into the next discussion topic"
            : "Save one more signal before the next conversation",
      },
    };
  });
}

export async function listGroupRoomsForUser(
  db: WakaDb,
  input: { userId: string; limit: number },
): Promise<GroupConversationRoomSurface[]> {
  let rows: RoomRow[];
  try {
    rows = await db
      .select({
        id: groupConversationRooms.id,
        ownerUserId: groupConversationRooms.ownerUserId,
        name: groupConversationRooms.name,
        status: groupConversationRooms.status,
        createdAt: groupConversationRooms.createdAt,
        updatedAt: groupConversationRooms.updatedAt,
        endedAt: groupConversationRooms.endedAt,
      })
      .from(groupConversationRooms)
      .innerJoin(
        groupRoomParticipants,
        eq(groupRoomParticipants.roomId, groupConversationRooms.id),
      )
      .where(
        and(
          eq(groupRoomParticipants.userId, input.userId),
          // A room you were removed from stops being yours to see. Ended rooms
          // stay listed on purpose — they are history, not access.
          eq(groupRoomParticipants.status, "active"),
        ),
      )
      .orderBy(desc(groupConversationRooms.updatedAt))
      .limit(input.limit);
  } catch (error) {
    if (isMissingGroupRoomTableError(error)) return [];
    throw error;
  }

  return serializeRooms(db, rows);
}

export async function createGroupRoomForUser(
  db: WakaDb,
  input: { userId: string; name?: string; participantEmails?: string[] },
): Promise<GroupConversationRoomSurface> {
  const now = new Date();
  const [room] = await db
    .insert(groupConversationRooms)
    .values({
      ownerUserId: input.userId,
      name: normalizeRoomName(input.name),
      updatedAt: now,
    })
    .returning({
      id: groupConversationRooms.id,
      ownerUserId: groupConversationRooms.ownerUserId,
      name: groupConversationRooms.name,
      status: groupConversationRooms.status,
      createdAt: groupConversationRooms.createdAt,
      updatedAt: groupConversationRooms.updatedAt,
      endedAt: groupConversationRooms.endedAt,
    });

  await db.insert(groupRoomParticipants).values([
    {
      roomId: room.id,
      userId: input.userId,
      role: "owner",
      status: "active",
    },
    ...unique(input.participantEmails ?? []).map((email) => ({
      roomId: room.id,
      invitedEmail: email,
      displayName: email,
      role: "member",
      status: "invited",
    })),
  ]);

  const [surface] = await serializeRooms(db, [room]);
  return surface;
}

export async function addSignalsToGroupRoom(
  db: WakaDb,
  input: { userId: string; roomId: string; signalIds: string[]; shareRaw?: boolean },
): Promise<GroupConversationRoomSurface | null> {
  const room = await assertRoomMembership(db, input);
  if (!room) return null;

  const ownedSignals = await fetchOwnedSignalPreviews(db, input);
  if (ownedSignals.length !== unique(input.signalIds).length) return null;
  if (ownedSignals.length > 0) {
    await db
      .insert(groupRoomSignals)
      .values(
        ownedSignals.map((signal) => ({
          roomId: input.roomId,
          userId: input.userId,
          signalId: signal.id,
          shareRaw: input.shareRaw ?? false,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .update(groupConversationRooms)
    .set({ updatedAt: new Date() })
    .where(eq(groupConversationRooms.id, input.roomId));

  const [surface] = await serializeRooms(db, [{ ...room, updatedAt: new Date() }]);
  return surface;
}

/**
 * A Top of Mind note may only seed a prompt for the person who owns it.
 * Without this the id is a free-text foreign key: any member could stamp a
 * prompt as sourced from someone else's note, and a 404-vs-201 difference
 * would confirm whether an arbitrary note id exists.
 */
async function assertOwnedTopOfMindNote(
  db: WakaDb,
  input: { userId: string; noteId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: wowMoments.id })
    .from(wowMoments)
    .where(and(eq(wowMoments.id, input.noteId), eq(wowMoments.userId, input.userId)))
    .limit(1);
  return Boolean(row);
}

async function createPromptInRoom(
  db: WakaDb,
  input: { userId: string; roomId: string; seedText?: string; sourceTopOfMindNoteId?: string },
): Promise<{ room: GroupConversationRoomSurface; prompt: GroupRoomPromptSurface } | null> {
  const room = await assertRoomMembership(db, input);
  if (!room) return null;
  if (
    input.sourceTopOfMindNoteId &&
    !(await assertOwnedTopOfMindNote(db, {
      userId: input.userId,
      noteId: input.sourceTopOfMindNoteId,
    }))
  ) {
    return null;
  }
  const [roomSurface] = await serializeRooms(db, [room]);
  const generated = buildPrompt({
    seedText: input.seedText,
    selectedSignals: roomSurface.selectedSignals,
  });
  const [prompt] = await db
    .insert(groupRoomPrompts)
    .values({
      roomId: input.roomId,
      createdByUserId: input.userId,
      sourceTopOfMindNoteId: input.sourceTopOfMindNoteId,
      promptText: generated.promptText,
      rationale: generated.rationale,
      actionLabel: generated.actionLabel,
      evidencePreviews: generated.evidencePreviews,
    })
    .returning({
      id: groupRoomPrompts.id,
      roomId: groupRoomPrompts.roomId,
      promptText: groupRoomPrompts.promptText,
      rationale: groupRoomPrompts.rationale,
      actionLabel: groupRoomPrompts.actionLabel,
      sourceTopOfMindNoteId: groupRoomPrompts.sourceTopOfMindNoteId,
      evidencePreviews: groupRoomPrompts.evidencePreviews,
      createdAt: groupRoomPrompts.createdAt,
    });

  const updatedAt = new Date();
  await db
    .update(groupConversationRooms)
    .set({ updatedAt })
    .where(eq(groupConversationRooms.id, input.roomId));

  // Serialize *this* room. It previously re-read "the caller's most recently
  // updated room" and relied on the update above having made that the same
  // room — which a concurrent write to another room quietly breaks.
  const [updatedRoom] = await serializeRooms(db, [{ ...room, updatedAt }]);
  return {
    room: updatedRoom,
    prompt: {
      ...prompt,
      createdAt: prompt.createdAt.toISOString(),
    },
  };
}

export async function createDiscussionTopicForUser(
  db: WakaDb,
  input: {
    userId: string;
    roomId?: string;
    title?: string;
    sourceTopOfMindNoteId?: string;
    signalIds?: string[];
  },
): Promise<{ room: GroupConversationRoomSurface; prompt: GroupRoomPromptSurface } | null> {
  let roomId = input.roomId;
  if (!roomId) {
    const [latestRoom] = await listGroupRoomsForUser(db, { userId: input.userId, limit: 1 });
    roomId = latestRoom?.id;
  }
  if (!roomId) {
    const room = await createGroupRoomForUser(db, { userId: input.userId });
    roomId = room.id;
  }
  if (input.signalIds && input.signalIds.length > 0) {
    const room = await addSignalsToGroupRoom(db, {
      userId: input.userId,
      roomId,
      signalIds: input.signalIds,
    });
    if (!room) return null;
  }
  return createPromptInRoom(db, {
    userId: input.userId,
    roomId,
    seedText: input.title,
    sourceTopOfMindNoteId: input.sourceTopOfMindNoteId,
  });
}

export async function createGroupRoomFeedback(
  db: WakaDb,
  input: { userId: string; roomId: string; promptId?: string; reaction?: string; note?: string },
): Promise<{ room: GroupConversationRoomSurface; feedback: GroupRoomFeedbackSurface } | null> {
  const room = await assertRoomMembership(db, input);
  if (!room) return null;

  // Feedback belongs to a prompt *in this room*. The FK only proves the prompt
  // exists somewhere, so without this a member of one room could attach
  // feedback to another room's prompt and learn that it exists.
  if (input.promptId) {
    const [prompt] = await db
      .select({ id: groupRoomPrompts.id })
      .from(groupRoomPrompts)
      .where(
        and(
          eq(groupRoomPrompts.id, input.promptId),
          eq(groupRoomPrompts.roomId, input.roomId),
        ),
      )
      .limit(1);
    if (!prompt) return null;
  }

  const [feedback] = await db
    .insert(groupRoomFeedback)
    .values({
      roomId: input.roomId,
      promptId: input.promptId,
      userId: input.userId,
      reaction: input.reaction ?? "useful",
      note: input.note ?? "",
      metadata: {
        createsReasonToSaveMoreSignals: true,
      },
    })
    .returning({
      id: groupRoomFeedback.id,
      roomId: groupRoomFeedback.roomId,
      promptId: groupRoomFeedback.promptId,
      reaction: groupRoomFeedback.reaction,
      note: groupRoomFeedback.note,
      createdAt: groupRoomFeedback.createdAt,
    });

  await db
    .update(groupConversationRooms)
    .set({
      updatedAt: new Date(),
      feedbackSummary: {
        latestReaction: feedback.reaction,
        latestNote: feedback.note,
        nextAction:
          feedback.reaction === "unresolved"
            ? "Turn this unresolved thread into the next discussion topic"
            : "Save one more signal before the next conversation",
      },
    })
    .where(eq(groupConversationRooms.id, input.roomId));

  const [updatedRoom] = await serializeRooms(db, [{ ...room, updatedAt: new Date() }]);
  return {
    room: updatedRoom,
    feedback: {
      ...feedback,
      createdAt: feedback.createdAt.toISOString(),
    },
  };
}

export interface GroupRoomRouteDependencies {
  getDatabase?: typeof getDb;
  listRooms?: typeof listGroupRoomsForUser;
  createRoom?: typeof createGroupRoomForUser;
  addSignals?: typeof addSignalsToGroupRoom;
  createDiscussionTopic?: typeof createDiscussionTopicForUser;
  createPrompt?: typeof createPromptInRoom;
  createFeedback?: typeof createGroupRoomFeedback;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createGroupRoomRoutes(
  deps: GroupRoomRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listRooms = deps.listRooms ?? listGroupRoomsForUser;
  const createRoom = deps.createRoom ?? createGroupRoomForUser;
  const addSignals = deps.addSignals ?? addSignalsToGroupRoom;
  const createDiscussionTopic = deps.createDiscussionTopic ?? createDiscussionTopicForUser;
  const createPrompt = deps.createPrompt ?? createPromptInRoom;
  const createFeedback = deps.createFeedback ?? createGroupRoomFeedback;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = listRoomsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid group room query", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const rooms = await listRooms(getDatabase(), {
      userId: c.get("user").id,
      limit: parsed.data.limit ?? DEFAULT_ROOM_LIMIT,
    });
    return c.json({ rooms });
  });

  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = createRoomSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid group room", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const room = await createRoom(getDatabase(), {
      userId: c.get("user").id,
      ...parsed.data,
    });
    return c.json({ room }, 201);
  });

  routes.post("/discussion-topic", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = createDiscussionTopicSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid discussion topic", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const result = await createDiscussionTopic(getDatabase(), {
      userId: c.get("user").id,
      ...parsed.data,
    });
    if (!result) return c.json({ error: "Group room not found" }, 404);
    return c.json(result, 201);
  });

  routes.post("/:roomId/signals", async (c) => {
    const params = roomParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: "Invalid group room id", details: params.error.flatten().fieldErrors }, 400);
    }
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = selectRoomSignalsSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid room signals", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const room = await addSignals(getDatabase(), {
      userId: c.get("user").id,
      roomId: params.data.roomId,
      ...parsed.data,
    });
    if (!room) return c.json({ error: "Group room or signal not found" }, 404);
    return c.json({ room });
  });

  routes.post("/:roomId/prompts", async (c) => {
    const params = roomParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: "Invalid group room id", details: params.error.flatten().fieldErrors }, 400);
    }
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = createRoomPromptSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid room prompt", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const result = await createPrompt(getDatabase(), {
      userId: c.get("user").id,
      roomId: params.data.roomId,
      ...parsed.data,
    });
    if (!result) return c.json({ error: "Group room not found" }, 404);
    return c.json(result, 201);
  });

  routes.post("/:roomId/feedback", async (c) => {
    const params = roomParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: "Invalid group room id", details: params.error.flatten().fieldErrors }, 400);
    }
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = createRoomFeedbackSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid room feedback", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const result = await createFeedback(getDatabase(), {
      userId: c.get("user").id,
      roomId: params.data.roomId,
      ...parsed.data,
    });
    if (!result) return c.json({ error: "Group room not found" }, 404);
    return c.json(result, 201);
  });

  return routes;
}

export const groupRoomRoutes = createGroupRoomRoutes();
