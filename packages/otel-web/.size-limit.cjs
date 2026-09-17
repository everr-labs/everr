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
    name: "core (WebSDK only, no instrumentations)",
    path: "dist/index.js",
    import: "{ WebSDK }",
    gzip: true,
    // Includes the shared tracer binding and span-kind support.
    limit: "3.6 KB",
  },
  {
    name: "core + public tracer",
    path: "dist/index.js",
    import: "{ WebSDK, tracer }",
    gzip: true,
    limit: "3.8 KB",
  },
  {
    // Raised for the parent span support in the tracer.
    name: "core + errors",
    path: "dist/index.js",
    import: "{ WebSDK, errors }",
    gzip: true,
    limit: "4.2 KB",
  },
  {
    // Raised for the exit-flush budget code (refer to pipeline/emitter.ts)
    // and for the parent span support in the tracer.
    name: "core + pageviews",
    path: "dist/index.js",
    import: "{ WebSDK, pageviews }",
    gzip: true,
    limit: "3.8 KB",
  },
  {
    // Raised for the naming attributes in the element selector.
    name: "core + interactions",
    path: "dist/index.js",
    import: "{ WebSDK, interactions }",
    gzip: true,
    limit: "4.3 KB",
  },
  {
    // The heaviest instrumentation: the in-house web vitals (LCP/CLS/TTFB/INP)
    // and slow-interaction records with their LoAF attribution. The pageLoad
    // capture is its own instrumentation with its own line below.
    name: "core + performance",
    path: "dist/index.js",
    import: "{ WebSDK, performance }",
    gzip: true,
    limit: "7.35 KB",
  },
  {
    // The load window: the PageLoad root that ends at LCP, the asset
    // waterfall, and the long-animation-frame spans. Raised for the root span
    // and its LCP observer.
    name: "core + pageLoad",
    path: "dist/index.js",
    import: "{ WebSDK, pageLoad }",
    gzip: true,
    limit: "4.7 KB",
  },
  {
    name: "core + network",
    path: "dist/index.js",
    import: "{ WebSDK, network }",
    gzip: true,
    // Includes XHR lifecycle tracking alongside fetch.
    limit: "4.9 KB",
  },
  {
    // All instrumentation factories composed: verifies the sampled runtime is
    // shared rather than duplicated per composition, so this comes in below
    // the sum of the individual increments above, not above it.
    name: "core + all instrumentations",
    path: "dist/index.js",
    import:
      "{ WebSDK, errors, pageviews, interactions, performance, pageLoad, network, sampled }",
    gzip: true,
    // Includes XHR lifecycle tracking alongside fetch.
    limit: "11 KB",
  },
];
