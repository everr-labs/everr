import tsconfigPaths from 'vite-tsconfig-paths';

import { defineConfig } from './app.config.lib';

export default defineConfig({
	vite: {
		plugins: () => [tsconfigPaths()],
	},
});
