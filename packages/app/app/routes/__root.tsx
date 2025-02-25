import type { QueryClient } from '@tanstack/react-query';
import type { User } from 'better-auth';
import type { ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { DefaultCatchBoundary } from '@/components/default-catch-boundary';
import { NotFound } from '@/components/not-found';
import { auth } from '@/lib/auth';
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/start';
import { ThemeProvider } from 'next-themes';
import { getWebRequest } from 'vinxi/http';

import appCss from '@citric/tailwind-config/styles?url';

const getUser = createServerFn({ method: 'GET' }).handler(async () => {
	const { headers } = getWebRequest();

	const session = await auth.api.getSession({ headers });

	return session?.user ?? null;
});

console.log(process.env);

interface RouterContext {
	queryClient: QueryClient;
	user: User | null;
}
export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async () => {
		return { user: await getUser() };
	},
	head: () => ({
		meta: [
			{
				charSet: 'utf-8',
			},
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1',
			},
			{
				title: 'Citric - CI/CD Observability',
			},
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	errorComponent: (props) => {
		return (
			<RootDocument>
				<DefaultCatchBoundary {...props} />
			</RootDocument>
		);
	},
	notFoundComponent: () => <NotFound />,
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

const TanStackRouterDevtools =
	process.env.NODE_ENV === 'production'
		? () => null
		: lazy(() =>
				import('@tanstack/router-devtools').then((res) => ({
					default: res.TanStackRouterDevtools,
				})),
			);

const ReactQueryDevtools =
	process.env.NODE_ENV === 'production'
		? () => null
		: lazy(() =>
				import('@tanstack/react-query-devtools').then((d) => ({
					default: d.ReactQueryDevtools,
				})),
			);

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html className="dark" style={{ colorScheme: 'dark' }}>
			<head>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider
					defaultTheme="dark"
					storageKey="ui-theme"
					enableSystem
					attribute="class"
				>
					{children}
				</ThemeProvider>

				<Suspense>
					<TanStackRouterDevtools />
					<ReactQueryDevtools />
				</Suspense>

				<Scripts />
			</body>
		</html>
	);
}
