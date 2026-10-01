import { bigint, pgTable, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./schema-profiles.js";

/** Internal optimistic generation fence. Not an artifact version or receipt. */
export const generationRevisions = pgTable("generation_revisions", {
  profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
});
