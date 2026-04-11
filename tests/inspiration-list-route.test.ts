import assert from "node:assert/strict";
import test from "node:test";

import { buildPendingInspirationEnrichmentFields } from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import type {
  ListInspirationsPersistenceArgs,
  ListInspirationsPersistenceClient,
  ListedInspirationRecord,
} from "../apps/web/src/inspirations/list-route.ts";
import {
  DEFAULT_LIST_INSPIRATIONS_LIMIT,
  LIST_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS,
  LIST_INSPIRATIONS_ROUTE_LIMIT_INVALID_ERROR,
  LIST_INSPIRATIONS_ROUTE_OK_STATUS,
  LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
  LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS,
  buildListInspirationsPersistenceArgs,
  configureListInspirationsRouteDependencies,
  handleListInspirationsRouteRequest,
  listInspirations,
} from "../apps/web/src/inspirations/list-route.ts";

type SeededInspiration = {
  createdAt: string;
  deletedAt?: string | null;
  id: string;
  parentId?: string | null;
  rawContent: string;
  sourceType:
    | "AI_CONVERSATION"
    | "CLI_CONVERSATION"
    | "PHOTO"
    | "TEXT_NOTE"
    | "URL_IMPORT"
    | "VOICE_NOTE";
  sourceParentId?: string | null;
  enrichmentFields?: ReturnType<typeof buildPendingInspirationEnrichmentFields>;
  summary?: string | null;
  title?: string | null;
  updatedAt: string;
  userId: string;
};

class StubListInspirationsPersistenceClient
  implements ListInspirationsPersistenceClient<ListedInspirationRecord>
{
  readonly findManyCalls: ListInspirationsPersistenceArgs[] = [];
  private readonly inspirations: readonly SeededInspiration[];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.inspirations = inspirations;
  }

  readonly inspiration = {
    findMany: async (
      args: ListInspirationsPersistenceArgs,
    ): Promise<ListedInspirationRecord[]> => {
      this.findManyCalls.push(args);

      return this.inspirations
        .filter((inspiration) => inspiration.userId === args.where.userId)
        .filter((inspiration) => inspiration.deletedAt == null)
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, args.take)
        .map((inspiration) => {
          const expansions = this.inspirations
            .filter(
              (candidate) =>
                candidate.userId === args.where.userId &&
                candidate.deletedAt == null &&
                candidate.parentId === inspiration.id,
            )
            .sort(
              (left, right) =>
                new Date(right.createdAt).getTime() -
                  new Date(left.createdAt).getTime() ||
                right.id.localeCompare(left.id),
            )
            .map((expansion) => ({
              enrichmentFields: expansion.enrichmentFields,
              id: expansion.id,
              rawContent: expansion.rawContent,
              sourceType: expansion.sourceType,
              sourceParentId: expansion.sourceParentId,
              summary: expansion.summary,
              title: expansion.title,
              createdAt: expansion.createdAt,
              updatedAt: expansion.updatedAt,
            }));

          return {
            enrichmentFields: inspiration.enrichmentFields,
            expansions,
            id: inspiration.id,
            rawContent: inspiration.rawContent,
            sourceType: inspiration.sourceType,
            sourceParentId: inspiration.sourceParentId,
            summary: inspiration.summary,
            title: inspiration.title,
            createdAt: inspiration.createdAt,
            updatedAt: inspiration.updatedAt,
          };
        });
    },
  };
}

