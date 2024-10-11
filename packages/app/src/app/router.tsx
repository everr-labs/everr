import { lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
	createRouter as createTanStackRouter,
	Link,
} from '@tanstack/react-router';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { createTRPCQueryUtils } from '@trpc/react-query';
import SuperJSON from 'superjson';

import { env } from '../env';
import { routeTree } from './routeTree.gen';
import { api } from './utils/trpc';

const TanStackRouterDevtools =
	env.PUBLIC_NODE_ENV === 'production'
		? () => null
		: lazy(() =>
				import('@tanstack/router-devtools').then((res) => ({
					default: res.TanStackRouterDevtools,
				})),
			);

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

export const trpcQueryUtils = createTRPCQueryUtils({
	queryClient,
	client: trpcClient,
});

// Create a new router instance
export function createRouter() {
	const router = createTanStackRouter({
		routeTree,
		defaultPreload: 'intent',
		context: {
			trpcQueryUtils,
		},
		defaultNotFoundComponent: () => {
			return (
				<div>
					<p>Not found!</p>
					<Link to="/">Go home</Link>
				</div>
			);
		},
		Wrap: function WrapComponent({ children }) {
			return (
				<api.Provider client={trpcClient} queryClient={queryClient}>
					<QueryClientProvider client={queryClient}>
						{children}
						<ReactQueryDevtools initialIsOpen={false} />
						<TanStackRouterDevtools router={router} />
					</QueryClientProvider>
				</api.Provider>
			);
		},
	});

	return router;
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createRouter>;
	}
}
