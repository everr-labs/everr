import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { lazy } from 'react';
import SuperJSON from 'superjson';

import { routeTree } from './routeTree.gen';
import { trpc } from './utils/trpc';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient({});
const trpcClient = trpc.createClient({
	links: [
		loggerLink({
			enabled: () => true,
		}),
		httpBatchLink({
			url: '/trpc',
			transformer: SuperJSON,
			async headers() {
				return {
					// authorization: getAuthCookie(),
				};
			},
		}),
	],
});

export function App() {
	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />

				<ReactQueryDevtools initialIsOpen={false} />
				<TanStackRouterDevtools router={router} />
			</QueryClientProvider>
		</trpc.Provider>
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
