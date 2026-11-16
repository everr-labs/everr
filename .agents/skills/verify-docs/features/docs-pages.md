# Docs pages

The documentation website renders each MDX file under `content/docs` as a page with a sidebar of four groups (Getting started, Concepts, Guides, Reference), an on-page table of contents, code blocks with a copy button, heading anchors and previous and next cards. The devlog and the About and Contact pages are rendered from MDX too. A missing docs page shows a 404 page.

## Sub-features

- `docs-home` renders `/docs` with the sidebar and the table of contents.
- `docs-sidebar` navigates to a page from the sidebar and marks it current.
- `docs-page` renders an MDX page: title tab, `h1`, headings, code block, table of contents.
- `docs-toc` jumps to a heading from the table of contents.
- `docs-next` moves to the next page from the card at the bottom.
- `docs-404` answers a missing docs page with a 404.
- `content-devlog` lists devlog posts and opens one.
- `content-site-pages` renders About and Contact.

## How to get to it (user POV)

- Choose `Docs` in the header, or open `/docs`.
- Choose a page in the sidebar, a result in docs search, or a link inside another page.
- Choose `Devlog` in the header, or open `/about` and `/contact`.

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`; `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` ran in this shell.

- **Docs home.** Run `agent-browser open $DOCS/docs`, `agent-browser wait --fn "$HYDRATED"`, then `agent-browser wait --text "What Everr is"`. Run `agent-browser eval 'JSON.stringify([document.title, document.querySelector("h1").innerText, [...document.querySelectorAll("#nd-sidebar button, aside button")].map(b => b.textContent.trim()).filter(t => /^(Getting started|Concepts|Guides|Reference)$/.test(t))])'`. The title is `Everr Docs`, the `h1` is `What Everr is`, and the four groups are listed.
- **Sidebar navigation.** Choose `Installation`. Run `agent-browser find role link click --name "Installation"` then `agent-browser wait --fn "location.pathname === '/docs/learn/install'"`. Run `agent-browser eval 'JSON.stringify([document.title, document.querySelector("h1").innerText, document.querySelector("a[href=\"/docs/learn/install\"]").getAttribute("aria-current")])'`: `Installation - Everr Docs`, `Installation` and `page`. `ab_save docs-01-install "Installation page with sidebar, headings and table of contents"`.
- **Page content.** Run `agent-browser eval 'JSON.stringify([[...document.querySelectorAll("article h2, main h2")].map(h => h.id), document.querySelectorAll("button[aria-label=\"Copy Text\"]").length > 0])'`. The heading ids include `install-the-cli`, `connect-your-coding-agent` and `connect-to-an-installation`, and the page has a `Copy Text` button on its code blocks.
- **Table of contents.** Choose `Connect to an installation` under `On this page`. Run `agent-browser click "a[href='#connect-to-an-installation']"` then `agent-browser eval 'location.hash'`: `#connect-to-an-installation`.
- **Next page.** Choose the next card. The next card is a link named with the page title and its description. Run `agent-browser find role link click --name "Set up OpenTelemetry and verify"` then `agent-browser wait --fn "location.pathname === '/docs/learn/instrument-your-app'"`; the `h1` is `Instrument your app`.
- **Missing page.** Run `$V http docs-404 /docs/nope --accept text/html --status 404`. In the browser, `agent-browser open $DOCS/docs/nope`, then `agent-browser wait --fn "$HYDRATED"` and `agent-browser eval 'document.querySelector("h1").innerText'` print the not-found heading (`404:` then `Nothing to observe here.`), not a blank page; `ab_save docs-02-404 "Missing docs page shows the not-found page"`.
- **Devlog.** Run `agent-browser open $DOCS/devlog`, `agent-browser wait --fn "$HYDRATED"`, then `agent-browser wait --text "Building in the open"`. Open the first post: `agent-browser eval 'document.querySelector("main a[href^=\"/devlog/\"]").click()'` and `agent-browser wait --fn "location.pathname.startsWith('/devlog/')"`, then `agent-browser wait --text "Devlog #"`. The `h1` carries the post title from the MDX front matter (for example `Devlog #4: Alerts, notebooks, and dashboards as code`).
- **Site pages.** Run `$V http about /about --status 200 --contains "<h1"` and `$V http contact /contact --status 200`, then `agent-browser open $DOCS/about`, `agent-browser wait --fn "$HYDRATED"` and `agent-browser wait --text "Open source"`; the `h1` is the front matter title of `content/pages/about.mdx`.
- **No analytics leave.** After the browser steps, wait 10s and run `$V net docs-network`: `unexpected=0`.

## Gotchas

- On a nested docs page several links carry `aria-current="page"` (the header `Docs` link, the sidebar link `What Everr is` at `/docs`, and the page's own link). Select the sidebar link by `href`.
- `find role link click --name "Installation"` matches by substring and the page can hold several matching links (sidebar, related links, the next card). Name the card by its description, or use `click "a[href='...']"` on a link you know is unique.
- Read the `h1` only after the route has rendered: right after `wait --fn` on the pathname the `h1` can still be the previous page's. `wait --text` for the new title first.
- Pages come from MDX that the dev server regenerates (`.source/`, `[MDX] generated files` in `docs.log`); after editing content wait for the next request to show it, and reload the browser page.
- `/docs/<page>` for a path that is a folder (`/docs/learn`) is not a page; `/docs/learn` answers 404 (measured); use a page listed in `content/docs/<section>/meta.json`.
- With `Accept: */*` (the helper's default) a missing page answers a Markdown 404. Pass `--accept text/html` to see what a browser gets.
- The sidebar groups start expanded (`defaultOpen` in each `meta.json`), and the pages follow the `pages` array there. A new page that is missing from that array may not appear in the sidebar (fumadocs behavior, not tested here); confirm it in the sidebar after adding one.
