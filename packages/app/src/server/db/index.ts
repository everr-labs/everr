import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { env } from '../../env';
import { accounts, sessions, users, verificationTokens } from './schema';

const sqlite = new Database(env.DATABASE_URL);

export const db = drizzle(sqlite, {
	schema: {
		users,
		accounts,
		sessions,
		verificationTokens,
	},
});
