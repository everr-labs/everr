import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*'],
		reporters: ["verbose"],
		coverage: {
		  enabled: true,
			provider: "v8",
			include: ["packages/**/src/**/*.{ts,tsx}"],
			exclude: ["packages/**/src/routeTree.gen.ts"],
		},
  },
})
