# Landing page

The home page introduces Everr: a headline, two animated product demos, an FAQ, an "ask your AI" prompt box and calls to action, under a header with navigation, docs search and a language switch. The same page exists in Italian at `/it`.

## Sub-features

- `landing-render` renders the headline, the section headings and the page title.
- `landing-nav` moves between home, pricing and docs from the header, and back through the logo.
- `landing-tour-anchor` jumps from the hero button to the tour section.
- `landing-faq` opens one answer at a time.
- `landing-ask-ai` edits the prompt and shows the copy button states.
- `landing-language` switches the page to Italian and back.
- `landing-links` points sign-up and Discord at their external targets.
- `landing-network` shows that no analytics leave the machine.

## How to get to it (user POV)

- Open the site root (`/`).
- Choose the `everr` logo (link `Everr home`) from any page.
- Open `/it` or choose `Italiano` in the language menu on a translated page.

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`, and `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` ran in this shell.

- **Render.** Open the root. Run `agent-browser open $DOCS/`, `agent-browser wait --fn "$HYDRATED"`, then `agent-browser wait --text "Know before"`. Run `agent-browser eval 'JSON.stringify([document.title, document.querySelector("h1").innerText, [...document.querySelectorAll("h2")].map(h => h.textContent)])'`. The title is `Everr - Observability made simple`, the `h1` reads `Know before` then `your customers do`, and the `h2` list holds `An app can be up and still let people down`, `You shouldn’t need an expert to know your own app`, `For the engineers in the room`, `Let your AI kick the tires`, `Questions worth answering`, `Stop finding out from your customers` and `Help shape Everr. Join us on Discord.`. Then `ab_save landing-01-home "Home page: headline, header and hero buttons"`.
- **Header navigation.** Choose `Pricing`. Run `agent-browser click "nav[aria-label='Main'] a[href='/pricing']"` then `agent-browser wait --fn "location.pathname === '/pricing'"`. The tab title is `Pricing - Everr`. Choose the logo: `agent-browser click "nav[aria-label='Main'] a[aria-label='Everr home']"` then `agent-browser wait --fn "location.pathname === '/'"`. Choose `Docs`: `agent-browser click "nav[aria-label='Main'] a[href='/docs']"` then `agent-browser wait --fn "location.pathname === '/docs'"`; the page `h1` is `What Everr is`.
- **Tour anchor.** The previous step ends on `/docs`, so go back to the home page: `agent-browser open $DOCS/` then `agent-browser wait --fn "$HYDRATED"`. Choose `See it in action`. Run `agent-browser find role button click --name "See it in action"`. Run `agent-browser eval 'JSON.stringify([location.hash, Math.round(document.querySelector("#tour").getBoundingClientRect().top)])'`: the hash is `#tour` and the tour section sits at the top of the viewport (56, the header height, measured at 1280x800).
- **FAQ.** Choose `How does setup work?`. Run `agent-browser find role button click --name "How does setup work?"`. Read `agent-browser eval 'JSON.stringify([...document.querySelectorAll("li button[aria-expanded]")].map(b => [b.textContent.slice(0, 24), b.getAttribute("aria-expanded")]))'`: only that row is `"true"`. Choose `Where does my data live?` the same way and read again: now only that row is `"true"` and the first is `"false"`. `ab_save landing-02-faq "FAQ: one answer open"`.
- **Ask your AI.** Run `agent-browser eval 'document.querySelector("textarea[aria-label=\"Prompt for your AI\"]").value'`: it starts with `Look into Everr at https://everr.dev`. Run `agent-browser find role button click --name "Copy prompt"`, then `agent-browser eval 'document.querySelector("[role=status]").textContent'`: `Copied. Paste into your AI to start the conversation.`. Empty the box: `agent-browser fill "textarea[aria-label='Prompt for your AI']" "x"`, `agent-browser press Backspace`, then `agent-browser eval 'document.querySelector("button[aria-label=\"Copy prompt\"]").disabled'` prints `true`.
- **Italian.** Open the language menu from the header: `agent-browser click "header#nd-nav button[aria-label^='Language']"`, then `agent-browser find role menuitem click --name "Italiano"` and `agent-browser wait --fn "location.pathname === '/it'"`. Run `agent-browser eval 'JSON.stringify([document.documentElement.lang, document.querySelector("h1").innerText])'`: `it` and an Italian headline. `ab_save landing-03-italian "Home in Italian at /it"`. Then switch back with the same menu (on the Italian page its label starts with `Lingua`): `agent-browser click "header#nd-nav button[aria-label^='Lingua']"`, `agent-browser find role menuitem click --name "English"` and `agent-browser wait --fn "location.pathname === '/'"`.
- **External links.** Run `agent-browser eval 'JSON.stringify([...document.querySelectorAll("a")].filter(a => /Get started|Join us on Discord/.test(a.textContent)).map(a => [a.textContent.trim(), a.getAttribute("href")]))'`. The `Get started` links point at `https://app.everr.dev/auth/sign-up` and `Join us on Discord` at `https://discord.gg/hd6yYDjAuw`. Do not follow them.
- **No analytics leave.** Leave the home page idle for 10s, then run `$V net landing-network`. It prints `NET ... unexpected=0` with `dead-sink` requests (PostHog `config`, `flags`; OTLP `/v1/logs`, `/v1/traces`) and the one `github-stars` call, and exits 0.

## Gotchas

- The headline is two block spans: `wait --text "Know before your customers do"` times out; wait for `Know before`.
- `Pricing`, `Docs` and `Everr home` also exist in the footer. `find role link click --name` can take the wrong one or report `Done` without navigating; use the scoped selectors above.
- `Get started` is a link styled as a button: the snapshot lists it as `button`, and its target is the `href` of the anchor.
- `fill` with an empty string does not update the prompt box state; use `fill "x"` then `Backspace`.
- The header condenses into a floating island after about 96px of scroll, so a screenshot taken after the tour anchor shows the island, not the tall header.
- The language menu exists only on translated pages (`/`, `/pricing`, `/about`, `/contact` and their Italian twins). On `/docs` there is none.
- The first `agent-browser click` after a client-side navigation can run before hydration finishes and do nothing. If a `wait --fn` times out, repeat `agent-browser open` for the page and retry once.
- The star count next to the GitHub icon comes from `api.github.com`, so it changes and can be absent when GitHub rate-limits the machine.
