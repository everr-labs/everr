import type { Session, User } from 'better-auth';
import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/start';
import { email, object, picklist, pipe, string } from 'valibot';
import { getEvent, getWebRequest } from 'vinxi/http';

import { auth } from './auth';

const SocialSignInSchema = object({
	provider: picklist(['github']),
});

const socialSignIn = createServerFn({ method: 'POST' })
	.validator(SocialSignInSchema)
	.handler(async ({ data: { provider } }) => {
		const res = await auth.api.signInSocial({ body: { provider } });
		return res;
	});

export const useSocialSignInMutation = () => {
	return useMutation({
		mutationFn: socialSignIn,
		onSuccess: (data) => {
			window.open(data.url, '_self');
		},
	});
};

const SignInSchema = object({
	email: pipe(string(), email()),
	password: string(),
});
const signIn = createServerFn({ method: 'POST' })
	.validator(SignInSchema)
	.handler(async ({ data }) => {
		const res = await auth.api.signInEmail({
			body: { rememberMe: true, ...data },
		});
		return res;
	});

export const useSignInMutation = () => {
	const invalidateAuth = useInvalidateAuth();

	return useMutation({
		mutationFn: signIn,
		onSuccess: invalidateAuth,
	});
};

type Auth =
	| { isAuthenticated: false; user: null; session: null }
	| { isAuthenticated: true; user: User; session: Session };

// eslint-disable-next-line @typescript-eslint/require-await
const getAuth = createServerFn({ method: 'POST' }).handler(async () => {
	const event = getEvent();

	return event.context.auth as Auth;
});

export const getAuthQueryOptions = () => {
	return queryOptions({
		queryKey: ['auth'],
		queryFn: () => getAuth(),
		staleTime: Infinity,
	});
};

const useInvalidateAuth = () => {
	const router = useRouter();
	const queryClient = useQueryClient();

	return async () => {
		await queryClient.invalidateQueries(getAuthQueryOptions());
		await router.invalidate();
	};
};

const signOut = createServerFn({ method: 'POST' }).handler(async () => {
	return await auth.api.signOut({ headers: getWebRequest().headers });
});

export const useSignOutMutation = () => {
	const invalidateAuth = useInvalidateAuth();

	return useMutation({
		mutationFn: () => signOut(),
		onSuccess: invalidateAuth,
	});
};

export const useAuthQuery = () => useSuspenseQuery(getAuthQueryOptions());
