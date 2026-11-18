import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', { id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(), data: text('data').notNull(), updated: text('updated').notNull() });
export const decisions = sqliteTable('decisions', { id: text('id').primaryKey(), owner: text('owner').notNull(), data: text('data').notNull(), created: text('created').notNull() });
