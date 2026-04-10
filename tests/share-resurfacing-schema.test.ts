import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("inspiration model preserves user-scoped integrity and card/share feed indexes", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*@@unique\(\[userId, id\]\)[\s\S]*@@index\(\[userId, deletedAt, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, isPublic, deletedAt, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[clusterId, isPublic, deletedAt, createdAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});

test("connection model indexes discoveries and inspiration detail resurfacing lookups", () => {
  assert.match(
    schema,
    /model Connection \{[\s\S]*@@unique\(\[sourceId, targetId\]\)[\s\S]*@@index\(\[userId, surfacedAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, dismissed, surfacedAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, sourceId, surfacedAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, targetId, surfacedAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});
