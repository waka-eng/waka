import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("discovery event schema persists cluster reassignment references with user-scoped feed indexes", () => {
  assert.match(
    schema,
    /enum DiscoveryEventType \{[\s\S]*CLUSTER_REASSIGNED[\s\S]*\}/,
  );
  assert.match(
    schema,
    /model DiscoveryEvent \{[\s\S]*userId\s+String[\s\S]*inspirationId\s+String[\s\S]*eventType\s+DiscoveryEventType[\s\S]*previousClusterId\s+String[\s\S]*newClusterId\s+String[\s\S]*inspiration\s+Inspiration\s+@relation\(fields: \[userId, inspirationId\], references: \[userId, id\][\s\S]*@@index\(\[userId, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, eventType, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, inspirationId, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, previousClusterId, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, newClusterId, createdAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});
