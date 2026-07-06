CREATE TABLE "signal_activations" (
	"signal_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"activation" real DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fire_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "signal_activations" ADD CONSTRAINT "signal_activations_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_activations" ADD CONSTRAINT "signal_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_activations_user_activation_idx" ON "signal_activations" USING btree ("user_id","activation" DESC NULLS LAST);
