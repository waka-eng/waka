import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createTopOfMindRoutes,
  getTopOfMindNoteForUser,
  listTopOfMindNotesForUser,
  type TopOfMindNoteSurface,
} from "./top-of-mind.js";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  preferredLocale: "en-US" as const,
};

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createMomentsSelect<T>(terminal: T) {
  const limit = vi.fn(async () => terminal);
  return {
    limit,
    builder: {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit })),
        })),
      })),
    },
  };
}

function createMomentByIdSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => terminal),
      })),
    })),
  };
}

function createRelatedRowsSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => terminal),
        })),
      })),
    })),
  };
}

function createFeedbackRowsSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(async () => terminal),
      })),
    })),
  };
}

describe("GET /api/top-of-mind", () => {
  it("returns top-of-mind notes and keeps the preview compatibility field", async () => {
    const topOfMind = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      headline: "Top of mind: what kind of life would make this work worth it",
      activeThemes: [],
      activeQuestions: [
        {
          nodeId: "node-1",
          label: "what kind of life would make this work worth it",
          type: "question",
          reason: "The meaning graph infers a live work/life question.",
          evidenceCount: 4,
          lastReinforcedAt: "2026-05-24T10:00:00.000Z",
          supportingInspirations: [],
        },
      ],
      relationshipSignals: [],
      summary: {
        inspirationCount: 12,
        meaningNoteCount: 7,
        relationshipEdgeCount: 3,
      },
    };
    const getTopOfMind = vi.fn(async () => topOfMind);
    const note: TopOfMindNoteSurface = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "I need workrooms where making the thing is the default temperature.",
      ambitionDimension: "work",
      ambientSignal: "I need workrooms where making the thing is the default temperature.",
      matchedEnvironment: "A working culture where rituals become visible through repeated making.",
      antiEnvironment: "Work contexts that reward commentary while the real object stays abstract.",
      evidenceRationale: "Three saved signals are clustering around this frequency.",
      rejectedAlternativeInterpretation: null,
      type: "pattern",
      body: "Multiple signals keep circling the same careful ritual.",
      prompt: null,
      guidance: null,
      confidence: 82,
      status: "active",
      isPinned: false,
      userFeedbackValue: null,
      relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
      relatedContextNodeIds: [],
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
      source: "wow_moment_compatibility",
      isProvisional: true,
      legacy: {
        wowMomentId: "00000000-0000-4000-8000-000000000010",
        wowKind: "recurrence",
        wowScore: 82,
      },
      evidencePreviews: [],
      relatedSignals: [],
    };
    const listNotes = vi.fn(async () => [note]);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        listNotes,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=7");

    expect(response.status).toBe(200);
    expect(getTopOfMind).toHaveBeenCalledWith(db, user.id);
    expect(listNotes).toHaveBeenCalledWith(db, {
      userId: user.id,
      limit: 7,
      preferredLocale: "en-US",
    });
    await expect(response.json()).resolves.toMatchObject({
      topOfMind,
      topOfMindNotes: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          title: "I need workrooms where making the thing is the default temperature.",
          ambitionDimension: "work",
          ambientSignal: "I need workrooms where making the thing is the default temperature.",
          status: "active",
          source: "wow_moment_compatibility",
        },
      ],
    });
  });

  it("does not synthesize renderable notes from preview graph signals when note storage is empty", async () => {
    const topOfMind = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      headline: "Top of mind: RAW_GRAPH_LABEL_preview_headline",
      activeThemes: [
        {
          nodeId: "node-theme-raw",
          label: "RAW_GRAPH_LABEL_frequency_scaffold",
          type: "theme",
          reason: "Supporting signals and Memory movement are compatibility preview metadata.",
          evidenceCount: 4,
          lastReinforcedAt: "2026-05-24T10:00:00.000Z",
          supportingInspirations: [
            {
              id: "00000000-0000-4000-8000-000000000201",
              preview: "Source-label scaffold should not become a note.",
              reason: "frequency scaffold",
              createdAt: "2026-05-23T10:00:00.000Z",
            },
          ],
        },
      ],
      activeQuestions: [
        {
          nodeId: "node-question-raw",
          label: "Top of mind: template question scaffold",
          type: "question",
          reason: "Raw graph labels are preview-only compatibility data.",
          evidenceCount: 3,
          lastReinforcedAt: "2026-05-24T10:00:00.000Z",
          supportingInspirations: [],
        },
      ],
      relationshipSignals: [],
      summary: {
        inspirationCount: 12,
        meaningNoteCount: 0,
        relationshipEdgeCount: 3,
      },
    };
    const getTopOfMind = vi.fn(async () => topOfMind);
    const listNotes = vi.fn(async () => []);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        listNotes,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=7");

    expect(response.status).toBe(200);
    expect(listNotes).toHaveBeenCalledWith(db, {
      userId: user.id,
      limit: 7,
      preferredLocale: "en-US",
    });
    await expect(response.json()).resolves.toMatchObject({
      topOfMind,
      topOfMindNotes: [],
    });
  });

  it("serializes active note evidence previews without exposing admin graph internals", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "Rituals keep returning",
      kind: "recurrence",
      why: "Multiple signals keep circling the same careful ritual. Ambient signal: a question becomes real when it meets public cost Matched environment: A practical setting where rituals keep returning can be tested in public conditions. Anti-environment: Analysis loops that keep the question safe, abstract, and uncostly. Evidence rationale: This post-it is inferred from saved signals and may change as the graph gets better evidence.",
      reflectionQuestion: null,
      reflectionGuide: "Try one small version this week.",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const relatedRows = [
      {
        wowMomentId: moment.id,
        inspirationId: "00000000-0000-4000-8000-000000000101",
        role: "Source signal",
        reason: "This signal shows the recurring ritual.",
        sortOrder: 0,
        inspirationText: "Signal text with enough detail to explain the post-it.",
        inspirationKind: "note",
        inspirationCreatedAt: new Date("2026-05-29T10:00:00.000Z"),
        inspirationWowScore: 64,
      },
    ];
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect(relatedRows))
        .mockReturnValueOnce(
          createRelatedRowsSelect([
            {
              wowMomentId: moment.id,
              meaningNodeId: "00000000-0000-4000-8000-000000000201",
            },
          ]),
        )
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };
    const getTopOfMind = vi.fn(async () => ({
      generatedAt: "2026-05-30T12:00:00.000Z",
      headline: "Top of mind",
      activeThemes: [],
      activeQuestions: [],
      relationshipSignals: [],
      summary: {
        inspirationCount: 1,
        meaningNoteCount: 0,
        relationshipEdgeCount: 0,
      },
    }));
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    expect(momentsSelect.limit).toHaveBeenCalledWith(21);
    const body = (await response.json()) as { topOfMindNotes: unknown[] };
    expect(body.topOfMindNotes).toEqual([
      expect.objectContaining({
        id: moment.id,
        userId: user.id,
        title: "Rituals keep returning",
        ambitionDimension: "place",
        ambientSignal: "a question becomes real when it meets public cost",
        matchedEnvironment: "A practical setting where rituals keep returning can be tested in public conditions.",
        antiEnvironment: "Analysis loops that keep the question safe, abstract, and uncostly.",
        evidenceRationale:
          "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
        type: "action",
        body: "Multiple signals keep circling the same careful ritual.",
        confidence: 82,
        status: "active",
        relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
        relatedContextNodeIds: ["00000000-0000-4000-8000-000000000201"],
        evidencePreviews: [
          {
            signalId: "00000000-0000-4000-8000-000000000101",
            role: "Source signal",
            reason: "This signal shows the recurring ritual.",
            textPreview: "Signal text with enough detail to explain the post-it.",
            kind: "note",
            createdAt: "2026-05-29T10:00:00.000Z",
            resonanceScore: 64,
          },
        ],
        relatedSignals: [
          {
            id: "00000000-0000-4000-8000-000000000101",
            preview: "Signal text with enough detail to explain the post-it.",
            kind: "note",
            createdAt: "2026-05-29T10:00:00.000Z",
            resonanceScore: 64,
          },
        ],
        legacy: {
          wowMomentId: moment.id,
          wowKind: "recurrence",
          wowScore: 82,
        },
      }),
    ]);
    expect(JSON.stringify(body.topOfMindNotes)).not.toContain("meaningNodeId");
    expect(JSON.stringify(body.topOfMindNotes)).not.toContain("admin");
  });

  it("keeps English persisted notes visible for Korean users because readback uses note locale", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "a question becomes real when it meets public cost",
      kind: "outlier",
      why: "Ambient signal: a question becomes real when it meets public cost Matched environment: A practical setting where a question can be tested in public conditions. Anti-environment: Analysis loops that keep the question safe. Evidence rationale: Two saved signals support this.",
      beliefStatement: "a question becomes real when it meets public cost",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const relatedRows = [
      {
        wowMomentId: moment.id,
        inspirationId: "00000000-0000-4000-8000-000000000101",
        role: "Evidence signal",
        reason: "This signal supports the note.",
        sortOrder: 0,
        inspirationText: "한국어로 저장된 첫 번째 영감입니다.",
        inspirationKind: "note",
        inspirationCreatedAt: new Date("2026-05-29T10:00:00.000Z"),
        inspirationWowScore: 64,
      },
      {
        wowMomentId: moment.id,
        inspirationId: "00000000-0000-4000-8000-000000000102",
        role: "Evidence signal",
        reason: "This second signal supports the same note.",
        sortOrder: 1,
        inspirationText: "두 번째 관련 영감입니다.",
        inspirationKind: "note",
        inspirationCreatedAt: new Date("2026-05-29T11:00:00.000Z"),
        inspirationWowScore: 70,
      },
    ];
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect(relatedRows))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "ko-KR",
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: moment.id,
      title: "a question becomes real when it meets public cost",
      ambientSignal: "a question becomes real when it meets public cost",
      status: "active",
      relatedSignalIds: [
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102",
      ],
    });
    expect(notes[0]?.evidencePreviews).toHaveLength(2);
    expect(notes[0]?.relatedSignals).toHaveLength(2);
  });

  it("marks Korean notes unavailable when only non-title fields contain Hangul", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000030",
      userId: user.id,
      title: "A room keeps asking for unfinished ambition",
      kind: "recurrence",
      why: "한국어 본문이 남아 있지만 제목 후보는 영어입니다. Ambient signal: a room where unfinished ambition is allowed Matched environment: 작은 실험이 안전한 방. Anti-environment: 완벽해질 때까지 미루는 환경. Evidence rationale: 저장된 신호가 같은 감각을 지지합니다.",
      beliefStatement: "a room where unfinished ambition is allowed",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "ko-KR",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "ko-KR",
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: moment.id,
      title: "",
      matchedEnvironment: "작은 실험이 안전한 방.",
      status: "unavailable",
    });
  });

  it("keeps Hangul-containing Korean notes active for Korean users", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000020",
      userId: user.id,
      title: "people in rooms where 작은 실험 stays alive",
      kind: "recurrence",
      why: "한국어 본문이 남아 있는 노트입니다. Ambient signal: people in rooms where 작은 실험 stays alive Matched environment: 동료가 작은 실험을 공개해도 안전한 방. Anti-environment: 질문을 숨기고 완벽해질 때까지 미루는 환경. Evidence rationale: 세 개의 저장된 신호가 같은 감각을 지지합니다.",
      beliefStatement: "people in rooms where 작은 실험 stays alive",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "ko-KR",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "ko-KR",
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: moment.id,
      title: "people in rooms where 작은 실험 stays alive",
      ambientSignal: "people in rooms where 작은 실험 stays alive",
      matchedEnvironment: "동료가 작은 실험을 공개해도 안전한 방.",
      antiEnvironment: "질문을 숨기고 완벽해질 때까지 미루는 환경.",
      evidenceRationale: "세 개의 저장된 신호가 같은 감각을 지지합니다.",
      body: "한국어 본문이 남아 있는 노트입니다.",
      status: "active",
    });
  });

  it("keeps fully Hangul synthesized Korean notes active through list readback", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000021",
      userId: user.id,
      title: "작게 공개하는 실험이 용기를 만든다",
      kind: "recurrence",
      why: "Ambient signal: 작게 공개하는 실험이 용기를 만든다. Matched environment: 초안을 보여 주고 바로 배우는 동료의 방. Anti-environment: 완벽해질 때까지 혼자 감추는 환경. Evidence rationale: 저장된 신호들이 공개 실험의 리듬을 함께 가리킵니다.",
      beliefStatement: "작게 공개하는 실험이 용기를 만든다",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "ko-KR",
      wowScore: 88,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "ko-KR",
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: moment.id,
      title: "작게 공개하는 실험이 용기를 만든다",
      ambientSignal: "작게 공개하는 실험이 용기를 만든다",
      matchedEnvironment: "초안을 보여 주고 바로 배우는 동료의 방.",
      antiEnvironment: "완벽해질 때까지 혼자 감추는 환경.",
      evidenceRationale: "저장된 신호들이 공개 실험의 리듬을 함께 가리킵니다.",
      status: "active",
    });
    expect(JSON.stringify(notes[0])).not.toContain("a room where unfinished ambition is allowed");
    expect(JSON.stringify(notes[0])).not.toContain("deterministic fallback");
  });

  it("dedupes normalized duplicate notes and keeps the pinned strongest note", async () => {
    const older = {
      id: "00000000-0000-4000-8000-000000000031",
      userId: user.id,
      title: "Rooms where unfinished ambition is allowed.",
      kind: "recurrence",
      why: "Ambient signal: rooms where unfinished ambition is allowed. Matched environment: A room where unfinished ambition can be shown. Anti-environment: polished-only rooms. Evidence rationale: Saved signals point there.",
      beliefStatement: "rooms where unfinished ambition is allowed",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 91,
      createdAt: new Date("2026-05-29T10:00:00.000Z"),
      updatedAt: new Date("2026-05-29T11:00:00.000Z"),
    };
    const pinned = {
      ...older,
      id: "00000000-0000-4000-8000-000000000032",
      title: "rooms where unfinished ambition is allowed",
      wowScore: 70,
      createdAt: new Date("2026-05-28T10:00:00.000Z"),
      updatedAt: new Date("2026-05-28T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([older, pinned]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: pinned.id,
              value: "important",
              correctionText: null,
              metadata: {},
            },
          ]),
        ),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "en-US",
    });

    expect(momentsSelect.limit).toHaveBeenCalledWith(25);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: pinned.id, isPinned: true });
  });

  it("orders dedupe clusters by their earliest row while returning the pinned winner", async () => {
    const duplicateHigh = {
      id: "00000000-0000-4000-8000-000000000131",
      userId: user.id,
      title: "Rooms where unfinished ambition is allowed",
      kind: "recurrence",
      why: "Ambient signal: rooms where unfinished ambition is allowed. Matched environment: A room where unfinished ambition can be shown. Anti-environment: polished-only rooms. Evidence rationale: Saved signals point there.",
      beliefStatement: "rooms where unfinished ambition is allowed",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 90,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const distinctMid = {
      ...duplicateHigh,
      id: "00000000-0000-4000-8000-000000000132",
      title: "Quiet repair belongs near neighbors",
      kind: "tension",
      why: "Ambient signal: quiet repair belongs near neighbors. Matched environment: a street-level place. Anti-environment: abstract civic talk. Evidence rationale: Different signals support it.",
      beliefStatement: "quiet repair belongs near neighbors",
      wowScore: 80,
      createdAt: new Date("2026-05-29T10:00:00.000Z"),
      updatedAt: new Date("2026-05-29T11:00:00.000Z"),
    };
    const duplicatePinned = {
      ...duplicateHigh,
      id: "00000000-0000-4000-8000-000000000133",
      title: "rooms where unfinished ambition is allowed.",
      wowScore: 10,
      createdAt: new Date("2026-05-28T10:00:00.000Z"),
      updatedAt: new Date("2026-05-28T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([duplicateHigh, distinctMid, duplicatePinned]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: duplicatePinned.id,
              value: "important",
              correctionText: null,
              metadata: {},
            },
          ]),
        ),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 1,
      preferredLocale: "en-US",
    });

    expect(momentsSelect.limit).toHaveBeenCalledWith(21);
    expect(notes.map((note) => note.id)).toEqual([duplicatePinned.id]);
    expect(notes[0]).toMatchObject({ isPinned: true });
  });

  it("dedupes high source-overlap notes while preserving non-overlapping notes", async () => {
    const duplicateA = {
      id: "00000000-0000-4000-8000-000000000041",
      userId: user.id,
      title: "Public experiments keep asking for real rooms",
      kind: "bridge",
      why: "Ambient signal: public experiments need real rooms. Matched environment: A room where experiments can be visible. Anti-environment: private overthinking. Evidence rationale: The same source set supports it.",
      beliefStatement: "public experiments need real rooms",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 80,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const duplicateB = {
      ...duplicateA,
      id: "00000000-0000-4000-8000-000000000042",
      title: "Real rooms keep asking for public experiments",
      wowScore: 70,
      createdAt: new Date("2026-05-29T10:00:00.000Z"),
      updatedAt: new Date("2026-05-29T11:00:00.000Z"),
    };
    const distinct = {
      ...duplicateA,
      id: "00000000-0000-4000-8000-000000000043",
      title: "Quiet repair belongs near neighbors",
      kind: "tension",
      why: "Ambient signal: quiet repair belongs near neighbors. Matched environment: a street-level place. Anti-environment: abstract civic talk. Evidence rationale: Different signals support it.",
      beliefStatement: "quiet repair belongs near neighbors",
      createdAt: new Date("2026-05-28T10:00:00.000Z"),
      updatedAt: new Date("2026-05-28T11:00:00.000Z"),
    };
    const sourceA = "00000000-0000-4000-8000-000000000101";
    const sourceB = "00000000-0000-4000-8000-000000000102";
    const relatedRows = [duplicateA, duplicateB, distinct].flatMap((moment) =>
      (moment.id === distinct.id ? ["00000000-0000-4000-8000-000000000103"] : [sourceA, sourceB]).map(
        (inspirationId, index) => ({
          wowMomentId: moment.id,
          inspirationId,
          role: "Source signal",
          reason: "This source supports the note.",
          sortOrder: index,
          inspirationText: `source ${inspirationId}`,
          inspirationKind: "note",
          inspirationCreatedAt: new Date("2026-05-29T10:00:00.000Z"),
          inspirationWowScore: 64,
        }),
      ),
    );
    const momentsSelect = createMomentsSelect([duplicateA, duplicateB, distinct]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect(relatedRows))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "en-US",
    });

    expect(notes.map((note) => note.id)).toEqual([duplicateA.id, distinct.id]);
  });

  it("does not dedupe cross-user rows because list queries remain tenant scoped", async () => {
    const sameTitleForSignedInUser = {
      id: "00000000-0000-4000-8000-000000000051",
      userId: user.id,
      title: "A shared-looking title",
      kind: "recurrence",
      why: "Ambient signal: a shared-looking title. Matched environment: user room. Anti-environment: other room. Evidence rationale: tenant scoped.",
      beliefStatement: "a shared-looking title",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 80,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([sameTitleForSignedInUser]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const notes = await listTopOfMindNotesForUser(db as any, {
      userId: user.id,
      limit: 5,
      preferredLocale: "en-US",
    });

    expect(notes.map((note) => note.id)).toEqual([sameTitleForSignedInUser.id]);
  });

  it("keeps a deduped note accessible through direct detail readback", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000061",
      userId: user.id,
      title: "Rooms where unfinished ambition is allowed",
      kind: "recurrence",
      why: "Ambient signal: rooms where unfinished ambition is allowed. Matched environment: a room. Anti-environment: polished-only rooms. Evidence rationale: two signals.",
      beliefStatement: "rooms where unfinished ambition is allowed",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "en-US",
      wowScore: 50,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(createMomentByIdSelect([moment]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };

    const note = await getTopOfMindNoteForUser(db as any, {
      userId: user.id,
      noteId: moment.id,
      preferredLocale: "en-US",
    });

    expect(note).toMatchObject({
      id: moment.id,
      title: "rooms where unfinished ambition is allowed",
    });
  });

  it("hides stale notes from top-of-mind list readback", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "This reflection may be stale",
      kind: "tension",
      why: "The note no longer feels true.",
      reflectionQuestion: null,
      reflectionGuide: null,
      wowScore: 52,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: moment.id,
              metadata: {
                appliedFeedback: {
                  source: "user_feedback",
                  topOfMindNoteStatus: "stale",
                },
              },
            },
          ]),
        ),
    };
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(async () => ({
          generatedAt: "2026-05-30T12:00:00.000Z",
          headline: "Top of mind",
          activeThemes: [],
          activeQuestions: [],
          relationshipSignals: [],
          summary: {
            inspirationCount: 1,
            meaningNoteCount: 0,
            relationshipEdgeCount: 0,
          },
        })),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNotes: [],
    });
  });

  it("surfaces the latest long user correction as the top-of-mind note text", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000011",
      userId: user.id,
      title: "Original generated note",
      kind: "bridge",
      why: "The generated note was close but not exact.",
      reflectionQuestion: null,
      reflectionGuide: null,
      wowScore: 58,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const longCorrectionText = `${"choose the people I build with ".repeat(52)}without shrinking the thought`.trim();
    expect(longCorrectionText.length).toBeGreaterThan(1450);
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: moment.id,
              value: "important",
              correctionText: null,
              metadata: {},
            },
            {
              targetId: moment.id,
              value: "partly",
              correctionText: longCorrectionText,
              metadata: {},
            },
          ]),
        ),
    };
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(async () => ({
          generatedAt: "2026-05-30T12:00:00.000Z",
          headline: "Top of mind",
          activeThemes: [],
          activeQuestions: [],
          relationshipSignals: [],
          summary: {
            inspirationCount: 1,
            meaningNoteCount: 0,
            relationshipEdgeCount: 0,
          },
        })),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNotes: [
        {
          id: moment.id,
          title: longCorrectionText,
          ambientSignal: longCorrectionText,
        },
      ],
    });
  });

  it("reads back value-only top-of-mind feedback as pin and feedback value", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000012",
      userId: user.id,
      title: "Original generated note",
      kind: "recurrence",
      why: "The generated note is useful enough to pin.",
      reflectionQuestion: null,
      reflectionGuide: null,
      wowScore: 74,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: moment.id,
              value: "important",
              correctionText: null,
              metadata: {},
            },
          ]),
        ),
    };
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(async () => ({
          generatedAt: "2026-05-30T12:00:00.000Z",
          headline: "Top of mind",
          activeThemes: [],
          activeQuestions: [],
          relationshipSignals: [],
          summary: {
            inspirationCount: 1,
            meaningNoteCount: 0,
            relationshipEdgeCount: 0,
          },
        })),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNotes: [
        {
          id: moment.id,
          isPinned: true,
          userFeedbackValue: "important",
        },
      ],
    });
  });

  it("updates top-of-mind note title through the note endpoint", async () => {
    const updatedNote = {
      id: "00000000-0000-4000-8000-000000000012",
      title: "choose the people I build with",
      ambientSignal: "choose the people I build with",
    };
    const updateNote = vi.fn(async () => updatedNote as TopOfMindNoteSurface);
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        updateNote,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(`/api/top-of-mind/${updatedNote.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "choose the people I build with" }),
    });

    expect(response.status).toBe(200);
    expect(updateNote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: user.id,
        noteId: updatedNote.id,
        title: "choose the people I build with",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNote: updatedNote,
    });
  });

  it("rejects invalid list query parameters", async () => {
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        listNotes: vi.fn(),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=0");

    expect(response.status).toBe(400);
  });
});

it("returns null for stale top-of-mind note detail readback", async () => {
  const moment = {
    id: "00000000-0000-4000-8000-000000000013",
    userId: user.id,
    title: "This reflection was pulled down",
    kind: "tension",
    why: "The note no longer feels true.",
    beliefStatement: null,
    reflectionQuestion: null,
    reflectionGuide: null,
    locale: "en-US",
    wowScore: 52,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    updatedAt: new Date("2026-05-30T11:00:00.000Z"),
  };
  const db = {
    select: vi
      .fn()
      .mockReturnValueOnce(createMomentByIdSelect([moment]))
      .mockReturnValueOnce(createRelatedRowsSelect([]))
      .mockReturnValueOnce(createRelatedRowsSelect([]))
      .mockReturnValueOnce(
        createFeedbackRowsSelect([
          {
            targetId: moment.id,
            value: "not_true",
            correctionText: "pulled down from the wall",
            metadata: {
              appliedFeedback: {
                source: "user_feedback",
                topOfMindNoteStatus: "stale",
              },
            },
          },
        ]),
      ),
  };

  await expect(
    getTopOfMindNoteForUser(db as any, {
      userId: user.id,
      noteId: moment.id,
      preferredLocale: "en-US",
    }),
  ).resolves.toBeNull();
});

describe("GET /api/top-of-mind/:noteId", () => {
  it("returns one note scoped to the signed-in tenant", async () => {
    const noteId = "00000000-0000-4000-8000-000000000010";
    const note: TopOfMindNoteSurface = {
      id: noteId,
      userId: user.id,
      title: "A provisional reflection",
      ambitionDimension: "next_experiment",
      ambientSignal: "a question becomes real when it meets public cost",
      matchedEnvironment: "A practical setting where a provisional reflection can be tested in public conditions.",
      antiEnvironment: "Analysis loops that keep the question safe, abstract, and uncostly.",
      evidenceRationale: "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
      rejectedAlternativeInterpretation: null,
      type: "hypothesis",
      body: "This might matter.",
      prompt: "What would make this true?",
      guidance: null,
      confidence: 74,
      status: "active",
      isPinned: false,
      userFeedbackValue: null,
      relatedSignalIds: [],
      relatedContextNodeIds: [],
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
      source: "wow_moment_compatibility",
      isProvisional: true,
      legacy: {
        wowMomentId: noteId,
        wowKind: "outlier",
        wowScore: 74,
      },
      evidencePreviews: [],
      relatedSignals: [],
    };
    const getNote = vi.fn(async () => note);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(),
        getNote,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(`/api/top-of-mind/${noteId}`);

    expect(response.status).toBe(200);
    expect(getNote).toHaveBeenCalledWith(db, {
      userId: user.id,
      noteId,
      preferredLocale: "en-US",
    });
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNote: {
        id: noteId,
        userId: user.id,
        status: "active",
      },
    });
  });

  it("returns 404 when the note does not belong to the signed-in tenant", async () => {
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        getNote: vi.fn(async () => null),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(
      "/api/top-of-mind/00000000-0000-4000-8000-000000000999",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Top-of-mind note not found",
    });
  });

  it("validates note ids before querying", async () => {
    const getNote = vi.fn();
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        getNote,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind/not-a-uuid");

    expect(response.status).toBe(400);
    expect(getNote).not.toHaveBeenCalled();
  });
});
