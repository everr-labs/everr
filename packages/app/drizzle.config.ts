import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './app/db/schema.ts',
	out: './migrations',
	dialect: 'postgresql',
	dbCredentials: {
		// TODO: THIS
		url: process.env.DATABASE_URL!,
	},
	// tablesFilter: ['citrus_*'],
});
