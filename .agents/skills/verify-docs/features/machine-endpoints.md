# Markdown and machine-readable endpoints

Agents and tools read the site without a browser. The same URL answers HTML or Markdown according to the `Accept` header, docs pages have `.md` twins, and `llms.txt`, `sitemap.xml` and `robots.txt` describe the site. `/everr-app/<artifact>` redirects to a release bucket.

## Sub-features

- `md-negotiation` returns Markdown for `Accept: text/markdown`, HTML otherwise, and `Vary: Accept` on both.
- `md-406` refuses a client that accepts neither with `406` and lists what is available.
- `md-404` answers a missing page with a Markdown 404 for a Markdown-friendly client and an HTML 404 for a browser.
- `docs-md` serves `/docs.md` and `/docs/<page>.md` and answers 404 for a page that does not exist.
- `llms-txt` serves the agent index with links to the `.md` pages.
- `sitemap` lists pages with language alternates.
- `robots` serves `robots.txt`.
- `release-redirect` redirects an allowed artifact and refuses any other.

## How to get to it (user POV)

- A coding agent or `curl` requests a page URL with `Accept: text/markdown`, or appends `.md` to a docs URL.
- A crawler or agent fetches `/llms.txt`, `/sitemap.xml` or `/robots.txt`.
- An installer downloads `/everr-app/<artifact>`.

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`. These recipes need no browser. Run them in dev and again after `$V cleanup` and `$V launch --prod` when the change touches `server.ts`, `middleware/` or `vite.config.ts`: dev and build use different code for the `.md` URLs.

- **Markdown by negotiation.** Run `$V http neg-md /pricing --accept text/markdown --status 200 --contains "# Pricing that grows with you"`. The headers show `content-type: text/markdown; charset=utf-8` and `vary: Accept`.
- **HTML by default.** Run `$V http neg-html /pricing --accept "text/html" --status 200 --contains "<title>"`. The headers show `content-type: text/html; charset=utf-8` and `vary: Accept`.
- **Not acceptable.** Run `$V http neg-406 /pricing --accept application/json --status 406`. The body starts `406 Not Acceptable` and names `Available: text/html, text/markdown`.
- **Missing page, Markdown client.** Run `$V http nf-md /nope --accept text/markdown --status 404 --contains "# 404: Not found"`. The body links `llms.txt` and `sitemap.xml`.
- **Missing page, browser.** Run `$V http nf-html /nope --accept text/html --status 404`. The `content-type` is `text/html`.
- **Docs twins.** Run `$V http docs-md-root /docs.md --status 200 --contains "#"` and `$V http docs-md-page /docs/learn/install.md --status 200 --contains "# Installation"`. Both are `text/markdown`. Run `$V http docs-md-missing /docs/learn/nope.md --status 404`.
- **Other Markdown pages.** Run `$V http md-home / --accept text/markdown --status 200 --contains "# Everr"` (the `llms.txt` body), `$V http md-devlog /devlog --accept text/markdown --status 200 --contains "# Everr Devlog"`, `$V http md-about /about --accept text/markdown --status 200 --contains "# About"`.
- **llms.txt.** Run `$V http llms /llms.txt --status 200 --contains "/docs/learn/install.md" --contains "/docs.md"`. It is `text/plain` and links every docs page with a `.md` URL.
- **Sitemap.** Run `$V http sitemap /sitemap.xml --status 200 --contains "<xhtml:link rel=\"alternate\" hreflang=\"it\"" --contains "/docs/learn/install"`. The `content-type` is `application/xml`.
- **Robots.** Run `$V http robots /robots.txt --status 200 --contains "Sitemap: https://everr.dev/sitemap.xml"`.
- **Release redirect.** Run `$V http release-ok /everr-app/SHA256SUMS --status 307`. The `location` header is `<release bucket>/everr-app/SHA256SUMS`. Run `$V http release-no /everr-app/nope --status 404`. Never follow the redirect: the helper does not.
- **HEAD.** Run `$V http head-md /pricing --head --accept text/markdown --status 200`. The headers match the GET and the body is empty.

## Gotchas

- The helper sends `Accept: */*` unless told otherwise, and `*/*` gets HTML for a page that exists but Markdown for a page that does not. Always pass `--accept` when the representation is the claim.
- `sitemap.xml`, `llms.txt` and the 404 body use the production origin `https://everr.dev` in absolute URLs, not the run's origin. Do not assert the run's port in them.
- `content-length` counts bytes and the helper's body count counts characters, so they differ for pages with `€` or other non-ASCII text.
- `/it/prezzi` and `/it/...` follow the same negotiation as their English twins, in Italian; the docs, the devlog and `/` are English only.
- `/_serverFn/*` and `/api/*` skip negotiation entirely: they answer as written.
- The release redirect target is the bucket named in `cli-release-redirect.ts` (or `DESKTOP_RELEASE_PUBLIC_BASE_URL`); check the `location` header and stop.
