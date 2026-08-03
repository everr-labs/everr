# Nineteen docs URLs moved with no redirect layer, so every one 404s

From the PR #225 review; see [pr-225-review-findings.md](./pr-225-review-findings.md),
finding 18.

## What
The docs restructure moved pages into `guides/` and `reference/` and deleted a
few. The restructure itself is clean: `meta.json` files are consistent, there are
no orphans and no stale descriptions. What is missing is any redirect from the old
URLs, so every previously published link is now a hard 404.

## Where
- `packages/docs/src/routes/docs/$.tsx:34`: `if (!page) throw notFound();`
  with no fallback lookup.
- No redirect layer exists anywhere in `packages/docs`: no `vercel.json`, no
  `_redirects`, no `nitro.config.*`. `vite.config.ts:39-60` rewrites only
  `/docs/*.md`, which is the raw-markdown route, not page URLs.

## The dead URLs

```
/docs/alerts
/docs/alerts/alert-spec
/docs/alerts/notifications
/docs/alerts/writing-queries
/docs/dashboards
/docs/dashboards/organizing-and-sources
/docs/dashboards/panels-and-visualizations
/docs/dashboards/visualizations
/docs/dashboards/dashboard-spec
/docs/dashboards/variables
/docs/ci-insights/setup-new-repo
/docs/ci-insights/debug-ci
/docs/ci-insights/cost-analysis
/docs/ci-insights/resource-monitoring
/docs/ci-insights/how-ci-cost-is-estimated
/docs/test-telemetry/vitest
/docs/test-telemetry/go-tests
/docs/test-telemetry/rust-tests
/docs/reference/production-telemetry
```

`/docs/reference/production-telemetry` is the worst of them: it was a stable
`reference/` URL that the app itself linked to, and it moved to `guides/`.

`/docs/dashboards/panels-and-visualizations` is the awkward one: it was deleted
outright and folded into `reference/visualizations.mdx`, so it needs a redirect to
a page that is a superset rather than a rename.

## Broken inside the repo too
- `CHANGELOG.md:30` links `/docs/alerts`.
- `CHANGELOG.md:41` links `/docs/dashboards`.

These are fixable by editing the links, independently of the redirect layer.

## Failure scenario
Anyone with a bookmark, anyone following a link from an external blog post or a
Slack thread, and any search-engine result pointing at the old structure, all land
on a 404 page rather than the content, which still exists under a new path. There
is no signal to the reader that the page moved rather than being removed.

## Why it is filed rather than fixed
Choosing where redirects live is a deployment question, not a code one. The docs
site has no redirect mechanism today, so this means picking one:

- Host-level (`vercel.json` or equivalent) if the site is deployed somewhere that
  supports it. Cheapest, and 301s are the semantically correct answer for a moved
  page.
- Application-level, in the `$.tsx` catch-all: on a miss, consult a redirect map
  before throwing `notFound()`. Portable across hosts and testable, but serves a
  client-side redirect rather than a real 301, which is worse for search.

That depends on how the docs site is actually deployed, which I did not want to
assume.

## Sketch
- Pick the mechanism, then encode the nineteen mappings as data in one file rather
  than scattered rules, so the list is reviewable and testable.
- Add a test that every entry in the redirect map resolves to a page that exists,
  which is the same class of check `docs-content.test.ts` now does for `meta.json`
  listings and would catch a redirect target being renamed later.
- Fix the two `CHANGELOG.md` links regardless; they need no infrastructure.
- Going forward, a moved page should add its redirect in the same commit as the
  move. A test asserting no tracked `.mdx` path disappears without a corresponding
  redirect entry would enforce that.

## Related
`packages/docs/src/lib/docs-content.test.ts` now checks that every `meta.json`
listing matches the files beside it, which catches dangling sidebar entries and
unreachable pages. It does not and cannot catch external links, which is what this
issue is about.
