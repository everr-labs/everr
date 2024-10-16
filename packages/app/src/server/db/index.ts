import { drizzle } from 'drizzle-orm/node-postgres';

import { env } from '../../env';
import { accounts, sessions, users, verificationTokens } from './schema';

export const db = drizzle(env.DATABASE_URL, {
	schema: {
		users,
		accounts,
		sessions,
		verificationTokens,
	},
});
