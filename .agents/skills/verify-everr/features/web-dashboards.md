# Web dashboards and runbooks (as code)

Dashboards and runbooks are resources an organization applies as code (`everr apply`, which POSTs to `/api/apply` with a key that has `Manage as code`). A dashboard has a time range, variables (here a static list), and panels laid out on a grid that queries ClickHouse through the app; panel headers link to a full-screen panel page (PR #528 and later) that carries the current variables and range. Runbooks are markdown pages that can embed a dashboard-style panel. Built-in dashboards (`/dashboards/built-in/<slug>`) ship with the app. Unknown dashboards and panels show `Dashboard not found`.

## Sub-features

- `dash-apply` `/api/apply` with a Manage-as-code key creates `verify/traffic` and `verify/verify-runbook` (dry run first: same diff, nothing written).
- `dash-grid` `/dashboards/verify/traffic` shows the `Service` variable (`verify-seed-api`) and both panels with the seeded counts (`Seeded logs` 3, `Seeded spans` 3).
- `dash-grid-links` the grid has one `Open the panel full screen` link per panel (2), after scrolling the pane (lazy grid).
- `dash-panel-page` `/dashboards/verify/traffic/panel/<key>` shows one panel with the dashboard's variables.
- `dash-panel-vars` a non-default variable on the grid (`?vars={"svc":"no-such-service"}`) is carried by the panel link to the panel page and survives a reload (`No numeric data`).
- `dash-runbook-embed` `/runbooks/verify/verify-runbook` renders the markdown and the embedded panel (`Seeded logs` 3) with no full-screen link (0 panel links).
- `dash-builtins` a built-in grid lists more panel links after scrolling than before, and a built-in panel page renders (`/dashboards/built-in/http-endpoints/panel/requests`).
- `dash-404` unknown own dashboard, unknown panel, unknown built-in show `Dashboard not found` with `Back to dashboards`.

## How to get to it (user POV)

- `everr apply` from a repo with `everr.yaml`, then sidebar `MONITOR` > `Dashboards` / `Runbooks`.
- Panel header > `Open the panel full screen` (PR #528 and later).

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK`, `eval "$($V web-browser-env)"`, signed in (`web-auth.md` Sign up) and `$V web-onboard` ran (clean screenshots).
- `web-api-keys.md` "Create, list, reload" ran with `VERIFY_KEY_MANAGE=1` (key saved as `secret` with `apply` permissions), and `$V web-seed` ran (the panels count the seeded rows).
- Panel pages and grid links only exist from PR #528 on (`ls packages/app/src/routes/**/dashboards/*panel*`); on older checkouts skip `dash-grid-links`, `dash-panel-page`, `dash-panel-vars`, the built-in panel page and the panel 404s, and report them as not applicable.

- **Apply.** Run:

  ```bash
  B=.agents/skills/verify-everr/scripts/apply-examples/dashboard-runbook.json
  $V web-apply "$B" --dry-run && $V web-apply "$B"
  ```

  Both exit `0` with `-> 200`, `Dashboard: created [verify/traffic]` and `Runbook: created [verify/verify-runbook]`; the dry run writes nothing (the real apply still reports `created`) (`dash-apply`). A `403`/`read-only` answer means the key lacks `Manage as code`.
- **Grid, links, panel page, variables, runbook, built-ins, 404s.** Run:

  ```bash
  LINKS='[...document.querySelectorAll("a[href*=\"/panel/\"]")].length'
  SCROLL='(async () => { const v = [...document.querySelectorAll("main [data-slot=scroll-area-viewport]")].sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0]; if (!v) return "no scroll area"; for (let y = 0; y < v.scrollHeight; y += Math.max(200, v.clientHeight / 2)) { v.scrollTop = y; await new Promise((r) => setTimeout(r, 500)); } v.scrollTop = v.scrollHeight; await new Promise((r) => setTimeout(r, 800)); return "scrolled " + v.scrollHeight; })()'
  VARS='vars=%7B%22svc%22%3A%22no-such-service%22%7D'
  agent-browser open "$WEB/dashboards/verify/traffic" && agent-browser wait --text "Seeded spans" && agent-browser wait --text "verify-seed-api" && ab_save dash-01-grid "Dashboard grid: Service verify-seed-api, Seeded logs 3, Seeded spans 3"
  agent-browser eval "$SCROLL" && test "$(agent-browser eval "$LINKS")" = 2
  agent-browser eval 'JSON.stringify([...document.querySelectorAll("a[href*=\"/panel/\"]")].map((a) => a.getAttribute("href")))' > "$SHOTS/dash-01-grid-links.txt"
  agent-browser open "$WEB/dashboards/verify/traffic/panel/seeded-logs" && agent-browser wait --text "Seeded logs" && agent-browser wait --text "verify-seed-api" && ab_save dash-02-panel-default "Panel page seeded-logs with the default variable"
  agent-browser open "$WEB/dashboards/verify/traffic?$VARS" && agent-browser wait --text "no-such-service" && ab_save dash-03-grid-var "Grid with Service = no-such-service"
  agent-browser find role link click --name "Open the panel full screen" && agent-browser wait --fn "location.pathname.endsWith('/panel/seeded-logs') && !document.body.innerText.includes('Seeded spans')" && agent-browser wait --text "No numeric data" && ab_save dash-04-panel-var "Panel page opened from the grid keeps Service = no-such-service (No numeric data)"
  grep -q "$VARS" "$SHOTS/dash-04-panel-var.url" && grep -q "no-such-service" "$SHOTS/dash-04-panel-var.txt" && ! grep -q "Seeded spans" "$SHOTS/dash-04-panel-var.txt"
  agent-browser reload && agent-browser wait --text "No numeric data" && ab_save dash-05-panel-var-reload "Same panel page after a reload"
  agent-browser open "$WEB/runbooks/verify/verify-runbook" && agent-browser wait --text "Embedded panel below." && agent-browser wait --text "Seeded logs" && ab_save runbook-01-embed "Runbook renders its markdown and the embedded Seeded logs panel (3)"
  test "$(agent-browser eval "$LINKS")" = 0
  agent-browser open "$WEB/dashboards/built-in/http-endpoints" && agent-browser wait --text "Requests" && BEFORE=$(agent-browser eval "$LINKS") && agent-browser eval "$SCROLL" && AFTER=$(agent-browser eval "$LINKS") && echo "built-in panel links: $BEFORE before scroll, $AFTER after" && test "$AFTER" -gt "$BEFORE" && ab_save builtin-01-http-endpoints "Built-in HTTP endpoints dashboard after scrolling the pane"
  agent-browser open "$WEB/dashboards/built-in/http-endpoints/panel/requests" && agent-browser wait --text "Requests" && ab_save builtin-02-panel-requests "Built-in panel page: Requests"
  for p in dashboards/verify/nope dashboards/verify/traffic/panel/nope dashboards/built-in/no-such-builtin/panel/requests; do agent-browser open "$WEB/$p" && agent-browser wait --text "Dashboard not found" && ab_save "notfound-$(echo "$p" | tr / -)" "/$p shows Dashboard not found" || break; done
  ```

  Every command exits `0` (the `test`/`grep` lines are the assertions): `dash-01-grid.txt` has `Seeded logs`, `Seeded spans`, `3` twice and `verify-seed-api`; `dash-01-grid-links.txt` lists `/dashboards/verify/traffic/panel/seeded-logs` and `.../seeded-spans`; `dash-04-panel-var.url` carries `vars=...no-such-service...`; the runbook has 0 panel links; the built-in count grows after scrolling (6 -> 16 observed for `http-endpoints`) (`dash-grid`, `dash-grid-links`, `dash-panel-page`, `dash-panel-vars`, `dash-runbook-embed`, `dash-builtins`, `dash-404`).
- **What a panel page loads.** Run `agent-browser open "$WEB/dashboards/verify/traffic/panel/seeded-logs" && agent-browser wait --text "verify-seed-api" && $V web-net panel-seeded-logs 10 --reload`. `net/panel-seeded-logs.serverfn.txt` lists the server functions of one page load with counts (each a handful, no function repeating without bound), and `new page errors` is the known hydration error only (SKILL.md Browser).
- **Stored resources.** Run `$V web-psql as-code-rows "select 'dashboard' as kind, project, slug, repoid from dashboards union all select 'runbook', project, slug, repoid from runbooks order by kind"`. Rows `dashboard | verify | traffic | verify-everr` and `runbook | verify | verify-runbook | verify-everr`.
- **Proof.** `http/apply-dashboard-runbook*/`, `web/dash-*`, `web/runbook-*`, `web/builtin-*`, `web/notfound-*`, `db/as-code-rows/`, `net/panel-seeded-logs.*`, `report.md` (`$V web-report`).

## Gotchas

- The grid is lazy: panels below the fold are not in the DOM until the pane's scroll area scrolls them in. Count links only after the `SCROLL` snippet; the window itself does not scroll.
- The panel queries use `{from:String}`, `{to:String}`, `{step:UInt32}` and the variable as `$svc`; the panels count rows of the run's own tenant only (app_ro row policies), so seed first or the stat shows `No numeric data`.
- The default dashboard range is the dashboard's `timeRange` (`now-1h` in the example); the seed must be newer than that. Apply and drive within the hour after `web-seed`, or open with `&from=now-24h&to=now`.
- `find role link click --name "Open the panel full screen"` clicks the first panel's link (`seeded-logs`).
- The panel link is a client-side navigation: the URL changes before the panel page replaces the grid, and the grid's own `No numeric data` already matches. Wait until the other panel's title (`Seeded spans`) is gone before the screenshot; an early `ab_save` shows the grid under a panel-page URL (seen on 2026-10-20 when reviewing the screenshot, which is why images are checked by eye).
- `/api/apply` replaces the whole state for the `repoid`: a body without the runbook deletes a runbook applied earlier under the same `repoid`. Keep dashboards and runbooks in one body (the example does).
- Every page logs the site-wide hydration error; it is not a dashboards bug.
