CREATE TABLE IF NOT EXISTS "meaning_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "packet_id" uuid NOT NULL REFERENCES "meaning_packets"("id") ON DELETE cascade,
  "node_type" text DEFAULT 'inspiration' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'meaning_graph_writer' NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_graph_nodes_user_inspiration_unique_idx"
  ON "meaning_graph_nodes" ("user_id", "inspiration_id");

CREATE INDEX IF NOT EXISTS "meaning_graph_nodes_user_status_idx"
  ON "meaning_graph_nodes" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "meaning_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "from_node_id" uuid NOT NULL REFERENCES "meaning_graph_nodes"("id") ON DELETE cascade,
  "to_node_id" uuid NOT NULL REFERENCES "meaning_graph_nodes"("id") ON DELETE cascade,
  "from_inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "to_inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'meaning_relationship_judge' NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_graph_edges_user_from_to_kind_unique_idx"
  ON "meaning_graph_edges" ("user_id", "from_inspiration_id", "to_inspiration_id", "kind");

CREATE INDEX IF NOT EXISTS "meaning_graph_edges_user_status_idx"
  ON "meaning_graph_edges" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "meaning_graph_edges_from_node_idx"
  ON "meaning_graph_edges" ("from_node_id");

CREATE INDEX IF NOT EXISTS "meaning_graph_edges_to_node_idx"
  ON "meaning_graph_edges" ("to_node_id");
