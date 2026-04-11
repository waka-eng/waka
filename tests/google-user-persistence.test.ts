import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleUserModelPayload } from "../apps/web/src/auth/providers/google.ts";
import {
  buildGoogleUserUpsertArgs,
  persistGoogleUser,
  type GoogleUserPersistenceClient,
  type GoogleUserUpsertArgs,
} from "../apps/web/src/auth/google-user-persistence.ts";

interface PersistedUserRecord extends GoogleUserModelPayload {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

function createPayload(
  overrides: Partial<GoogleUserModelPayload> = {},
): GoogleUserModelPayload {
  return {
    googleSubject: "google-subject-123",
    email: "founder@waka.app",
    name: "Waka Founder",
    image: "https://example.com/avatar.png",
    ...overrides,
  };
}

function createPersistedUserRecord(
  overrides: Partial<PersistedUserRecord> = {},
): PersistedUserRecord {
  const timestamp = new Date("2026-04-10T00:00:00.000Z");

  return {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...createPayload(),
    ...overrides,
  };
}

function createFakeGoogleUserPersistenceClient(
  initialUsers: PersistedUserRecord[] = [],
): {
  client: GoogleUserPersistenceClient<PersistedUserRecord>;
  recordedUpserts: GoogleUserUpsertArgs[];
  usersByGoogleSubject: Map<string, PersistedUserRecord>;
} {
  const usersByGoogleSubject = new Map(
    initialUsers.map((user) => [user.googleSubject, user]),
  );
  const recordedUpserts: GoogleUserUpsertArgs[] = [];

  const client: GoogleUserPersistenceClient<PersistedUserRecord> = {
    user: {
      async upsert(args) {
        recordedUpserts.push(args);

        const existingUser = usersByGoogleSubject.get(args.where.googleSubject);

        if (existingUser) {
          const updatedUser = {
            ...existingUser,
            ...args.update,
            updatedAt: new Date("2026-04-10T00:00:03.000Z"),
          };

          usersByGoogleSubject.set(existingUser.googleSubject, updatedUser);

          return updatedUser;
        }

        const createdUser = {
          id: `user-${usersByGoogleSubject.size + 1}`,
          ...args.create,
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: new Date("2026-04-10T00:00:00.000Z"),
        };

        usersByGoogleSubject.set(createdUser.googleSubject, createdUser);

        return createdUser;
      },
    },
  };

  return {
    client,
    recordedUpserts,
    usersByGoogleSubject,
  };
}

test("Google user upsert args target the stable google subject key", () => {
  const payload = createPayload();

  assert.deepEqual(buildGoogleUserUpsertArgs(payload), {
    where: {
      googleSubject: "google-subject-123",
    },
    create: payload,
    update: {
      email: "founder@waka.app",
      name: "Waka Founder",
      image: "https://example.com/avatar.png",
    },
  });
});

test("persistGoogleUser creates a new user record on first sign-in", async () => {
  const payload = createPayload();
  const { client, recordedUpserts, usersByGoogleSubject } =
    createFakeGoogleUserPersistenceClient();

  const persistedUser = await persistGoogleUser(client, payload);

  assert.equal(recordedUpserts.length, 1);
  assert.equal(recordedUpserts[0]?.where.googleSubject, payload.googleSubject);
  assert.equal(usersByGoogleSubject.size, 1);
  assert.deepEqual(persistedUser, {
    id: "user-1",
    ...payload,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
  });
});

test("persistGoogleUser reuses the existing row and updates mutable fields by google subject", async () => {
  const existingUser = createPersistedUserRecord({
    email: "old-email@waka.app",
    name: "Old Name",
    image: "https://example.com/old-avatar.png",
  });
  const payload = createPayload({
    email: "new-email@waka.app",
    name: null,
    image: null,
  });
  const { client, usersByGoogleSubject } =
    createFakeGoogleUserPersistenceClient([existingUser]);

  const persistedUser = await persistGoogleUser(client, payload);

  assert.equal(usersByGoogleSubject.size, 1);
  assert.equal(usersByGoogleSubject.get(payload.googleSubject)?.id, existingUser.id);
  assert.deepEqual(persistedUser, {
    ...existingUser,
    email: "new-email@waka.app",
    name: null,
    image: null,
    updatedAt: new Date("2026-04-10T00:00:03.000Z"),
  });
});
