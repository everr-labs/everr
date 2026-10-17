/** Physical product routes for tests that keep topology but replace page bodies. */
export const productRouteFiles = Object.keys(
  import.meta.glob("../routes/**/*.{ts,tsx}"),
).map((path) => new URL(path, import.meta.url).pathname);
