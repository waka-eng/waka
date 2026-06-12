/**
 * Drizzle ORM schema - vault document index.
 *
 * Vault files are the source of truth for user-meaning documents. This table is
 * a rebuildable query/index projection: path, content hash, revision, and hot
 * list/ranking fields copied from the document or related worker output.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clusterEnum, users } from "./schema";

export const documentTypeEnumValues = [
  "signal",
  "top_of_mind_note",
  "context_node",
  "context_edge",
] as const;

export type DocumentType = (typeof documentTypeEnumValues)[number];

export const documentTypeEnum = pgEnum(
  "document_type",
  documentTypeEnumValues,
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    docType: documentTypeEnum("doc_type").notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    rev: integer("rev").notNull().default(1),
    searchText: text("search_text"),
    cluster: clusterEnum("cluster"),
    importanceScore: integer("importance_score"),
    wowScore: integer("wow_score"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userPathUnique: uniqueIndex("documents_user_path_unique_idx").on(
      table.userId,
      table.path,
    ),
    userTypeCreatedIdx: index("documents_user_type_created_idx").on(
      table.userId,
      table.docType,
      table.createdAt.desc(),
    ),
    userTypeScoreIdx: index("documents_user_type_score_idx").on(
      table.userId,
      table.docType,
      table.wowScore.desc(),
    ),
  }),
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export const documentsRelations = relations(documents, ({ one }) => ({
  user: one(users, {
    fields: [documents.userId],
    references: [users.id],
  }),
}));
