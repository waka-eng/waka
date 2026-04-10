import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("inspiration model prevents duplicate imported sources per user", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*@@unique\(\[userId, sourceType, sourceUrl\]\)[\s\S]*@@unique\(\[userId, sourceType, mediaUrl\]\)[\s\S]*\}/,
  );
});

test("inspiration model indexes user-scoped source retrieval paths", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*@@index\(\[userId, sourceType, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, sourceUrl\]\)[\s\S]*@@index\(\[userId, mediaUrl\]\)[\s\S]*\}/,
  );
});
