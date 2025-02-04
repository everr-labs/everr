import { drizzle } from 'drizzle-orm/node-postgres';

import { account, session, user, verification } from './schema';

export const db = drizzle(process.env.DATABASE_URL!, {
	schema: {
		account,
		session,
		user,
		verification,
	},
});
