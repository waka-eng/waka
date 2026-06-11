ALTER TABLE "inspirations" RENAME TO "signals";--> statement-breakpoint
ALTER TABLE "inspiration_sparks" RENAME TO "signal_sparks";--> statement-breakpoint
ALTER TABLE "meaning_packets" RENAME TO "signal_packets";--> statement-breakpoint
ALTER TABLE "meaning_nodes" RENAME TO "context_nodes";--> statement-breakpoint
ALTER TABLE "meaning_evidence" RENAME TO "context_evidence";--> statement-breakpoint
ALTER TABLE "meaning_edges" RENAME TO "context_edges";--> statement-breakpoint
ALTER TABLE "wow_moments" RENAME TO "top_of_mind_notes";--> statement-breakpoint
ALTER TABLE "wow_moment_inspirations" RENAME TO "top_of_mind_note_signals";--> statement-breakpoint
ALTER TABLE "inspiration_embeddings" RENAME TO "signal_embeddings";--> statement-breakpoint
ALTER TABLE "inspiration_revisit_events" RENAME TO "signal_revisit_events";--> statement-breakpoint

ALTER TABLE "attachments" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "reflections" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "signal_sparks" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "signal_packets" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "context_evidence" RENAME COLUMN "meaning_node_id" TO "context_node_id";--> statement-breakpoint
ALTER TABLE "context_evidence" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "context_evidence" RENAME COLUMN "packet_id" TO "signal_packet_id";--> statement-breakpoint
ALTER TABLE "context_edges" RENAME COLUMN "source_node_id" TO "source_context_node_id";--> statement-breakpoint
ALTER TABLE "context_edges" RENAME COLUMN "target_node_id" TO "target_context_node_id";--> statement-breakpoint
ALTER TABLE "context_edges" RENAME COLUMN "evidence_inspiration_ids" TO "evidence_signal_ids";--> statement-breakpoint
ALTER TABLE "top_of_mind_note_signals" RENAME COLUMN "wow_moment_id" TO "top_of_mind_note_id";--> statement-breakpoint
ALTER TABLE "top_of_mind_note_signals" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "signal_embeddings" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint
ALTER TABLE "signal_revisit_events" RENAME COLUMN "inspiration_id" TO "signal_id";--> statement-breakpoint

ALTER TYPE "inspiration_revisit_event_type" RENAME TO "signal_revisit_event_type";--> statement-breakpoint

