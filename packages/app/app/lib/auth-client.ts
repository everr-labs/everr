import { useQuery } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { getWebRequest } from '@tanstack/react-start/server';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {
	email,
	forward,
	minLength,
	object,
	partialCheck,
	picklist,
	pipe,
	string,
} from 'valibot';

import { auth } from './auth';

if (import.meta.env.VITE_BETTER_AUTH_URL === undefined) {
	throw new Error('Missing VITE_BETTER_AUTH_URL');
}

export const SocialSignInSchema = object({
	provider: picklist(['github']),
});

export const SignInSchema = object({
	email: pipe(string(), email()),
	password: string(),
});

export const SignUpSchema = pipe(
	object({
		name: string(),
		email: pipe(string(), email()),
		password: pipe(
			string(),
			minLength(8, 'Password must be at least 8 characters'),
		),
		passwordConfirm: string(),
	}),
	forward(
		partialCheck(
			[['password'], ['passwordConfirm']],
			(input) => input.password === input.passwordConfirm,
			'The two passwords do not match.',
		),
		['passwordConfirm'],
	),
);

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_BETTER_AUTH_URL, // the base url of your auth server
	plugins: [organizationClient()],
});

const getActiveOrganization = createServerFn({ method: 'GET' }).handler(
	async () => {
		const request = getWebRequest();
		if (!request) {
			return null;
		}
		const session = await auth.api.getSession({ headers: request.headers });
		if (!session) {
			return null;
		}
		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return null;
		}

		return auth.api.getFullOrganization({
			headers: request.headers,
			query: { organizationId: activeOrgId },
		});
	},
);

export const useActiveOrganization = () => {
	return useQuery({
		queryFn: () => getActiveOrganization(),
		queryKey: ['active-organization'],
		staleTime: 5000,
	});
};
