import {integer,pgTable,timestamp,uuid} from 'drizzle-orm/pg-core';
import {accounts} from './schema-accounts.js';

/** Accepted chat requests, account-wide across devices and retained profiles. */
export const accountChatLimits=pgTable('account_chat_limits',{
  accountId:uuid('account_id').primaryKey().references(()=>accounts.id,{onDelete:'cascade'}),
  minuteStartedAt:timestamp('minute_started_at',{withTimezone:true}).notNull().defaultNow(),
  minuteCount:integer('minute_count').notNull().default(0),
  hourStartedAt:timestamp('hour_started_at',{withTimezone:true}).notNull().defaultNow(),
  hourCount:integer('hour_count').notNull().default(0),
});
