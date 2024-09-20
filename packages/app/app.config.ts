import { fileURLToPath } from 'url';

import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { createApp, type RouterSchemaInput } from 'vinxi';
import { input } from 'vinxi/plugins/config';
import tsconfigPaths from 'vite-tsconfig-paths';

function trpcRouter() {
	return {
		name: 'server',
		base: '/trpc',
		type: 'http',
		handler: fileURLToPath(new URL('./handler.ts', import.meta.url)),
		target: 'server',
		plugins: () => [
			tsconfigPaths(),
			input(
				'$vinxi/trpc/router',
				fileURLToPath(new URL('./src/server/index.ts', import.meta.url)),
			),
		],
	} satisfies RouterSchemaInput;
}

export default createApp({
	routers: [
		{
			name: 'public',
			type: 'static',
			dir: './public',
		},
		trpcRouter(),
		{
			name: 'client',
			type: 'spa',
			plugins: () => [
				tsconfigPaths(),
				TanStackRouterVite({
					routesDirectory: './src/app/routes',
					generatedRouteTree: './src/app/routeTree.gen.ts',
					autoCodeSplitting: true,
				}),
				viteReact(),
			],
			handler: './index.html',
			base: '/',
			target: 'browser',
		},
	],
});