test("buildListInspirationsPersistenceArgs scopes list queries to the authenticated user and excludes soft-deleted rows", () => {
  assert.deepEqual(buildListInspirationsPersistenceArgs("user-42"), {
    where: {
      userId: "user-42",
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    take: DEFAULT_LIST_INSPIRATIONS_LIMIT,
    select: {
      expansions: {
        where: {
          userId: "user-42",
          deletedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          enrichmentFields: true,
          id: true,
          rawContent: true,
          sourceType: true,
          sourceParentId: true,
          summary: true,
          title: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      enrichmentFields: true,
      id: true,
      rawContent: true,
      sourceType: true,
      sourceParentId: true,
      summary: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });
});

test("listInspirations returns the current user's rows in newest-first order", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-3",
      userId: "user-42",
      rawContent: "Newest inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
    {
      id: "insp-2",
      userId: "user-other",
      rawContent: "Other user's inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
    {
      id: "insp-1",
      userId: "user-42",
      rawContent: "Older inspiration",
      sourceType: "TEXT_NOTE",
      enrichmentFields: buildPendingInspirationEnrichmentFields(3),
      summary: "Short summary",
      title: "Older",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
    {
      id: "insp-deleted",
      userId: "user-42",
      rawContent: "Deleted inspiration",
      sourceType: "TEXT_NOTE",
      deletedAt: "2026-04-10T00:59:00.000Z",
      createdAt: "2026-04-10T00:58:00.000Z",
      updatedAt: "2026-04-10T00:58:00.000Z",
    },
  ]);

  const inspirations = await listInspirations(persistence, "user-42", 2);

  assert.deepEqual(
    inspirations.map((inspiration) => inspiration.id),
    ["insp-3", "insp-1"],
  );
  assert.deepEqual(
    inspirations[1]?.enrichmentFields,
    buildPendingInspirationEnrichmentFields(3),
  );
  assert.equal(
    persistence.findManyCalls[0]?.where.userId,
    "user-42",
  );
  assert.deepEqual(persistence.findManyCalls[0]?.where, {
    userId: "user-42",
    deletedAt: null,
  });
});

test("listInspirations includes the source parent id for child inspirations", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-child",
      userId: "user-42",
      rawContent: "Child inspiration",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-root",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
    {
      id: "insp-root",
      userId: "user-42",
      rawContent: "Root inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
  ]);

  const inspirations = await listInspirations(persistence, "user-42", 2);

  assert.equal(inspirations[0]?.id, "insp-child");
  assert.equal(inspirations[0]?.sourceParentId, "insp-root");
  assert.equal(inspirations[1]?.id, "insp-root");
  assert.equal("sourceParentId" in (inspirations[1] ?? {}), false);
});

test("listInspirations includes direct expansions for parent inspirations", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-parent",
      userId: "user-42",
      rawContent: "Parent inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:01:00.000Z",
    },
    {
      id: "insp-child-newer",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Most recent child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
    {
      id: "insp-child-older",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Older child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
    {
      id: "insp-grandchild",
      userId: "user-42",
      parentId: "insp-child-newer",
      rawContent: "Grandchild should remain attached to the direct parent only",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T01:30:00.000Z",
      updatedAt: "2026-04-10T01:31:00.000Z",
    },
    {
      id: "insp-child-deleted",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Deleted child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      deletedAt: "2026-04-10T02:30:00.000Z",
      createdAt: "2026-04-10T02:15:00.000Z",
      updatedAt: "2026-04-10T02:16:00.000Z",
    },
    {
      id: "insp-child-other-user",
      userId: "user-other",
      parentId: "insp-parent",
      rawContent: "Cross-user child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:45:00.000Z",
      updatedAt: "2026-04-10T02:46:00.000Z",
    },
  ]);

  const inspirations = await listInspirations(persistence, "user-42", 3);

  assert.deepEqual(inspirations[0]?.expansions, [
    {
      id: "insp-child-newer",
      rawContent: "Most recent child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
    {
      id: "insp-child-older",
      rawContent: "Older child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
  ]);
});

test("handleListInspirationsRouteRequest includes the source parent id for child inspirations", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-child",
      userId: "user-42",
      rawContent: "Child inspiration",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-root",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
    {
      id: "insp-root",
      userId: "user-42",
      rawContent: "Root inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
  ]);

  const response = await handleListInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations?limit=2"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    inspirations: [
      {
        id: "insp-child",
        rawContent: "Child inspiration",
        sourceType: "TEXT_NOTE",
        sourceParentId: "insp-root",
        createdAt: "2026-04-10T02:00:00.000Z",
        updatedAt: "2026-04-10T02:01:00.000Z",
      },
      {
        id: "insp-root",
        rawContent: "Root inspiration",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T01:00:00.000Z",
        updatedAt: "2026-04-10T01:01:00.000Z",
      },
    ],
  });
});

