# Pricing

The pricing page shows three plan cards (Hobby, Pro, Enterprise), a self-hosting banner, a pricing FAQ and a closing call to action. There is no calculator: the plans are static text. The page also exists in Italian (`/it/prezzi`) and as Markdown.

## Sub-features

- `pricing-render` renders the heading, the three plans and their prices.
- `pricing-links` points each plan's button at sign-up or the booking calendar.
- `pricing-faq` opens a question and follows the retention link into the docs.
- `pricing-italian` shows the page in Italian through the language menu and the `/it/prezzi` URL.
- `pricing-markdown` serves the same plans as Markdown to a client that asks for it.

## How to get to it (user POV)

- Choose `Pricing` in the header, or open `/pricing`.
- Open `/it/prezzi`, or choose `Italiano` in the language menu on `/pricing`.
- Request `/pricing` with `Accept: text/markdown`.

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`; `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` ran in this shell.

- **Render.** Run `agent-browser open $DOCS/pricing`, `agent-browser wait --fn "$HYDRATED"`, then `agent-browser wait --text "Hobby"`. Run `agent-browser eval 'JSON.stringify([document.title, document.querySelector("h1").innerText, [...document.querySelectorAll("article")].map(a => [a.querySelector("h2").innerText, a.innerText.includes("€0") || a.innerText.includes("€39")])])'`. The title is `Pricing - Everr`, the `h1` is `Pricing that grows with you`, and the plans are `Hobby`, `Pro`, `Enterprise` (the first two show a price). `ab_save pricing-01-plans "Pricing page: Hobby, Pro and Enterprise cards"`.
- **Plan links.** Run `agent-browser eval 'JSON.stringify([...document.querySelectorAll("article")].map(a => [a.querySelector("h2").innerText, a.querySelector("a").getAttribute("href")]))'`. Hobby and Pro point at `https://app.everr.dev/auth/sign-up`, Enterprise at the booking calendar (`https://calendar.app.google/...`). Do not follow them.
- **FAQ.** Choose `What counts toward ingestion?`. Run `agent-browser find role button click --name "What counts toward ingestion?"`, then `agent-browser eval 'document.querySelector("button[aria-expanded=true]").textContent'` prints the question. Choose `How does retention work?`, then the link `retention` inside its answer: `agent-browser eval 'document.querySelector("li:has(button[aria-expanded=true]) a[href=\"/docs/reference/retention\"]").click()'` and `agent-browser wait --fn "location.pathname === '/docs/reference/retention'"`. The page `h1` is `Data Retention`.
- **Italian from the menu.** Open `/pricing` again: `agent-browser open $DOCS/pricing` and `agent-browser wait --fn "$HYDRATED"` (a click before hydration reports success and opens nothing). Then `agent-browser click "header#nd-nav button[aria-label^='Language']"`, `agent-browser find role menuitem click --name "Italiano"`, `agent-browser wait --fn "location.pathname === '/it/prezzi'"`. Run `agent-browser eval 'JSON.stringify([document.documentElement.lang, document.querySelector("h1").innerText])'`: `it` and `Piani che crescono con te`. `ab_save pricing-02-italian "Pricing in Italian at /it/prezzi"`.
- **Markdown twin.** Run `$V http pricing-md /pricing --accept text/markdown --status 200 --contains "# Pricing that grows with you" --contains "## Hobby: €0/month" --contains "## Pro: €39/month" --contains "## Enterprise: Custom"`. The response is `text/markdown; charset=utf-8` with `vary: Accept`.
- **Italian Markdown.** Run `$V http pricing-it-md /it/prezzi --accept text/markdown --status 200 --contains "# Piani che crescono con te"`.
- **No analytics leave.** After the browser steps, wait 10s and run `$V net pricing-network`: `unexpected=0`.

## Gotchas

- Plan prices live in `PRICING_PLANS` in `pricing-cards.tsx`, and the Markdown twin is built from the same list, so a price change moves both; keep the expected prices in these recipes in step.
- `Hobby` and `Pro` both have a button named `Get started`: assert on the plan card (`article`), not on the button name.
- The language menu appears twice (header and footer). Use the scoped selector; `find role button click --name "Language"` opened nothing in 0.34.0.
- The FAQ keeps one answer open at a time, so `button[aria-expanded=true]` is a single element.
- The Markdown twin is chosen by the `Accept` header: a plain `$V http pricing /pricing` (`Accept: */*`) returns HTML.
