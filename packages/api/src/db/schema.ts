/**
 * Drizzle ORM schema — WAKA Inspirations
 *
 * Tables defined here:
 *   - users         : authenticated accounts (email+password and/or Google OAuth)
 *   - inspirations  : per-user captured inspirations with async cluster classification
 *
 * Tables defined in sibling modules (kept out of this file to keep AC scopes
 * small and reviewable):
 *   - attachments   : ./schema-attachments.ts (Sub-AC 1.x)
 *   - reflections   : ./schema-reflections.ts (Sub-AC 1.x)
 *
 * Conventions:
 *   - All primary keys are UUIDs generated server-side (defaultRandom()).
 *   - All timestamps are stored with timezone (timestamp with time zone) and
 *     default to NOW() at insert time. updated_at is bumped in application code
 *     (Drizzle does not auto-update on UPDATE).
 *   - cluster is a Postgres enum so the database itself enforces the allowed
 *     classification labels declared in the ontology (ClusterEnum).
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Allowed cluster classification labels.
 *
 * Ordering here is the canonical order written into Postgres; do NOT reorder
 * existing values once a migration has been applied (Postgres enum order is
 * part of the type identity).
 */
export const clusterEnumValues = [
  "outlier",
  "bridge",
  "morph",
  "convergence",
  "tension",
  "loop",
] as const;

export type Cluster = (typeof clusterEnumValues)[number];

export const clusterEnum = pgEnum("cluster", clusterEnumValues);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/**
 * A user account. May be created via:
 *   - email + password   → password_hash set, google_sub null
 *   - Google OAuth       → google_sub set, password_hash may be null
 *   - both linked        → both set (e.g. user signed up with email then linked Google)
 *
 * email is always required and globally unique.
 *
 * google_sub stores the Google OpenID "sub" claim — the immutable, opaque
 * subject identifier returned by Google. We use the OIDC term ("sub") rather
 * than "id" because Google's own docs are explicit that the email or numeric
 * id may change but the sub never does, and it's the only thing safe to use
 * as a long-lived primary key.
 *
 * avatar_url is captured at OAuth callback time so the UI can render a user
 * avatar without re-hitting Google. It's nullable for email/password accounts
 * that have not linked an avatar.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    email: text("email").notNull(),
    // bcrypt/argon2 hash. Nullable so OAuth-only accounts are valid.
    passwordHash: text("password_hash"),
    // Google OIDC "sub" claim. Nullable so email/password accounts are valid.
    googleSub: text("google_sub"),

    name: text("name").notNull().default(""),
    // URL of the user's avatar image (e.g. Google profile picture).
    // Nullable: email/password signups won't have one until they link OAuth.
    avatarUrl: text("avatar_url"),
    preferredLocale: text("preferred_locale").notNull().default("en-US"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    publicHandle: text("public_handle"),
    publicProfileEnabled: boolean("public_profile_enabled").notNull().default(false),
    publicTopOfMindEnabled: boolean("public_top_of_mind_enabled").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Lookup by email (login) must be unique and indexed.
    emailUnique: uniqueIndex("users_email_unique_idx").on(table.email),
    // Lookup by Google subject during OAuth callback. Sparse-style: many rows
    // may be NULL, but when present the value must be unique. Postgres allows
    // multiple NULLs in a UNIQUE index by default, which is what we want.
    googleSubUnique: uniqueIndex("users_google_sub_unique_idx").on(
      table.googleSub,
    ),
    publicHandleUnique: uniqueIndex("users_public_handle_unique_idx").on(
      table.publicHandle,
    ).where(sql`${table.publicHandle} IS NOT NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// signals
// ---------------------------------------------------------------------------

/**
 * A single inspiration captured by a user.
 *
 * cluster + classified_at are populated asynchronously by the background
 * classifier worker. Both stay NULL until classification succeeds. If Gemini
 * returns nothing or an invalid label, cluster remains NULL and the UI
 * degrades gracefully (per AC).
 *
 * kind and category are free-form metadata carried over from the original
 * single-file UI (e.g. "note", "link", "image"; numeric category bucket).
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    text: text("text").notNull(),

    kind: text("kind"),
    category: integer("category"),

    /**
     * Who captured this signal: "app" (web/mobile UI) or "agent" (a CLI/MCP
     * client such as waka-mcp). Derived server-side from the session's
     * `sessions.client` at insert time — never accepted from the request
     * body — so lens-scoped distillation (owner-taste vs agent) rests on
     * provenance a caller cannot forge.
     */
    source: text("source").notNull().default("app"),
    /**
     * Persistent signal snapshots used by the WOW-moment pipeline. Later
     * workers update these only when constituent signals change; list/create
     * paths do not calculate them synchronously.
     */
    importanceScore: integer("importance_score").notNull().default(0),
    wowScore: integer("wow_score").notNull().default(0),

    /**
     * Whether this inspiration may feed the user's Group Top of Mind boards
     * (US-052). Shared by default; flipping to false keeps it private so it
     * never contributes to — or is exposed through — any group board.
     */
    sharedToGroups: boolean("shared_to_groups").notNull().default(true),

    /**
     * What the heart actually reacted to, when the save is a bare link.
     *
     * The pipeline synthesizes from text embeddings, so a naked URL is nearly
     * mute: the reaction was to something inside the page and only the wrapper
     * was stored. Fetched title/description text lives here and joins the
     * embedding input — see `buildCanonicalInspirationEmbeddingInput`.
     *
     * `enrichedAt` marks the ATTEMPT: null enrichment with a timestamp means
     * "we tried, the page would not speak", and stops endless refetching.
     */
    enrichment: text("enrichment"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    /**
     * Composer-open → save, in milliseconds. Null when unknown, which is a real
     * answer: saves made before this was recorded genuinely cannot say, and a
     * zero would claim they were instant.
     *
     * Crude on purpose — it orders reactions before compositions, it does not
     * measure attention. See `CombinationPulseProfile`.
     */
    captureElapsedMs: integer("capture_elapsed_ms"),

    cluster: clusterEnum("cluster"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // The list view filters by user_id and orders by created_at DESC; a
    // composite index supports both in one B-tree walk.
    userCreatedIdx: index("signals_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    // Backfill / re-classify jobs scan rows where cluster IS NULL.
    clusterNullIdx: index("signals_cluster_null_idx")
      .on(table.id)
      .where(sql`${table.cluster} IS NULL`),
    // Supports composite tenant-bound foreign keys from child tables that
    // carry both user_id and inspiration_id (e.g. stored embeddings).
    userIdIdUnique: uniqueIndex("signals_user_id_id_unique_idx").on(
      table.userId,
      table.id,
    ),
  }),
);