test("handleListInspirationsRouteRequest includes expansions for parent inspirations", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-parent",
      userId: "user-42",
      rawContent: "Parent inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:01:00.000Z",
    },
    {
      id: "insp-child",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Child inspiration",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
  ]);

  const response = await handleListInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations?limit=2"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    inspirations: [
      {
        id: "insp-parent",
        rawContent: "Parent inspiration",
        sourceType: "TEXT_NOTE",
        expansions: [
          {
            id: "insp-child",
            rawContent: "Child inspiration",
            sourceType: "TEXT_NOTE",
            sourceParentId: "insp-parent",
            createdAt: "2026-04-10T03:00:00.000Z",
            updatedAt: "2026-04-10T03:01:00.000Z",
          },
        ],
        createdAt: "2026-04-10T04:00:00.000Z",
        updatedAt: "2026-04-10T04:01:00.000Z",
      },
      {
        id: "insp-child",
        rawContent: "Child inspiration",
        sourceType: "TEXT_NOTE",
        sourceParentId: "insp-parent",
        createdAt: "2026-04-10T03:00:00.000Z",
        updatedAt: "2026-04-10T03:01:00.000Z",
      },
    ],
  });
});

test("handleListInspirationsRouteRequest returns 401 when the caller is not authenticated", async () => {
  const persistence = new StubListInspirationsPersistenceClient([]);

  const response = await handleListInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(persistence.findManyCalls.length, 0);
});

test("handleListInspirationsRouteRequest returns only inspirations owned by the authenticated user", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-2",
      userId: "user-42",
      rawContent: "Second note",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:00:00.000Z",
    },
    {
      id: "insp-1",
      userId: "user-42",
      rawContent: "First note",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:00:00.000Z",
    },
    {
      id: "insp-other",
      userId: "user-other",
      rawContent: "Should not leak",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:00:00.000Z",
    },
  ]);

  const response = await handleListInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations?limit=2"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    inspirations: [
      {
        id: "insp-2",
        rawContent: "Second note",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T02:00:00.000Z",
        updatedAt: "2026-04-10T02:00:00.000Z",
      },
      {
        id: "insp-1",
        rawContent: "First note",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T01:00:00.000Z",
        updatedAt: "2026-04-10T01:00:00.000Z",
      },
    ],
  });
  assert.equal(persistence.findManyCalls.length, 1);
  assert.equal(persistence.findManyCalls[0]?.take, 2);
  assert.deepEqual(persistence.findManyCalls[0]?.where, {
    userId: "user-42",
    deletedAt: null,
  });
});

test("handleListInspirationsRouteRequest ignores spoofed user-scoped query parameters and keeps the authenticated scope", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-2",
      userId: "user-42",
      rawContent: "Second note",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:00:00.000Z",
    },
    {
      id: "insp-1",
      userId: "user-42",
      rawContent: "First note",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:00:00.000Z",
    },
    {
      id: "insp-other",
      userId: "user-other",
      rawContent: "Should not leak through a spoofed query.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:00:00.000Z",
    },
  ]);

  const response = await handleListInspirationsRouteRequest(
    new Request(
      "https://waka.app/api/inspirations?limit=2&userId=user-other&ownerId=user-other",
    ),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    inspirations: [
      {
        id: "insp-2",
        rawContent: "Second note",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T02:00:00.000Z",
        updatedAt: "2026-04-10T02:00:00.000Z",
      },
      {
        id: "insp-1",
        rawContent: "First note",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T01:00:00.000Z",
        updatedAt: "2026-04-10T01:00:00.000Z",
      },
    ],
  });
  assert.equal(persistence.findManyCalls.length, 1);
  assert.deepEqual(persistence.findManyCalls[0]?.where, {
    userId: "user-42",
    deletedAt: null,
  });
  assert.equal(persistence.findManyCalls[0]?.take, 2);
});

test("handleListInspirationsRouteRequest returns 400 for invalid limits", async () => {
  const persistence = new StubListInspirationsPersistenceClient([]);

  const response = await handleListInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations?limit=0"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: LIST_INSPIRATIONS_ROUTE_LIMIT_INVALID_ERROR,
  });
  assert.equal(persistence.findManyCalls.length, 0);
});

