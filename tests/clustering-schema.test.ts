import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("cluster membership stays scoped to the owning user", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*clusterId\s+String\?[\s\S]*cluster\s+Cluster\?\s+@relation\(fields: \[userId, clusterId\], references: \[userId, id\][\s\S]*@@index\(\[userId, clusterId, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[clusterId, createdAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});

test("cluster model exposes a composite key and recency index for reclustering", () => {
  assert.match(
    schema,
    /model Cluster \{[\s\S]*@@unique\(\[userId, id\]\)[\s\S]*@@index\(\[userId\]\)[\s\S]*@@index\(\[userId, updatedAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});