// Compatibility aliases: the public API still exposes `/api/inspirations`
// while the physical database table has moved to the signal vocabulary.
export const inspirations = signals;

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type Inspiration = Signal;
export type NewInspiration = NewSignal;

export const signalSparks = pgTable(
  "signal_sparks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    source: text("source").notNull().default("user_selected"),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    confidence: integer("confidence").notNull().default(100),
    isPrimary: boolean("is_primary").notNull().default(false),
    note: text("note"),
    whatMovedUser: text("what_moved_user"),
    impliedValues: jsonb("implied_values")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    worldviewClaims: jsonb("worldview_claims")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    tensions: jsonb("tensions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    decisionRelevance: jsonb("decision_relevance")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    emotionalCharge: jsonb("emotional_charge")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userInspirationIdx: index("signal_sparks_user_signal_idx").on(
      table.userId,
      table.inspirationId,
    ),
    inspirationCreatedIdx: index("signal_sparks_signal_created_idx").on(
      table.inspirationId,
      table.createdAt.desc(),
    ),
  }),
);

export const inspirationSparks = signalSparks;

export type SignalSpark = typeof signalSparks.$inferSelect;
export type NewSignalSpark = typeof signalSparks.$inferInsert;
export type InspirationSpark = SignalSpark;
export type NewInspirationSpark = NewSignalSpark;

export const signalPackets = pgTable(
  "signal_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    primarySparkId: uuid("primary_spark_id").references(
      () => signalSparks.id,
      { onDelete: "set null" },
    ),
    sparkText: text("spark_text").notNull().default(""),
    artifactExcerpt: text("artifact_excerpt").notNull().default(""),
    packetText: text("packet_text").notNull(),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    classifierSnapshot: jsonb("classifier_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    inputFingerprint: text("input_fingerprint").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userInspirationUnique: uniqueIndex("signal_packets_user_signal_unique_idx").on(
      table.userId,
      table.inspirationId,
    ),
    userUpdatedIdx: index("signal_packets_user_updated_idx").on(
      table.userId,
      table.updatedAt.desc(),
    ),
  }),
);

export const meaningPackets = signalPackets;

export type SignalPacket = typeof signalPackets.$inferSelect;
export type NewSignalPacket = typeof signalPackets.$inferInsert;
export type MeaningPacket = SignalPacket;
export type NewMeaningPacket = NewSignalPacket;

export const contextNodes = pgTable(
  "context_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("meaning_graph_writer"),
    weight: integer("weight").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    evidenceCount: integer("evidence_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userTypeLabelUnique: uniqueIndex("context_nodes_user_type_label_unique_idx").on(
      table.userId,
      table.type,
      table.label,
    ),
    userStatusIdx: index("context_nodes_user_status_idx").on(
      table.userId,
      table.status,
    ),
    userWeightIdx: index("context_nodes_user_weight_idx").on(
      table.userId,
      table.weight.desc(),
    ),
  }),
);

export const meaningNodes = contextNodes;

export type ContextNode = typeof contextNodes.$inferSelect;
export type NewContextNode = typeof contextNodes.$inferInsert;
export type MeaningNode = ContextNode;
export type NewMeaningNode = NewContextNode;

