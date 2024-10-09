import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRouter, Link, RouterProvider } from '@tanstack/react-router';
import { httpBatchLink, loggerLink } from '@trpc/client';
import SuperJSON from 'superjson';

import { env } from '../env';
import { routeTree } from './routeTree.gen';
import { api } from './utils/trpc';

// Create a new router instance
const router = createRouter({
	routeTree,
	defaultNotFoundComponent: () => {
		return (
			<div>
				<p>Not found!</p>
				<Link to="/">Go home</Link>
			</div>
		);
	},
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient();
const trpcClient = api.createClient({
	links: [
		loggerLink({
			enabled: () => true,
		}),
		httpBatchLink({
			url: '/trpc',
			transformer: SuperJSON,
			headers() {
				return {
					// authorization: getAuthCookie(),
				};
			},
		}),
	],
});

export function App() {
	return (
		<Suspense fallback={<>...</>}>
			<QueryClientProvider client={queryClient}>
				<api.Provider client={trpcClient} queryClient={queryClient}>
					<RouterProvider router={router} />

					<ReactQueryDevtools initialIsOpen={false} />
					<TanStackRouterDevtools router={router} />
				</api.Provider>
			</QueryClientProvider>
		</Suspense>
	);
}

const TanStackRouterDevtools =
	env.PUBLIC_NODE_ENV === 'production'
		? () => null
		: lazy(() =>
				import('@tanstack/router-devtools').then((res) => ({
					default: res.TanStackRouterDevtools,
				})),
			);
