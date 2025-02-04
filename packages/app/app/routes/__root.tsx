import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import {
	createRootRouteWithContext,
	Outlet,
	ScrollRestoration,
} from '@tanstack/react-router';
import { Meta, Scripts } from '@tanstack/start';
import { ThemeProvider } from 'next-themes';

import appCss from '@citric/tailwind-config/styles?url';

interface RouterContext {
	queryClient: QueryClient;
}
export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		links: [{ rel: 'stylesheet', href: appCss }],
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
	}),
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
				<Meta />
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

				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}
