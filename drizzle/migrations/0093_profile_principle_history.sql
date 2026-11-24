CREATE TABLE "profile_principle_history" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"first_principle_id" uuid
);
--> statement-breakpoint
ALTER TABLE "profile_principle_history" ADD CONSTRAINT "profile_principle_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "public"."record_profile_principle_history"() RETURNS trigger
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
BEGIN
  INSERT INTO profile_principle_history(profile_id) VALUES(NEW.profile_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER zz_profile_principle_history AFTER INSERT ON "public"."principles"
FOR EACH ROW EXECUTE FUNCTION "public"."record_profile_principle_history"();
--> statement-breakpoint
INSERT INTO "public"."profile_principle_history" (profile_id)
SELECT p.profile_id FROM "public"."principles" p
UNION
SELECT s.profile_id FROM "public"."principle_generation_steps" s
WHERE s.kind='publication' AND s.status='ready' AND s.response->>'minted' ~ '^[1-9][0-9]*$'
ON CONFLICT DO NOTHING;
