import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    // Only the packages with a test config. A directory without one (such as
    // storybook) would otherwise become a project with default settings.
    projects: ["packages/*/vitest.config.ts"],
    reporters: ["verbose"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["packages/**/src/**/*.{ts,tsx}"],
      exclude: ["packages/**/src/routeTree.gen.ts"],
    },
  },
});
