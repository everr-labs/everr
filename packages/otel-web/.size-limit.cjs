// One budget per public composition, each using size-limit's `import` option
// so only the named exports get pulled into the measured bundle: this checks
// that tree shaking actually works, rather than assuming it does from one
// whole-file number. A regression on any single line fails CI on that line,
// not just on an aggregate total.
//
// Limits carry a small headroom (roughly 5%) over the measured size at the
// time they were set; a real regression still trips them.
module.exports = [
  {
    name: "core (init only, no plugins)",
    path: "dist/index.js",
    import: "{ init }",
    gzip: true,
    limit: "3 KB",
  },
  {
    name: "core + errors",
    path: "dist/index.js",
    import: "{ init, errors }",
    gzip: true,
    limit: "4 KB",
  },
  {
    name: "core + pageviews",
    path: "dist/index.js",
    import: "{ init, pageviews }",
    gzip: true,
    limit: "3.5 KB",
  },
  {
    name: "core + interactions",
    path: "dist/index.js",
    import: "{ init, interactions }",
    gzip: true,
    limit: "4 KB",
  },
  {
    // The web-vitals dependency lands only here: this line carries its
    // weight, not the "core + all plugins" line below.
    name: "core + performance",
    path: "dist/index.js",
    import: "{ init, performance }",
    gzip: true,
    limit: "8 KB",
  },
  {
    name: "core + network",
    path: "dist/index.js",
    import: "{ init, network }",
    gzip: true,
    limit: "4 KB",
  },
  {
    // All six plugin factories composed: verifies the sampled runtime is
    // shared rather than duplicated per composition, so this comes in below
    // the sum of the individual increments above, not above it.
    name: "core + all plugins",
    path: "dist/index.js",
    import:
      "{ init, errors, pageviews, interactions, performance, network, sampled }",
    gzip: true,
    limit: "10 KB",
  },
];