test("app/api/inspirations/route.ts delegates GET requests to the configured list handler", async () => {
  configureListInspirationsRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence: new StubListInspirationsPersistenceClient([
      {
        id: "insp-route",
        userId: "user-route",
        rawContent: "Route handler delegation stays thin.",
        sourceType: "TEXT_NOTE",
        createdAt: "2026-04-10T04:00:00.000Z",
        updatedAt: "2026-04-10T04:00:00.000Z",
      },
    ]),
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations") as never,
    );

    assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      inspirations: [
        {
          id: "insp-route",
          rawContent: "Route handler delegation stays thin.",
          sourceType: "TEXT_NOTE",
          createdAt: "2026-04-10T04:00:00.000Z",
          updatedAt: "2026-04-10T04:00:00.000Z",
        },
      ],
    });
  } finally {
    configureListInspirationsRouteDependencies(null);
  }
});

test("app/api/inspirations/route.ts returns only inspirations owned by the authenticated account when another account has seeded inspirations", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-other-newest",
      userId: "user-other",
      rawContent: "Another account's newest note should stay private.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T06:00:00.000Z",
      updatedAt: "2026-04-10T06:00:00.000Z",
    },
    {
      id: "insp-user-newest",
      userId: "user-route",
      rawContent: "Authenticated user's newest note.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T05:00:00.000Z",
      updatedAt: "2026-04-10T05:00:00.000Z",
    },
    {
      id: "insp-user-older",
      userId: "user-route",
      rawContent: "Authenticated user's older note.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:00:00.000Z",
    },
  ]);

  configureListInspirationsRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence,
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations?limit=2") as never,
    );

    assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      inspirations: [
        {
          id: "insp-user-newest",
          rawContent: "Authenticated user's newest note.",
          sourceType: "TEXT_NOTE",
          createdAt: "2026-04-10T05:00:00.000Z",
          updatedAt: "2026-04-10T05:00:00.000Z",
        },
        {
          id: "insp-user-older",
          rawContent: "Authenticated user's older note.",
          sourceType: "TEXT_NOTE",
          createdAt: "2026-04-10T04:00:00.000Z",
          updatedAt: "2026-04-10T04:00:00.000Z",
        },
      ],
    });
    assert.equal(persistence.findManyCalls.length, 1);
    assert.deepEqual(persistence.findManyCalls[0]?.where, {
      userId: "user-route",
      deletedAt: null,
    });
    assert.equal(persistence.findManyCalls[0]?.take, 2);
  } finally {
    configureListInspirationsRouteDependencies(null);
  }
});

test("app/api/inspirations/route.ts ignores spoofed user-scoped query parameters and uses the authenticated account", async () => {
  const persistence = new StubListInspirationsPersistenceClient([
    {
      id: "insp-other-newest",
      userId: "user-other",
      rawContent: "Another account's newest note should stay private.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T06:00:00.000Z",
      updatedAt: "2026-04-10T06:00:00.000Z",
    },
    {
      id: "insp-user-newest",
      userId: "user-route",
      rawContent: "Authenticated user's newest note.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T05:00:00.000Z",
      updatedAt: "2026-04-10T05:00:00.000Z",
    },
    {
      id: "insp-user-older",
      userId: "user-route",
      rawContent: "Authenticated user's older note.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:00:00.000Z",
    },
  ]);

  configureListInspirationsRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence,
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/route.ts");
    const response = await GET(
      new Request(
        "https://waka.app/api/inspirations?limit=2&userId=user-other&ownerId=user-other",
      ) as never,
    );

    assert.equal(response.status, LIST_INSPIRATIONS_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      inspirations: [
        {
          id: "insp-user-newest",
          rawContent: "Authenticated user's newest note.",
          sourceType: "TEXT_NOTE",
          createdAt: "2026-04-10T05:00:00.000Z",
          updatedAt: "2026-04-10T05:00:00.000Z",
        },
        {
          id: "insp-user-older",
          rawContent: "Authenticated user's older note.",
          sourceType: "TEXT_NOTE",
          createdAt: "2026-04-10T04:00:00.000Z",
          updatedAt: "2026-04-10T04:00:00.000Z",
        },
      ],
    });
    assert.equal(persistence.findManyCalls.length, 1);
    assert.deepEqual(persistence.findManyCalls[0]?.where, {
      userId: "user-route",
      deletedAt: null,
    });
    assert.equal(persistence.findManyCalls[0]?.take, 2);
  } finally {
    configureListInspirationsRouteDependencies(null);
  }
});
