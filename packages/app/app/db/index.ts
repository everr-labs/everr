import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

if (!process.env.DB_URL) {
	throw new Error('DB_URL environment variable is required');
}

export const db = drizzle(process.env.DB_URL, {
	schema,
	logger: true,
});
