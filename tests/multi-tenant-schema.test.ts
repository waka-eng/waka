import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("tenant model enforces a globally unique slug", () => {
  assert.match(
    schema,
    /model Tenant \{[\s\S]*slug\s+String\s+@unique[\s\S]*\}/,
  );
});

test("user model keeps both the Google subject dedupe key and email identity unique", () => {
  assert.match(
    schema,
    /model User \{[\s\S]*googleSubject\s+String\s+@unique\s+@map\("google_subject"\)[\s\S]*email\s+String\s+@unique[\s\S]*memberships\s+Membership\[\][\s\S]*\}/,
  );
});

test("workspace model scopes uniqueness and indexes to the owning tenant", () => {
  assert.match(
    schema,
    /model Workspace \{[\s\S]*@@unique\(\[tenantId, slug\]\)[\s\S]*@@unique\(\[tenantId, id\]\)[\s\S]*@@index\(\[tenantId, createdAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});

test("membership model prevents duplicate memberships and indexes tenant-scoped lookups", () => {
  assert.match(
    schema,
    /model Membership \{[\s\S]*workspace\s+Workspace\s+@relation\(fields: \[tenantId, workspaceId\], references: \[tenantId, id\][\s\S]*@@id\(\[workspaceId, userId\]\)[\s\S]*@@index\(\[tenantId, workspaceId\]\)[\s\S]*@@index\(\[tenantId, userId\]\)[\s\S]*\}/,
  );
});
