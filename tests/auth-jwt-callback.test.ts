import assert from "node:assert/strict";
import test from "node:test";

import { createWakaAuthConfig } from "../apps/web/src/auth.ts";
import type { GoogleUserPersistenceClient } from "../apps/web/src/auth/google-user-persistence.ts";
import {
  createNeonGoogleAuthFixture,
  createNeonGoogleUserPayload,
  getNeonGoogleAuthFixtureSkipReason,
} from "./helpers/neon-google-auth-fixture.ts";

interface PersistedUserRecord {
  id: string;
  email: string;
  googleSubject: string;
  image: string | null;
  name: string | null;
}

function createPersistedUserRecord(
  overrides: Partial<PersistedUserRecord> = {},
): PersistedUserRecord {
  return {
    id: "user-42",
    email: "founder@waka.app",
    googleSubject: "google-subject-123",
    image: "https://example.com/avatar.png",
    name: "Waka Founder",
    ...overrides,
  };
}

function createUserPersistenceClient(
  persistedUser: PersistedUserRecord = createPersistedUserRecord(),
): {
  client: GoogleUserPersistenceClient<PersistedUserRecord>;
  recordedLookups: Array<
    | {
        id: string;
      }
    | {
        googleSubject: string;
      }
  >;
  recordedPayloads: PersistedUserRecord[];
} {
  const recordedPayloads: PersistedUserRecord[] = [];
  const recordedLookups: Array<
    | {
        id: string;
      }
    | {
        googleSubject: string;
      }
  > = [];

  return {
    client: {
      user: {
        async findUnique(args) {
          recordedLookups.push(args.where);

          if ("id" in args.where) {
            return args.where.id === persistedUser.id ? persistedUser : null;
          }

          return args.where.googleSubject === persistedUser.googleSubject
            ? persistedUser
            : null;
        },
        async upsert(args) {
          const upsertedUser = {
            id: persistedUser.id,
            ...args.create,
          };

          recordedPayloads.push(upsertedUser);

          return upsertedUser;
        },
      },
    },
    recordedLookups,
    recordedPayloads,
  };
}

test("auth jwt callback replaces the provisional Google subject with the persisted Neon user id", async () => {
  const { client, recordedPayloads } = createUserPersistenceClient(
    createPersistedUserRecord({
      id: "user-7",
    }),
  );
  const authConfig = createWakaAuthConfig({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    userPersistenceClient: client,
  });

  const token = await authConfig.callbacks.jwt({
    token: {},
    user: {
      email: "founder@waka.app",
      googleSubject: "google-subject-123",
      id: "google-subject-123",
      image: "https://example.com/avatar.png",
      name: "Waka Founder",
    },
  });

  assert.deepEqual(recordedPayloads, [
    {
      email: "founder@waka.app",
      googleSubject: "google-subject-123",
      id: "user-7",
      image: "https://example.com/avatar.png",
      name: "Waka Founder",
    },
  ]);
  assert.equal(token.id, "user-7");
  assert.equal(token.sub, "user-7");
  assert.equal(token.userId, "user-7");
  assert.equal(token.email, "founder@waka.app");
  assert.equal(token.name, "Waka Founder");
  assert.equal(token.picture, "https://example.com/avatar.png");
  assert.equal(token.image, "https://example.com/avatar.png");
  assert.equal(token.googleSubject, "google-subject-123");
});

test("Google sign-in roundtrip yields a session linked to the persisted Neon user record", async () => {
  const persistedUser = createPersistedUserRecord({
    id: "user-12",
  });
  const { client, recordedPayloads } = createUserPersistenceClient(
    persistedUser,
  );
  const authConfig = createWakaAuthConfig({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    userPersistenceClient: client,
  });

  const token = await authConfig.callbacks.jwt({
    token: {},
    user: {
      email: persistedUser.email,
      googleSubject: persistedUser.googleSubject,
      id: persistedUser.googleSubject,
      image: persistedUser.image,
      name: persistedUser.name,
    },
  });
  const session = await authConfig.callbacks.session({
    session: {
      expires: "2026-04-10T00:00:00.000Z",
      user: {},
    },
    token,
  });

  assert.deepEqual(recordedPayloads, [persistedUser]);
  assert.equal(token.id, persistedUser.id);
  assert.equal(token.sub, persistedUser.id);
  assert.equal(token.userId, persistedUser.id);
  assert.equal(session.userId, persistedUser.id);
  assert.deepEqual(session.user, {
    email: persistedUser.email,
    googleSubject: persistedUser.googleSubject,
    id: persistedUser.id,
    image: persistedUser.image,
    name: persistedUser.name,
  });
});

