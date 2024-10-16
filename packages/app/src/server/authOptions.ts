import type { AuthConfig } from '@auth/core';
import GitHub from '@auth/core/providers/github';
import { DrizzleAdapter } from '@auth/drizzle-adapter';

import { env } from '../env';
import { db } from './db';
import { accounts, sessions, users, verificationTokens } from './db/schema';

const providers = [
	GitHub({
		clientId: env.GITHUB_CLIENT_ID,
		clientSecret: env.GITHUB_CLIENT_SECRET,
	}),
];

export const authOptions: AuthConfig = {
	trustHost: true,
	secret: env.AUTH_SECRET,
	basePath: '/api/auth',
	adapter: {
		...DrizzleAdapter(db, {
			usersTable: users,
			accountsTable: accounts,
			sessionsTable: sessions,
			verificationTokensTable: verificationTokens,
		}),
	},
	pages: {
		signIn: '/auth/login',
	},
	providers,
	callbacks: {
		session: (opts) => {
			if (!('user' in opts))
				throw new Error('unreachable with session strategy');

			return {
				...opts.session,
				user: {
					...opts.session.user,
					id: opts.user.id,
				},
			};
		},
	},
};
