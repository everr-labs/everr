import { db } from '@/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';

import { Test } from '@citric/emails';

import { sendEmail } from './email';

if (!process.env.GITHUB_CLIENT_ID) {
	throw new Error('GITHUB_CLIENT_ID environment variable is required');
}
if (!process.env.GITHUB_CLIENT_SECRET) {
	throw new Error('GITHUB_CLIENT_SECRET environment variable is required');
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
	}),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [organization()],
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID,
			clientSecret: process.env.GITHUB_CLIENT_SECRET,
		},
	},
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					await sendEmail({
						to: user.email,
						subject: 'Welcome!',
						react: <Test />,
					});
				},
			},
		},
	},
});
