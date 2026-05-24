CREATE TABLE IF NOT EXISTS "meaning_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "label" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'meaning_graph_writer' NOT NULL,
  "weight" integer DEFAULT 0 NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "evidence_count" integer DEFAULT 0 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_reinforced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_nodes_user_type_label_unique_idx"
  ON "meaning_nodes" ("user_id", "type", "label");

CREATE INDEX IF NOT EXISTS "meaning_nodes_user_status_idx"
  ON "meaning_nodes" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "meaning_nodes_user_weight_idx"
  ON "meaning_nodes" ("user_id", "weight" DESC);

CREATE TABLE IF NOT EXISTS "meaning_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "meaning_node_id" uuid NOT NULL REFERENCES "meaning_nodes"("id") ON DELETE cascade,
  "inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "packet_id" uuid NOT NULL REFERENCES "meaning_packets"("id") ON DELETE cascade,
  "reason" text DEFAULT '' NOT NULL,
  "weight" integer DEFAULT 0 NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'meaning_graph_writer' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_evidence_node_inspiration_unique_idx"
  ON "meaning_evidence" ("meaning_node_id", "inspiration_id");

CREATE INDEX IF NOT EXISTS "meaning_evidence_user_node_idx"
  ON "meaning_evidence" ("user_id", "meaning_node_id");

CREATE INDEX IF NOT EXISTS "meaning_evidence_user_inspiration_idx"
  ON "meaning_evidence" ("user_id", "inspiration_id");

CREATE TABLE IF NOT EXISTS "meaning_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source_node_id" uuid NOT NULL REFERENCES "meaning_nodes"("id") ON DELETE cascade,
  "target_node_id" uuid NOT NULL REFERENCES "meaning_nodes"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "weight" integer DEFAULT 0 NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "evidence_count" integer DEFAULT 0 NOT NULL,
  "evidence_inspiration_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'meaning_graph_writer' NOT NULL,
  "last_reinforced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_edges_user_source_target_kind_unique_idx"
  ON "meaning_edges" ("user_id", "source_node_id", "target_node_id", "kind");

CREATE INDEX IF NOT EXISTS "meaning_edges_user_status_idx"
  ON "meaning_edges" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "meaning_edges_source_node_idx"
  ON "meaning_edges" ("source_node_id");

CREATE INDEX IF NOT EXISTS "meaning_edges_target_node_idx"
  ON "meaning_edges" ("target_node_id");