test("auth jwt callback falls back to the existing resolved token user id outside the sign-in turn", async () => {
  const authConfig = createWakaAuthConfig({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
  });

  const token = await authConfig.callbacks.jwt({
    token: {
      email: "founder@waka.app",
      googleSubject: "google-subject-123",
      image: "https://example.com/avatar.png",
      name: "Waka Founder",
      sub: "user-9",
      userId: "user-9",
    },
  });

  assert.equal(token.id, "user-9");
  assert.equal(token.sub, "user-9");
  assert.equal(token.userId, "user-9");
  assert.equal(token.googleSubject, "google-subject-123");
});

test("auth session callback hydrates the session user from the resolved Neon token fields", async () => {
  const { client, recordedLookups } = createUserPersistenceClient();
  const authConfig = createWakaAuthConfig({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    userPersistenceClient: client,
  });

  const session = await authConfig.callbacks.session({
    session: {
      expires: "2026-04-10T00:00:00.000Z",
      user: {},
    },
    token: {
      email: "founder@waka.app",
      googleSubject: "google-subject-123",
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
      sub: "user-11",
      userId: "user-11",
    },
  });

  assert.deepEqual(recordedLookups, []);
  assert.equal(session.userId, "user-11");
  assert.deepEqual(session.user, {
    email: "founder@waka.app",
    googleSubject: "google-subject-123",
    id: "user-11",
    image: "https://example.com/avatar.png",
    name: "Waka Founder",
  });
});

test("auth session callback resolves the Neon user record when the sign-in token still carries the provider subject", async () => {
  const persistedUser = createPersistedUserRecord({
    id: "user-19",
  });
  const { client, recordedLookups } = createUserPersistenceClient(persistedUser);
  const authConfig = createWakaAuthConfig({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    userPersistenceClient: client,
  });

  const session = await authConfig.callbacks.session({
    session: {
      expires: "2026-04-10T00:00:00.000Z",
      user: {},
    },
    token: {
      email: "founder@waka.app",
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
      sub: "google-subject-123",
    },
  });

  assert.deepEqual(recordedLookups, [
    {
      id: "google-subject-123",
    },
    {
      googleSubject: "google-subject-123",
    },
  ]);
  assert.equal(session.userId, "user-19");
  assert.deepEqual(session.user, {
    email: "founder@waka.app",
    googleSubject: "google-subject-123",
    id: "user-19",
    image: "https://example.com/avatar.png",
    name: "Waka Founder",
  });
});

test(
  "Google sign-in session linkage resolves to the persisted Neon user row",
  {
    skip: getNeonGoogleAuthFixtureSkipReason() ?? false,
  },
  async (t) => {
    const fixture = await createNeonGoogleAuthFixture();

    t.after(async () => {
      await fixture.dispose();
    });

    const googleUser = createNeonGoogleUserPayload();
    const authConfig = createWakaAuthConfig({
      env: {
        NEXTAUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "https://waka.app",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
      userPersistenceClient: fixture.userPersistenceClient,
    });

    const token = await authConfig.callbacks.jwt({
      token: {},
      user: {
        email: googleUser.email,
        googleSubject: googleUser.googleSubject,
        id: googleUser.googleSubject,
        image: googleUser.image,
        name: googleUser.name,
      },
    });
    const persistedUser = await fixture.readUserByGoogleSubject(
      googleUser.googleSubject,
    );

    assert.ok(persistedUser);
    assert.equal(
      await fixture.countUsersByGoogleSubject(googleUser.googleSubject),
      1,
    );

    const session = await authConfig.callbacks.session({
      session: {
        expires: "2026-04-10T00:00:00.000Z",
        user: {},
      },
      token,
    });

    assert.equal(token.id, persistedUser.id);
    assert.equal(token.sub, persistedUser.id);
    assert.equal(token.userId, persistedUser.id);
    assert.equal(session.userId, persistedUser.id);
    assert.deepEqual(session.user, {
      email: persistedUser.email,
      googleSubject: persistedUser.googleSubject,
      id: persistedUser.id,
      image: persistedUser.image,
      name: persistedUser.name,
    });
  },
);