ALTER INDEX IF EXISTS "inspirations_user_created_idx" RENAME TO "signals_user_created_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspirations_cluster_null_idx" RENAME TO "signals_cluster_null_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" RENAME CONSTRAINT "inspirations_user_id_users_id_fk" TO "signals_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" RENAME CONSTRAINT "inspirations_user_id_id_unique_idx" TO "signals_user_id_id_unique_idx";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS "attachments_inspiration_idx" RENAME TO "attachments_signal_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" RENAME CONSTRAINT "attachments_inspiration_id_inspirations_id_fk" TO "attachments_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "reflections_inspiration_created_idx" RENAME TO "reflections_signal_created_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reflections" RENAME CONSTRAINT "reflections_inspiration_id_inspirations_id_fk" TO "reflections_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS "inspiration_sparks_user_inspiration_idx" RENAME TO "signal_sparks_user_signal_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspiration_sparks_inspiration_created_idx" RENAME TO "signal_sparks_signal_created_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_sparks" RENAME CONSTRAINT "inspiration_sparks_user_id_fkey" TO "signal_sparks_user_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_sparks" RENAME CONSTRAINT "inspiration_sparks_inspiration_id_fkey" TO "signal_sparks_signal_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_packets_user_inspiration_unique_idx" RENAME TO "signal_packets_user_signal_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_packets_user_updated_idx" RENAME TO "signal_packets_user_updated_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_packets" RENAME CONSTRAINT "meaning_packets_user_id_users_id_fk" TO "signal_packets_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_packets" RENAME CONSTRAINT "meaning_packets_inspiration_id_inspirations_id_fk" TO "signal_packets_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_packets" RENAME CONSTRAINT "meaning_packets_primary_spark_id_inspiration_sparks_id_fk" TO "signal_packets_primary_spark_id_signal_sparks_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_nodes_user_type_label_unique_idx" RENAME TO "context_nodes_user_type_label_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_nodes_user_status_idx" RENAME TO "context_nodes_user_status_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_nodes_user_weight_idx" RENAME TO "context_nodes_user_weight_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_nodes" RENAME CONSTRAINT "meaning_nodes_user_id_fkey" TO "context_nodes_user_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_evidence_node_inspiration_unique_idx" RENAME TO "context_evidence_node_signal_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_evidence_user_node_idx" RENAME TO "context_evidence_user_node_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_evidence_user_inspiration_idx" RENAME TO "context_evidence_user_signal_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_evidence" RENAME CONSTRAINT "meaning_evidence_user_id_fkey" TO "context_evidence_user_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_evidence" RENAME CONSTRAINT "meaning_evidence_meaning_node_id_fkey" TO "context_evidence_context_node_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_evidence" RENAME CONSTRAINT "meaning_evidence_inspiration_id_fkey" TO "context_evidence_signal_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_evidence" RENAME CONSTRAINT "meaning_evidence_packet_id_fkey" TO "context_evidence_signal_packet_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_edges_user_source_target_kind_unique_idx" RENAME TO "context_edges_user_source_target_kind_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_edges_user_status_idx" RENAME TO "context_edges_user_status_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_edges_source_node_idx" RENAME TO "context_edges_source_node_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "meaning_edges_target_node_idx" RENAME TO "context_edges_target_node_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_edges" RENAME CONSTRAINT "meaning_edges_user_id_fkey" TO "context_edges_user_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_edges" RENAME CONSTRAINT "meaning_edges_source_node_id_fkey" TO "context_edges_source_context_node_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_edges" RENAME CONSTRAINT "meaning_edges_target_node_id_fkey" TO "context_edges_target_context_node_id_fkey";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS "wow_moments_idempotency_key_unique_idx" RENAME TO "top_of_mind_notes_idempotency_key_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moments_user_created_idx" RENAME TO "top_of_mind_notes_user_created_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moments_user_score_idx" RENAME TO "top_of_mind_notes_user_score_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moments_user_id_id_unique_idx" RENAME TO "top_of_mind_notes_user_id_id_unique_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_notes" RENAME CONSTRAINT "wow_moments_user_id_users_id_fk" TO "top_of_mind_notes_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moment_inspirations_moment_order_idx" RENAME TO "top_of_mind_note_signals_note_order_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moment_inspirations_inspiration_idx" RENAME TO "top_of_mind_note_signals_signal_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "wow_moment_inspirations_moment_inspiration_unique_idx" RENAME TO "top_of_mind_note_signals_note_signal_unique_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_note_signals" RENAME CONSTRAINT "wow_moment_inspirations_user_id_users_id_fk" TO "top_of_mind_note_signals_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_note_signals" RENAME CONSTRAINT "wow_moment_inspirations_wow_moment_id_wow_moments_id_fk" TO "top_of_mind_note_signals_note_id_notes_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_note_signals" RENAME CONSTRAINT "wow_moment_inspirations_inspiration_id_inspirations_id_fk" TO "top_of_mind_note_signals_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_note_signals" RENAME CONSTRAINT "wow_moment_inspirations_user_moment_fk" TO "top_of_mind_note_signals_user_note_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "top_of_mind_note_signals" RENAME CONSTRAINT "wow_moment_inspirations_user_inspiration_fk" TO "top_of_mind_note_signals_user_signal_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS "inspiration_embeddings_inspiration_unique_idx" RENAME TO "signal_embeddings_signal_unique_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspiration_embeddings_user_inspiration_idx" RENAME TO "signal_embeddings_user_signal_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspiration_embeddings_user_model_idx" RENAME TO "signal_embeddings_user_model_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspiration_embeddings_user_model_dimensions_idx" RENAME TO "signal_embeddings_user_model_dimensions_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_embeddings" RENAME CONSTRAINT "inspiration_embeddings_user_id_users_id_fk" TO "signal_embeddings_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_embeddings" RENAME CONSTRAINT "inspiration_embeddings_inspiration_id_inspirations_id_fk" TO "signal_embeddings_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_embeddings" RENAME CONSTRAINT "inspiration_embeddings_user_inspiration_fk" TO "signal_embeddings_user_signal_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS "inspiration_revisit_events_inspiration_created_idx" RENAME TO "signal_revisit_events_signal_created_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "inspiration_revisit_events_user_created_idx" RENAME TO "signal_revisit_events_user_created_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_revisit_events" RENAME CONSTRAINT "inspiration_revisit_events_user_id_users_id_fk" TO "signal_revisit_events_user_id_users_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_revisit_events" RENAME CONSTRAINT "inspiration_revisit_events_inspiration_id_inspirations_id_fk" TO "signal_revisit_events_signal_id_signals_id_fk";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;
