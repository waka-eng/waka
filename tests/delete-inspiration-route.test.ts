import assert from "node:assert/strict";
import test from "node:test";

import type {
  DeleteInspirationPersistenceArgs,
  DeleteInspirationPersistenceClient,
  DeletedInspirationRecord,
} from "../apps/web/src/inspirations/delete-route.ts";
import {
  DELETE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  DELETE_INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  DELETE_INSPIRATION_ROUTE_OK_STATUS,
  DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  buildDeleteInspirationPersistenceArgs,
  configureDeleteInspirationRouteDependencies,
  deleteInspiration,
  handleDeleteInspirationRouteRequest,
} from "../apps/web/src/inspirations/delete-route.ts";

type SeededInspiration = {
  deletedAt?: string | null;
  id: string;
  userId: string;
};

class StubDeleteInspirationsPersistenceClient
  implements DeleteInspirationPersistenceClient<DeletedInspirationRecord>
{
  readonly records: SeededInspiration[];
  readonly updateCalls: DeleteInspirationPersistenceArgs[] = [];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.records = inspirations.map((inspiration) => ({
      ...inspiration,
    }));
  }

  readonly inspiration = {
    update: async (
      args: DeleteInspirationPersistenceArgs,
    ): Promise<DeletedInspirationRecord> => {
      this.updateCalls.push(args);

      const index = this.records.findIndex(
        (candidate) =>
          candidate.id === args.where.userId_id.id &&
          candidate.userId === args.where.userId_id.userId,
      );

      if (index === -1) {
        throw {
          code: "P2025",
          name: "PrismaClientKnownRequestError",
        };
      }

      const deletedAt = args.data.deletedAt.toISOString();
      this.records[index] = {
        ...this.records[index],
        deletedAt,
      };

      return {
        id: this.records[index]?.id ?? args.where.userId_id.id,
        deletedAt,
      };
    },
  };
}

test("buildDeleteInspirationPersistenceArgs scopes deletes to the authenticated user by composite id", () => {
  const deletedAt = new Date("2026-04-10T05:00:00.000Z");

  assert.deepEqual(
    buildDeleteInspirationPersistenceArgs("user-42", "insp-1", deletedAt),
    {
      data: {
        deletedAt,
      },
      select: {
        id: true,
        deletedAt: true,
      },
      where: {
        userId_id: {
          id: "insp-1",
          userId: "user-42",
        },
      },
    },
  );
});

test("deleteInspiration soft-deletes the authenticated user's record", async () => {
  const persistence = new StubDeleteInspirationsPersistenceClient([
    {
      id: "insp-1",
      userId: "user-42",
      deletedAt: null,
    },
  ]);
  const deletedAt = new Date("2026-04-10T05:05:00.000Z");

  const deletedInspiration = await deleteInspiration(
    persistence,
    "user-42",
    "insp-1",
    deletedAt,
  );

  assert.deepEqual(deletedInspiration, {
    id: "insp-1",
    deletedAt: "2026-04-10T05:05:00.000Z",
  });
  assert.deepEqual(persistence.updateCalls[0]?.where, {
    userId_id: {
      id: "insp-1",
      userId: "user-42",
    },
  });
  assert.equal(persistence.records[0]?.deletedAt, "2026-04-10T05:05:00.000Z");
});

test("handleDeleteInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const persistence = new StubDeleteInspirationsPersistenceClient([]);

  const response = await handleDeleteInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-1", {
      method: "DELETE",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-1",
      },
    },
  );

  assert.equal(response.status, DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(persistence.updateCalls.length, 0);
});

test("handleDeleteInspirationRouteRequest returns the shared not-found contract when the requested inspiration belongs to another user", async () => {
  const persistence = new StubDeleteInspirationsPersistenceClient([
    {
      id: "insp-other",
      userId: "user-other",
      deletedAt: null,
    },
  ]);

  const response = await handleDeleteInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-other", {
      method: "DELETE",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-other",
      },
    },
  );

  assert.equal(response.status, DELETE_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: DELETE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(persistence.records[0]?.deletedAt, null);
  assert.deepEqual(persistence.updateCalls[0]?.where, {
    userId_id: {
      id: "insp-other",
      userId: "user-42",
    },
  });
});

test("handleDeleteInspirationRouteRequest returns the same not-found contract when the requested inspiration does not exist", async () => {
  const persistence = new StubDeleteInspirationsPersistenceClient([]);

  const response = await handleDeleteInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing", {
      method: "DELETE",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-missing",
      },
    },
  );

  assert.equal(response.status, DELETE_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: DELETE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(persistence.updateCalls[0]?.where, {
    userId_id: {
      id: "insp-missing",
      userId: "user-42",
    },
  });
});

test("handleDeleteInspirationRouteRequest returns the same generic failure response for cross-user and missing deletes", async () => {
  const crossUserPersistence = new StubDeleteInspirationsPersistenceClient([
    {
      id: "insp-secret",
      userId: "user-other",
      deletedAt: null,
    },
  ]);
  const missingPersistence = new StubDeleteInspirationsPersistenceClient([]);

  const crossUserResponse = await handleDeleteInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-secret", {
      method: "DELETE",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: crossUserPersistence,
      },
      params: {
        inspirationId: "insp-secret",
      },
    },
  );

  const missingResponse = await handleDeleteInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing", {
      method: "DELETE",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: missingPersistence,
      },
      params: {
        inspirationId: "insp-missing",
      },
    },
  );

  assert.deepEqual(
    {
      body: await crossUserResponse.json(),
      status: crossUserResponse.status,
    },
    {
      body: await missingResponse.json(),
      status: missingResponse.status,
    },
  );
  assert.equal(crossUserPersistence.records[0]?.deletedAt, null);
  assert.deepEqual(crossUserPersistence.updateCalls[0]?.where, {
    userId_id: {
      id: "insp-secret",
      userId: "user-42",
    },
  });
  assert.deepEqual(missingPersistence.updateCalls[0]?.where, {
    userId_id: {
      id: "insp-missing",
      userId: "user-42",
    },
  });
});

test("app/api/inspirations/[id]/route.ts delegates DELETE requests to the configured delete handler", async () => {
  configureDeleteInspirationRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence: new StubDeleteInspirationsPersistenceClient([
      {
        id: "insp-route",
        userId: "user-route",
        deletedAt: null,
      },
    ]),
  });

  try {
    const { DELETE } = await import(
      "../apps/web/app/api/inspirations/[id]/route.ts"
    );
    const response = await DELETE(
      new Request("https://waka.app/api/inspirations/insp-route", {
        method: "DELETE",
      }) as never,
      {
        params: Promise.resolve({
          id: "insp-route",
        }),
      },
    );

    assert.equal(response.status, DELETE_INSPIRATION_ROUTE_OK_STATUS);
    const responseBody = await response.json();

    assert.equal(responseBody.id, "insp-route");
    assert.match(
      responseBody.deletedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
  } finally {
    configureDeleteInspirationRouteDependencies(null);
  }
});
