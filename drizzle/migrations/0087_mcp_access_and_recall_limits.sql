CREATE TABLE "account_recall_limits" (
  "account_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."accounts"("id") ON DELETE CASCADE,
  "minute_started_at" timestamptz DEFAULT now() NOT NULL,
  "minute_count" integer DEFAULT 0 NOT NULL,
  "hour_started_at" timestamptz DEFAULT now() NOT NULL,
  "hour_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "account_recall_limits_counts" CHECK ("minute_count" >= 0 AND "hour_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "keeper_keys" ADD COLUMN "access" text DEFAULT 'read_capture' NOT NULL;
--> statement-breakpoint
ALTER TABLE "keeper_keys" ADD CONSTRAINT "keeper_keys_access_check" CHECK ("access" IN ('read_capture', 'read_only'));
