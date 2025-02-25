import { defineConfig } from '@tanstack/start/config';
import viteTsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
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
	server: {
		preset: 'node-server',
	},
});
