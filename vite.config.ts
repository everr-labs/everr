import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "**/routeTree.gen.ts",
  "**/dist/**",
  "**/.output/**",
  "**/.nitro/**",
  "**/.tanstack/**",
  "**/tests/fixtures/**",
  // TOML stays out: oxfmt collapses Cargo.toml arrays and there is no separate
  // Rust/TOML formatter wired up here.
  "**/*.toml",
  // Generated / tool-managed files: Drizzle snapshots must match drizzle-kit's
  // output byte-for-byte (CI regenerates and diffs them), and these others are
  // written by their own tooling. (JS/TS/JSON/CSS/YAML/Markdown are formatted.)
  "**/drizzle/**",
  "**/.cta.json",
  "**/tauri.conf.json",
  "**/.vscode/**",
  "packages/docs/content/**/*.json",
  "packages/docs/cli.json",
];

export default defineConfig({
  fmt: { ignorePatterns },
  lint: {
    ignorePatterns,
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      // Aliased to a short name: oxlint's jsPlugins alias form is the supported
      // way to load scoped (`@tanstack/...`) ESLint plugins, so rules are
      // referenced as `query/*` below.
      { name: "query", specifier: "@tanstack/eslint-plugin-query" },
      // NOTE: @tanstack/eslint-plugin-router is intentionally omitted. Its
      // `create-route-property-order` rule crashes under oxlint's (alpha)
      // JS-plugin runtime on valid conditional-spread syntax
      // (`Unsupported spread element`). Revisit when oxlint gains native
      // TanStack Router support or the plugin's oxlint compat is fixed.
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // @tanstack/eslint-plugin-query — flat/recommended severities, except
      // rules with pre-existing violations are ratcheted to "warn" so they
      // surface without blocking CI. Promote to "error" once the backlog is
      // cleared. `exhaustive-deps` mostly flags our query-options-factory
      // convention (spreading an input object's primitive fields into the key),
      // which is deliberate, so it stays a warning.
      // Kept on to catch genuinely missing queryKey deps in new code. The
      // current hits are all false positives from our query-options-factory
      // convention (dependency-injected repos, rest-spread keys, `refresh`
      // deliberately excluded) and are suppressed inline at each site.
      "query/exhaustive-deps": "error",
      "query/no-rest-destructuring": "error",
      "query/stable-query-client": "error",
      "query/no-unstable-deps": "error",
      "query/infinite-query-property-order": "error",
      "query/no-void-query-fn": "error",
      "query/mutation-property-order": "error",
      // No type assertions and no non-null assertions in production code: both
      // erode the guarantees tsc gives us. Use type annotations, `satisfies`,
      // narrowing, or `?.`/`??` instead. Disabled in tests (see overrides).
      "typescript/no-non-null-assertion": "error",
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
    overrides: [
      {
        // Tests lean on assertions for mocks/fixtures where the type is known
        // by construction; the assertion bans apply to production code only.
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/tests/**"],
        rules: {
          "typescript/no-non-null-assertion": "off",
          "typescript/consistent-type-assertions": "off",
        },
      },
    ],
    // Oxlint's type-aware checker (tsgolint) does not resolve our path aliases
    // (`@/*`) or workspace subpath exports the way tsc does, producing false
    // positives. `tsc --noEmit` per package stays the source of truth for types.
    options: { typeAware: false, typeCheck: false },
  },
});
