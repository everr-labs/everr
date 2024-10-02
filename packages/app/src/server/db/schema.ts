import type { AdapterAccountType } from '@auth/core/adapters';
import { relations } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('user', {
	id: text('id', { length: 255 })
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name', { length: 255 }),
	email: text('email', { length: 255 }).unique(),
	emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
	image: text('image', { length: 255 }),
});

export const usersRelations = relations(users, ({ many }) => ({
	accounts: many(accounts),
}));

export const accounts = sqliteTable(
	'account',
	{
		userId: text('userId', { length: 255 }).notNull(),
		type: text('type', { length: 255 }).$type<AdapterAccountType>().notNull(),
		provider: text('provider', { length: 255 }).notNull(),
		providerAccountId: text('providerAccountId', { length: 255 }).notNull(),
		refresh_token: text('refresh_token', { length: 255 }),
		access_token: text('access_token'),
		expires_at: integer('expires_at'),
		token_type: text('token_type', { length: 255 }),
		scope: text('scope', { length: 255 }),
		id_token: text('id_token'),
		session_state: text('session_state', { length: 255 }),
	},
	(account) => ({
		compoundKey: primaryKey({
			columns: [account.provider, account.providerAccountId],
		}),
		userIdIdx: index('account_userId_idx').on(account.userId),
	}),
);

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = sqliteTable(
	'session',
	{
		sessionToken: text('sessionToken', { length: 255 }).notNull().primaryKey(),
		userId: text('userId', { length: 255 }).notNull(),
		expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
	},
	(session) => ({
		userIdIdx: index('session_userId_idx').on(session.userId),
	}),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = sqliteTable(
	'verificationToken',
	{
		identifier: text('identifier', { length: 255 }).notNull(),
		token: text('token', { length: 255 }).notNull(),
		expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
	},
	(vt) => ({
		compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
	}),
);