export const contextEvidence = pgTable(
  "context_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    meaningNodeId: uuid("context_node_id")
      .notNull()
      .references(() => contextNodes.id, { onDelete: "cascade" }),
    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    packetId: uuid("signal_packet_id")
      .notNull()
      .references(() => signalPackets.id, { onDelete: "cascade" }),
    reason: text("reason").notNull().default(""),
    weight: integer("weight").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    source: text("source").notNull().default("meaning_graph_writer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nodeInspirationUnique: uniqueIndex("context_evidence_node_signal_unique_idx").on(
      table.meaningNodeId,
      table.inspirationId,
    ),
    userNodeIdx: index("context_evidence_user_node_idx").on(
      table.userId,
      table.meaningNodeId,
    ),
    userInspirationIdx: index("context_evidence_user_signal_idx").on(
      table.userId,
      table.inspirationId,
    ),
  }),
);

export const meaningEvidence = contextEvidence;

export type ContextEvidence = typeof contextEvidence.$inferSelect;
export type NewContextEvidence = typeof contextEvidence.$inferInsert;
export type MeaningEvidence = ContextEvidence;
export type NewMeaningEvidence = NewContextEvidence;

export const contextEdges = pgTable(
  "context_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceNodeId: uuid("source_context_node_id")
      .notNull()
      .references(() => contextNodes.id, { onDelete: "cascade" }),
    targetNodeId: uuid("target_context_node_id")
      .notNull()
      .references(() => contextNodes.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    weight: integer("weight").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    evidenceCount: integer("evidence_count").notNull().default(0),
    evidenceInspirationIds: jsonb("evidence_signal_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("meaning_graph_writer"),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userEdgeUnique: uniqueIndex("context_edges_user_source_target_kind_unique_idx").on(
      table.userId,
      table.sourceNodeId,
      table.targetNodeId,
      table.kind,
    ),
    userStatusIdx: index("context_edges_user_status_idx").on(
      table.userId,
      table.status,
    ),
    sourceNodeIdx: index("context_edges_source_node_idx").on(table.sourceNodeId),
    targetNodeIdx: index("context_edges_target_node_idx").on(table.targetNodeId),
  }),
);

export const meaningEdges = contextEdges;

export type ContextEdge = typeof contextEdges.$inferSelect;
export type NewContextEdge = typeof contextEdges.$inferInsert;
export type MeaningEdge = ContextEdge;
export type NewMeaningEdge = NewContextEdge;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  inspirations: many(inspirations),
  inspirationSparks: many(inspirationSparks),
  meaningPackets: many(meaningPackets),
  meaningNodes: many(meaningNodes),
  meaningEvidence: many(meaningEvidence),
  meaningEdges: many(meaningEdges),
}));

export const inspirationsRelations = relations(inspirations, ({ one, many }) => ({
  user: one(users, {
    fields: [inspirations.userId],
    references: [users.id],
  }),
  sparks: many(inspirationSparks),
  meaningPacket: one(meaningPackets, {
    fields: [inspirations.id],
    references: [meaningPackets.inspirationId],
  }),
  meaningEvidence: many(meaningEvidence),
}));

export const inspirationSparksRelations = relations(inspirationSparks, ({ one }) => ({
  user: one(users, {
    fields: [inspirationSparks.userId],
    references: [users.id],
  }),
  inspiration: one(inspirations, {
    fields: [inspirationSparks.inspirationId],
    references: [inspirations.id],
  }),
}));

export const meaningPacketsRelations = relations(meaningPackets, ({ one, many }) => ({
  user: one(users, {
    fields: [meaningPackets.userId],
    references: [users.id],
  }),
  inspiration: one(inspirations, {
    fields: [meaningPackets.inspirationId],
    references: [inspirations.id],
  }),
  primarySpark: one(inspirationSparks, {
    fields: [meaningPackets.primarySparkId],
    references: [inspirationSparks.id],
  }),
  meaningEvidence: many(meaningEvidence),
}));

export const meaningNodesRelations = relations(meaningNodes, ({ one, many }) => ({
  user: one(users, {
    fields: [meaningNodes.userId],
    references: [users.id],
  }),
  evidence: many(meaningEvidence),
  outgoingEdges: many(meaningEdges, { relationName: "meaning_outgoing_edges" }),
  incomingEdges: many(meaningEdges, { relationName: "meaning_incoming_edges" }),
}));

export const meaningEvidenceRelations = relations(meaningEvidence, ({ one }) => ({
  user: one(users, {
    fields: [meaningEvidence.userId],
    references: [users.id],
  }),
  meaningNode: one(meaningNodes, {
    fields: [meaningEvidence.meaningNodeId],
    references: [meaningNodes.id],
  }),
  inspiration: one(inspirations, {
    fields: [meaningEvidence.inspirationId],
    references: [inspirations.id],
  }),
  packet: one(meaningPackets, {
    fields: [meaningEvidence.packetId],
    references: [meaningPackets.id],
  }),
}));

export const meaningEdgesRelations = relations(meaningEdges, ({ one }) => ({
  user: one(users, {
    fields: [meaningEdges.userId],
    references: [users.id],
  }),
  sourceNode: one(meaningNodes, {
    fields: [meaningEdges.sourceNodeId],
    references: [meaningNodes.id],
    relationName: "meaning_outgoing_edges",
  }),
  targetNode: one(meaningNodes, {
    fields: [meaningEdges.targetNodeId],
    references: [meaningNodes.id],
    relationName: "meaning_incoming_edges",
  }),
}));
