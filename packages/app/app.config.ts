import { join } from 'path';
import { defineConfig } from '@tanstack/start/config';
import { App } from 'vinxi';
import viteTsConfigPaths from 'vite-tsconfig-paths';

export default withGlobalMiddleware(
	defineConfig({
		tsr: {
			apiBase: '/api',
		},
		vite: {
			plugins: [
				// this is the plugin that enables path aliases
				// @ts-expect-error
				viteTsConfigPaths(),
			],
		},
	}),
);

function withGlobalMiddleware(app: App) {
	return {
		...app,
		config: {
			...app.config,
			routers: app.config.routers.map((router) => ({
				...router,
				middleware:
					router.target === 'server' ? join('app', 'middleware.ts') : undefined,
			})),
		},
	};
}
