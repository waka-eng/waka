import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_INSPIRATIONS,
  DEMO_SEED_KIND,
  DEMO_WOW_MOMENTS,
  getDemoSeedSummary,
} from "../../../tools/demo-seed-data";
import {
  assertLocalDatabase,
  buildDemoWowMomentIdempotencyKey,
  loadDemoSeedEnv,
  parseArgs,
  replacePriorDemoRows,
  resolveDemoUser,
  seedDemoRows,
} from "../../../tools/seed-demo";

describe("demo seed data", () => {
  it("provides exactly thirty real persisted inspiration seeds", () => {
    expect(DEMO_INSPIRATIONS).toHaveLength(30);
    expect(new Set(DEMO_INSPIRATIONS.map((seed) => seed.slug)).size).toBe(30);
    expect(DEMO_INSPIRATIONS.every((seed) => seed.kind === DEMO_SEED_KIND)).toBe(true);
    expect(DEMO_INSPIRATIONS.every((seed) => seed.text.length > 80)).toBe(true);
  });

  it("keeps curated demo scores realistic without flattening the showcase", () => {
    const inspirationWowScores = DEMO_INSPIRATIONS.map((seed) => seed.wowScore);
    const inspirationImportanceScores = DEMO_INSPIRATIONS.map((seed) => seed.importanceScore);
    const wowMomentScores = DEMO_WOW_MOMENTS.map((moment) => moment.wowScore);

    expect(Math.min(...inspirationWowScores)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...inspirationWowScores)).toBeLessThan(40);
    expect(inspirationWowScores.every((score) => score < 40)).toBe(true);
    expect(Math.min(...inspirationImportanceScores)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...inspirationImportanceScores)).toBeLessThanOrEqual(66);
    expect(inspirationWowScores.filter((score) => score >= 30).length).toBeGreaterThanOrEqual(8);
    expect(inspirationWowScores.filter((score) => score <= 25).length).toBeGreaterThanOrEqual(10);

    expect(Math.min(...wowMomentScores)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...wowMomentScores)).toBeLessThan(40);
    expect(wowMomentScores.every((score) => score < 40)).toBe(true);
    expect(wowMomentScores.slice(0, 9)).toEqual([...wowMomentScores].sort((a, b) => b - a).slice(0, 9));
  });

  it("includes multiple WOW moments that link multiple inspirations", () => {
    expect(DEMO_WOW_MOMENTS.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_WOW_MOMENTS.every((moment) => moment.related.length >= 2)).toBe(true);

    const inspirationSlugs = new Set(DEMO_INSPIRATIONS.map((seed) => seed.slug));
    for (const moment of DEMO_WOW_MOMENTS) {
      for (const related of moment.related) {
        expect(inspirationSlugs.has(related.inspirationSlug)).toBe(true);
        expect(related.reason.length).toBeGreaterThan(12);
      }
    }
  });

  it("reports the summary used by the seed CLI", () => {
    expect(getDemoSeedSummary()).toEqual({
      inspirationCount: 30,
      wowMomentCount: DEMO_WOW_MOMENTS.length,
      linkedInspirationCount: 30,
    });
  });
});

