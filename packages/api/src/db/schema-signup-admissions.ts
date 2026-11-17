import {sql} from 'drizzle-orm';
import {check,index,pgTable,text,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
/** Human-challenge reservations only. No account FK: erasure cannot replenish
 * admission capacity. Indexed seven-day digest retention, never raw proofs. */
export const signupAdmissions=pgTable('signup_admissions',{
 nonceHash:text('nonce_hash').primaryKey(),tokenHash:text('token_hash').notNull(),
 stage:text('stage').notNull(),flow:text('flow').notNull(),state:text('state').notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 creationStartedAt:timestamp('creation_started_at',{withTimezone:true}),
 consumedAt:timestamp('consumed_at',{withTimezone:true}),
 oauthStateHash:text('oauth_state_hash'),oauthPkceHash:text('oauth_pkce_hash'),
},t=>[
 uniqueIndex('signup_admissions_token_unique').on(t.tokenHash),
 index('signup_admissions_created_idx').on(t.stage,t.createdAt),
 index('signup_admissions_creation_idx').on(t.stage,t.creationStartedAt),
 check('signup_admissions_shape',sql`${t.nonceHash} ~ '^[0-9a-f]{64}$' AND ${t.tokenHash} ~ '^[0-9a-f]{64}$'
 AND ${t.stage} IN ('development','dev','production') AND ${t.flow} IN ('password','google')
 AND ${t.state} IN ('reserved','verified','rejected','unknown','creating','oauth_bound','consumed')
 AND ${t.expiresAt} > ${t.createdAt}
 AND ((${t.oauthStateHash} IS NULL AND ${t.oauthPkceHash} IS NULL) OR (${t.oauthStateHash} IS NOT NULL AND ${t.oauthPkceHash} IS NOT NULL AND ${t.oauthStateHash} ~ '^[0-9a-f]{64}$' AND ${t.oauthPkceHash} ~ '^[0-9a-f]{64}$'))
 AND (${t.state} <> 'consumed' OR (${t.consumedAt} IS NOT NULL AND ${t.creationStartedAt} IS NOT NULL))`),
]);
