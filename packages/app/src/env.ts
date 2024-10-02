import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
	clientPrefix: 'PUBLIC_',
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		BASE_URL: z.string().url(),
		DATABASE_URL: z.string(),
		NODE_ENV: z
			.enum(['development', 'test', 'production'])
			.default('development'),
		GITHUB_CLIENT_ID: z.string(),
		GITHUB_CLIENT_SECRET: z.string(),
		CLICKHOUSE_DB: z.string(),
		CLICKHOUSE_USER: z.string(),
		CLICKHOUSE_PASSWORD: z.string().optional(),
		CLICKHOUSE_URL: z.string().url(),
		AUTH_SECRET: z.string(),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		PUBLIC_NODE_ENV: z
			.enum(['development', 'test', 'production'])
			.default('development'),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		BASE_URL: process.env.BASE_URL,
		DATABASE_URL: process.env.DATABASE_URL,
		NODE_ENV: process.env.NODE_ENV,
		AUTH_SECRET: process.env.AUTH_SECRET,
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
		CLICKHOUSE_DB: process.env.CLICKHOUSE_DB,
		CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
		CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
		CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