describe("demo seed CLI helpers", () => {
  it("loads .env first and falls back to .env.development for DB_CONNECTION_URL", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    const originalDatabase = process.env.DATABASE_URL;
    const dir = mkdtempSync(join(tmpdir(), "waka-demo-seed-"));

    try {
      delete process.env.DB_CONNECTION_URL;
      delete process.env.DATABASE_URL;
      writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://env-url\n");
      writeFileSync(join(dir, ".env.development"), "DB_CONNECTION_URL=postgres://dev-url\n");

      loadDemoSeedEnv(dir);

      expect(process.env.DATABASE_URL).toBe("postgres://env-url");
      expect(process.env.DB_CONNECTION_URL).toBe("postgres://dev-url");
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
      if (originalDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabase;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not load dotenv files when DB_CONNECTION_URL is already set", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    const dir = mkdtempSync(join(tmpdir(), "waka-demo-seed-"));

    try {
      process.env.DB_CONNECTION_URL = "postgres://already-set";
      writeFileSync(join(dir, ".env"), "DB_CONNECTION_URL=postgres://from-env\n");

      loadDemoSeedEnv(dir);

      expect(process.env.DB_CONNECTION_URL).toBe("postgres://already-set");
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces prior demo rows by default and only appends when requested", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    try {
      process.env.DB_CONNECTION_URL = "postgres://localhost/waka";

      expect(parseArgs(["--email=demo@example.test"])).toMatchObject({
        databaseUrl: "postgres://localhost/waka",
        email: "demo@example.test",
        replace: true,
      });

      expect(parseArgs(["--user-id=00000000-0000-0000-0000-000000000000"])).toMatchObject({
        replace: true,
      });

      expect(parseArgs(["--email=demo@example.test", "--append-demo-data"])).toMatchObject({
        replace: false,
      });
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
    }
  });

  it("parses cleanup-only mode as an existing-user, replace-style operation", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    try {
      process.env.DB_CONNECTION_URL = "postgres://localhost/waka";

      expect(parseArgs(["--email=demo@example.test", "--cleanup-demo-data"])).toMatchObject({
        email: "demo@example.test",
        cleanupDemoData: true,
        createUser: false,
        password: undefined,
        replace: true,
      });
      expect(
        parseArgs([
          "--user-id=00000000-0000-0000-0000-000000000000",
          "--cleanup-demo-data",
        ]),
      ).toMatchObject({ cleanupDemoData: true, replace: true });
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
    }
  });

  it("rejects cleanup-only combinations that could create users or reseed data", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    try {
      process.env.DB_CONNECTION_URL = "postgres://localhost/waka";

      expect(() =>
        parseArgs([
          "--email=demo@example.test",
          "--cleanup-demo-data",
          "--create-user",
          "--password=local-only-demo",
        ]),
      ).toThrow(/cleanup.*create-user/i);
      expect(() =>
        parseArgs(["--email=demo@example.test", "--cleanup-demo-data", "--password=local-only-demo"]),
      ).toThrow(/cleanup.*password/i);
      expect(() =>
        parseArgs(["--email=demo@example.test", "--cleanup-demo-data", "--append-demo-data"]),
      ).toThrow(/cleanup.*append/i);
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
    }
  });

  it("builds title-independent idempotency keys from version, user, trigger, kind, and sorted related ids", () => {
    const key = buildDemoWowMomentIdempotencyKey({
      userId: "user-1",
      triggerInspirationId: "trigger-1",
      kind: "bridge",
      relatedInspirationIds: ["related-b", "related-a", "related-b"],
    });

    expect(key).toBe("wow-moment-v2:user-1:trigger-1:bridge:related-a,related-b");
    expect(key).not.toContain("title");
  });

  it("includes a deterministic idempotency_key in every seeded WOW moment insert", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const fakeSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return [];
    }) as never;
    const userId = "00000000-0000-0000-0000-000000000000";

    await seedDemoRows(fakeSql, userId);

    const inspirationIdsBySlug = new Map<string, string>();
    const inspirationInserts = calls.filter((call) => /insert into inspirations/.test(call.sql));
    for (let index = 0; index < inspirationInserts.length; index += 1) {
      const call = inspirationInserts[index]!;
      inspirationIdsBySlug.set(DEMO_INSPIRATIONS[index]!.slug, call.values[0] as string);
    }

    const wowInserts = calls.filter((call) => /insert into wow_moments/.test(call.sql));
    expect(wowInserts).toHaveLength(DEMO_WOW_MOMENTS.length);
    for (let index = 0; index < wowInserts.length; index += 1) {
      const call = wowInserts[index]!;
      const moment = DEMO_WOW_MOMENTS[index]!;
      const relatedInspirationIds = moment.related.map((related) => {
        const id = inspirationIdsBySlug.get(related.inspirationSlug);
        expect(id).toBeTruthy();
        return id!;
      });
      const expectedKey = buildDemoWowMomentIdempotencyKey({
        userId,
        triggerInspirationId: relatedInspirationIds[0]!,
        kind: moment.kind,
        relatedInspirationIds,
      });

      expect(call.sql).toContain("idempotency_key");
      expect(call.values[4]).toBe(expectedKey);
      expect(call.values[4]).not.toBe(moment.title);
    }
  });

  it("replaces selected-user demo rows and only demo-only WOW moments", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const fakeSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      if (calls.length === 1) {
        return [
          {
            deleted_demo_wow_moments: "1",
            preserved_mixed_wow_moments: "1",
            preserved_non_demo_wow_moments: "1",
          },
        ];
      }
      return [{ deleted_demo_inspirations: "2" }];
    }) as never;
    const userId = "00000000-0000-0000-0000-000000000000";

    const summary = await replacePriorDemoRows(fakeSql, userId);

    expect(summary).toEqual({
      deletedDemoInspirations: 2,
      deletedDemoWowMoments: 1,
      preservedMixedWowMoments: 1,
      preservedNonDemoWowMoments: 1,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toContain("prior_demo_inspirations");
    expect(calls[0]!.sql).toContain("demo_only_moments");
    expect(calls[0]!.sql).toContain("mixed_demo_moments");
    expect(calls[0]!.sql).toContain("left join prior_demo_inspirations");
    expect(calls[0]!.sql).toContain("pdi.id is null");
    expect(calls[0]!.sql).toContain("delete from wow_moments");
    expect(calls[0]!.sql).not.toContain("wm.title = any");
    expect(calls[1]!.sql).toContain("delete from inspirations");
    expect(calls[1]!.sql).toContain("kind = ?");
    expect(calls[1]!.sql).not.toContain("text = any");
    expect(calls[0]!.values).toContain(userId);
    expect(calls[1]!.values).toContain(DEMO_SEED_KIND);
  });

  it("preserves accounts, other tenants, non-demo inspirations, and mixed/user-created WOW moments in a faithful cleanup fixture", async () => {
    const selectedUserId = "selected-user";
    const otherUserId = "other-user";
    const users = new Set([selectedUserId, otherUserId]);
    const inspirations = new Map([
      ["selected-demo-a", { userId: selectedUserId, kind: DEMO_SEED_KIND }],
      ["selected-demo-b", { userId: selectedUserId, kind: DEMO_SEED_KIND }],
      ["selected-note", { userId: selectedUserId, kind: "note" }],
      ["selected-null", { userId: selectedUserId, kind: null }],
      ["other-demo", { userId: otherUserId, kind: DEMO_SEED_KIND }],
    ]);
    const wowMoments = new Map([
      ["demo-only-wow", { userId: selectedUserId }],
      ["mixed-wow", { userId: selectedUserId }],
      ["user-created-wow", { userId: selectedUserId }],
      ["other-demo-wow", { userId: otherUserId }],
    ]);
    let links = [
      { userId: selectedUserId, wowMomentId: "demo-only-wow", inspirationId: "selected-demo-a" },
      { userId: selectedUserId, wowMomentId: "demo-only-wow", inspirationId: "selected-demo-b" },
      { userId: selectedUserId, wowMomentId: "mixed-wow", inspirationId: "selected-demo-a" },
      { userId: selectedUserId, wowMomentId: "mixed-wow", inspirationId: "selected-note" },
      { userId: selectedUserId, wowMomentId: "user-created-wow", inspirationId: "selected-null" },
      { userId: otherUserId, wowMomentId: "other-demo-wow", inspirationId: "other-demo" },
    ];

    const fakeSql = (async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      if (/delete from wow_moments/.test(statement)) {
        const selectedDemoIds = new Set(
          Array.from(inspirations.entries())
            .filter(([, row]) => row.userId === selectedUserId && row.kind === DEMO_SEED_KIND)
            .map(([id]) => id),
        );
        const selectedMomentIds = Array.from(wowMoments.entries())
          .filter(([, row]) => row.userId === selectedUserId)
          .map(([id]) => id);
        const demoLinked = selectedMomentIds.filter((momentId) =>
          links.some(
            (link) =>
              link.userId === selectedUserId &&
              link.wowMomentId === momentId &&
              selectedDemoIds.has(link.inspirationId),
          ),
        );
        const demoOnly = demoLinked.filter((momentId) =>
          links
            .filter((link) => link.userId === selectedUserId && link.wowMomentId === momentId)
            .every((link) => selectedDemoIds.has(link.inspirationId)),
        );
        const mixed = demoLinked.filter((momentId) => !demoOnly.includes(momentId));
        const nonDemo = selectedMomentIds.filter((momentId) => !demoLinked.includes(momentId));
        for (const momentId of demoOnly) wowMoments.delete(momentId);
        links = links.filter((link) => !demoOnly.includes(link.wowMomentId));
        return [
          {
            deleted_demo_wow_moments: demoOnly.length,
            preserved_mixed_wow_moments: mixed.length,
            preserved_non_demo_wow_moments: nonDemo.length,
          },
        ];
      }
      if (/delete from inspirations/.test(statement)) {
        const deletedIds = Array.from(inspirations.entries())
          .filter(([, row]) => row.userId === selectedUserId && row.kind === DEMO_SEED_KIND)
          .map(([id]) => id);
        for (const id of deletedIds) inspirations.delete(id);
        links = links.filter((link) => !deletedIds.includes(link.inspirationId));
        return [{ deleted_demo_inspirations: deletedIds.length }];
      }
      throw new Error(`Unexpected SQL in test: ${statement}`);
    }) as never;

    const summary = await replacePriorDemoRows(fakeSql, selectedUserId);

    expect(summary).toEqual({
      deletedDemoInspirations: 2,
      deletedDemoWowMoments: 1,
      preservedMixedWowMoments: 1,
      preservedNonDemoWowMoments: 1,
    });
    expect(users.has(selectedUserId)).toBe(true);
    expect(inspirations.has("selected-demo-a")).toBe(false);
    expect(inspirations.has("selected-demo-b")).toBe(false);
    expect(inspirations.has("selected-note")).toBe(true);
    expect(inspirations.has("selected-null")).toBe(true);
    expect(inspirations.has("other-demo")).toBe(true);
    expect(wowMoments.has("demo-only-wow")).toBe(false);
    expect(wowMoments.has("mixed-wow")).toBe(true);
    expect(wowMoments.has("user-created-wow")).toBe(true);
    expect(wowMoments.has("other-demo-wow")).toBe(true);
    expect(links.some((link) => link.wowMomentId === "mixed-wow" && link.inspirationId === "selected-demo-a")).toBe(false);
    expect(links.some((link) => link.wowMomentId === "mixed-wow" && link.inspirationId === "selected-note")).toBe(true);
  });

  it("requires an explicit create-user flag and password before inserting an email user", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    try {
      process.env.DB_CONNECTION_URL = "postgres://localhost/waka";

      expect(parseArgs(["--email=demo@example.test"])).toMatchObject({
        createUser: false,
        password: undefined,
      });

      expect(() => parseArgs(["--email=demo@example.test", "--create-user"])).toThrow(
        /--create-user requires --password/,
      );

      expect(() =>
        parseArgs(["--user-id=00000000-0000-0000-0000-000000000000", "--create-user"]),
      ).toThrow(/--create-user requires --email/);

      expect(
        parseArgs([
          "--email=demo@example.test",
          "--create-user",
          "--password=local-only-demo",
        ]),
      ).toMatchObject({
        createUser: true,
        password: "local-only-demo",
      });
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
    }
  });

  it("fails missing email users unless creation is explicit, then inserts a login-capable user", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const fakeSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = strings.join("?");
      calls.push({ sql: statement, values });
      if (/select id, email from users where lower\(email\)/.test(statement)) return [];
      if (/insert into users/.test(statement)) {
        return [{ id: values[0], email: values[1] }];
      }
      throw new Error(`Unexpected SQL in test: ${statement}`);
    }) as never;

    await expect(
      resolveDemoUser(fakeSql, {
        email: "Missing@Example.TEST",
        name: "Demo",
        createUser: false,
      }),
    ).rejects.toThrow(/No user exists for --email=missing@example\.test/);

    const user = await resolveDemoUser(fakeSql, {
      email: "New@Example.TEST",
      name: "Demo",
      password: "local-only-demo",
      createUser: true,
    });

    expect(user.email).toBe("new@example.test");
    const insert = calls.find((call) => /insert into users/.test(call.sql));
    expect(insert?.values[2]).toEqual(expect.stringMatching(/^\$2[aby]\$/));
  });

  it("keeps refusing remote databases unless explicitly allowed", () => {
    expect(() => assertLocalDatabase("postgres://db.example.com/waka", false)).toThrow(
      /Refusing to seed non-local database host/,
    );
    expect(() => assertLocalDatabase("postgres://localhost/waka", false)).not.toThrow();
    expect(() => assertLocalDatabase("postgres://db.example.com/waka", true)).not.toThrow();
  });

  it("does not allow the old remote-seed environment bypass", () => {
    const originalDb = process.env.DB_CONNECTION_URL;
    const originalBypass = process.env.WAKA_DEMO_SEED_ALLOW_REMOTE;
    try {
      process.env.DB_CONNECTION_URL = "postgres://db.example.com/waka";
      process.env.WAKA_DEMO_SEED_ALLOW_REMOTE = "1";

      expect(parseArgs(["--email=demo@example.test"])).toMatchObject({
        allowRemote: false,
      });
      expect(parseArgs(["--email=demo@example.test", "--allow-remote"])).toMatchObject({
        allowRemote: true,
      });
    } finally {
      if (originalDb === undefined) delete process.env.DB_CONNECTION_URL;
      else process.env.DB_CONNECTION_URL = originalDb;
      if (originalBypass === undefined) delete process.env.WAKA_DEMO_SEED_ALLOW_REMOTE;
      else process.env.WAKA_DEMO_SEED_ALLOW_REMOTE = originalBypass;
    }
  });
});
