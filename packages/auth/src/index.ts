import type { AuthConfig } from '@auth/core';
import type {
	BuiltInProviderType,
	RedirectableProviderType,
} from '@auth/core/providers';
import type { Session } from '@auth/core/types';
import { Auth } from '@auth/core';

type LiteralUnion<T extends U, U = string> = T | (U & Record<never, never>);

interface CSRFResponse {
	csrfToken: string;
}

interface SignInOptions extends Record<string, unknown> {
	/**
	 * Specify to which URL the user will be redirected after signing in. Defaults to the page URL the sign-in is initiated from.
	 *
	 * [Documentation](https://next-auth.js.org/getting-started/client#specifying-a-callbackurl)
	 */
	callbackUrl?: string;
	/**
	 * [Documentation](https://next-auth.js.org/getting-started/client#using-the-redirect-false-option)
	 */
	redirect?: boolean;
}

/** Match `inputType` of `new URLSearchParams(inputType)` */
type SignInAuthorizationParams =
	| string
	| string[][]
	| Record<string, string>
	| URLSearchParams;

export async function signIn<
	P extends RedirectableProviderType | undefined = undefined,
>(
	providerId?: LiteralUnion<
		P extends RedirectableProviderType
			? P | BuiltInProviderType
			: BuiltInProviderType
	>,
	options?: SignInOptions,
	authorizationParams?: SignInAuthorizationParams,
) {
	const { callbackUrl = window.location.href, redirect = true } = options ?? {};

	// TODO: Support custom providers
	const isCredentials = providerId === 'credentials';
	const isEmail = providerId === 'email';
	const isSupportingReturn = isCredentials || isEmail;

	// TODO: Handle custom base path
	const signInUrl = `/api/auth/${
		isCredentials ? 'callback' : 'signin'
	}/${providerId}`;

	const _signInUrl = `${signInUrl}?${new URLSearchParams(authorizationParams)}`;

	// TODO: Handle custom base path
	const csrfTokenResponse = await fetch('/api/auth/csrf');
	const { csrfToken } = (await csrfTokenResponse.json()) as CSRFResponse;

	const res = await fetch(_signInUrl, {
		method: 'post',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'X-Auth-Return-Redirect': '1',
		},
		// @ts-expect-error: body is not a valid property
		body: new URLSearchParams({
			...options,
			csrfToken,
			callbackUrl,
		}),
	});

	const data = await res.clone().json();

	const error = new URL(data.url).searchParams.get('error');
	if (redirect || !isSupportingReturn || !error) {
		// TODO: Do not redirect for Credentials and Email providers by default in next major
		window.location.href = data.url ?? data.redirect ?? callbackUrl;
		// If url contains a hash, the browser does not reload the page. We reload manually
		if (data.url.includes('#')) window.location.reload();
		return;
	}
	return res;
}

interface SignOutParams<R extends boolean = true> {
	/** [Documentation](https://next-auth.js.org/getting-started/client#specifying-a-callbackurl-1) */
	callbackUrl?: string;
	/** [Documentation](https://next-auth.js.org/getting-started/client#using-the-redirect-false-option-1 */
	redirect?: R;
}

export async function signOut(options?: SignOutParams) {
	const { callbackUrl = window.location.href } = options ?? {};
	// TODO: Custom base path
	const csrfTokenResponse = await fetch('/api/auth/csrf');
	const { csrfToken } = (await csrfTokenResponse.json()) as CSRFResponse;

	const res = await fetch(`/api/auth/signout`, {
		method: 'post',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'X-Auth-Return-Redirect': '1',
		},
		body: new URLSearchParams({
			csrfToken,
			callbackUrl,
		}),
	});

	const data = await res.json();

	const url = data.url ?? data.redirect ?? callbackUrl;
	window.location.href = url;
	// If url contains a hash, the browser does not reload the page. We reload manually
	if (url.includes('#')) window.location.reload();
}

export async function authenticateRequest(
	request: Request,
	authOptions: AuthConfig,
): Promise<Session | null> {
	const url = new URL('/api/auth/session', request.url);

	const response = await Auth(
		new Request(url, { headers: request.headers }),
		authOptions,
	);

	const { status = 200 } = response;

	const data = await response.json();

	if (!data || !Object.keys(data).length) return null;
	if (status === 200) return data;
	throw new Error(data.message);
}
