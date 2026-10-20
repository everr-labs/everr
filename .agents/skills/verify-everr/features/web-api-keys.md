# Web API keys

An organization admin creates organization-scoped `ek_` keys on `/api-keys`, choosing a name, an expiration and capabilities (`Send telemetry`, `Manage as code`). The full key is shown once, then the list shows the name and a truncated prefix. Public (browser) keys are a separate section on the same page.

## Sub-features

- `keys-empty` a new organization shows `No organization keys yet` and `No public keys yet`.
- `keys-capability-required` `Create key` stays disabled until at least one capability switch is on.
- `keys-create` creating a key shows `Copy your key now` with the full `ek_...` value exactly once.
- `keys-list` after `Done` the table lists the key name with a truncated `ek_...` prefix.
- `keys-persist` the key is still listed after a reload, and Postgres `apikey` has the row with the chosen permissions.
- `keys-public` `New public key` with a name and allowed origins shows `Copy your key now`; the list shows the key with its origin, and Postgres stores `metadata` `{"public":true,"allowedOrigins":[...]}` with `ingest` write only.

## How to get to it (user POV)

- Sidebar admin area, or open `/api-keys` directly. Choose `New key`.
- The Home onboarding links here when it needs a key.

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK`, `eval "$($V web-browser-env)"` in the driving shell, and this run's browser is signed in (`web-auth.md` Sign up, or Fresh sign-in, ran in this web run).
- The user is the organization owner (true for the sign-up user).
- `VERIFY_KEY_NAME` exported and unique.

- **Create, list, reload.** Run:

  ```bash
  agent-browser open "$WEB/api-keys" && agent-browser wait --text "No organization keys yet" && ab_save api-keys-01-empty
  agent-browser find role button click --name "New key" && agent-browser wait --text "Send telemetry"
  agent-browser fill "#api-key-name" "$VERIFY_KEY_NAME" && agent-browser find role switch click --name "Send telemetry" && ab_save api-keys-02-form
  agent-browser find role button click --name "Create key" && agent-browser wait --text "Copy your key now" && ab_save api-keys-03-issued
  agent-browser get text body | $V web-key-save secret
  agent-browser find role button click --name "Done" && agent-browser wait --text "$VERIFY_KEY_NAME" && ab_save api-keys-04-listed
  agent-browser reload && agent-browser wait --text "$VERIFY_KEY_NAME" && ab_save api-keys-05-after-reload
  ```

  Every command exits `0`: `api-keys-01-empty.txt` has `No organization keys yet`; `api-keys-02-form.png` shows the name filled and `Send telemetry` on; `api-keys-03-issued.txt` has `Copy your key now` and an `ek_` value; `web-key-save` prints `saved key 'secret' (ek_...)`; `api-keys-04-listed.txt` and `api-keys-05-after-reload.txt` contain `$VERIFY_KEY_NAME` and not `No organization keys yet` (`keys-empty`, `keys-create`, `keys-list`, `keys-persist`).
- **Stored row.** Run `$V web-psql api-key-row "select k.name, k.prefix, k.enabled, k.permissions, o.name as org from apikey k join organization o on o.id = k.reference_id where k.name = '$VERIFY_KEY_NAME'"`. One row: prefix `ek_`, enabled `t`, permissions `{"ingest":["write"]}`, org `Verify's projects`.
- **Capability required.** Run:

  ```bash
  agent-browser find role button click --name "New key" && agent-browser wait --text "Send telemetry"
  agent-browser fill "#api-key-name" "$VERIFY_KEY_NAME-nocap" && ab_save keys-capability-required
  agent-browser eval '[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create key").disabled'
  agent-browser press Escape
  ```

  The `eval` prints `true` (`Create key` stays disabled with both switches off), and `keys-capability-required.png` shows the dialog with the name filled and both switches off (`keys-capability-required`).
- **Public key.** Needs `SDK_PAGE_ORIGIN` from `web-browser-env` (the origin `web-sdk-page` serves on). Run:

  ```bash
  agent-browser open "$WEB/api-keys" && agent-browser wait --text "New public key"
  agent-browser eval '[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New public key").focus()' && agent-browser press Enter && agent-browser wait --text "Allowed origins"
  agent-browser find label "Name" fill "$VERIFY_KEY_NAME-public" && agent-browser find label "Allowed origins" fill "$SDK_PAGE_ORIGIN" && ab_save api-keys-06-public-form
  agent-browser find role button click --name "Create public key" && agent-browser wait --text "Copy your key now" && ab_save api-keys-07-public-issued
  agent-browser get text body | $V web-key-save public
  agent-browser find role button click --name "Done" && agent-browser wait --text "$VERIFY_KEY_NAME-public" && agent-browser wait --text "${SDK_PAGE_ORIGIN#http://}" && ab_save api-keys-08-public-listed
  $V web-psql public-key-row "select k.name, k.prefix, k.enabled, k.permissions, k.metadata from apikey k where k.name = '$VERIFY_KEY_NAME-public'"
  ```

  Every command exits `0`; `web-key-save` prints `saved key 'public'`; `api-keys-08-public-listed.txt` lists the key under `Public keys` with `127.0.0.1:<sdk port>`; the row has permissions `{"ingest":["write"]}` and metadata `{"public":true,"allowedOrigins":["http://127.0.0.1:<sdk port>"]}` (`keys-public`).
- **Proof.** `web/api-keys-*`, `web/keys-capability-required.*`, `db/api-key-row/`, `db/public-key-row/`.

## Gotchas

- Both capability switches start off in this build; `Create key` is disabled until one is on. If the switch click did not land, `find role button click --name "Create key"` fails on a disabled button; check `api-keys-02-form.png`.
- `api-keys-03-issued.*` contains the real key. It only works against this run's database, which `web-cleanup` deletes, but do not paste it anywhere.
- Using the key for OTLP ingest is `web-seed` in `web-explore.md` (it reads the key saved as `secret`); the public key is used by `web-sdk-page` (`web-browser-sdk.md`, saved as `public`). `everr apply` with the key is not covered.
- The consent banner covers `New public key`, so `find role button click` refuses with `is covered by`. Focus it and press Enter (the recipe). In the dialog, Enter in `Allowed origins` adds a new line instead of submitting, so submit with `find role button click --name "Create public key"` (the dialog sits above the banner).
- Allowed origins are exact `scheme://host:port`. The SDK page is served on `127.0.0.1`, not `localhost`; a `localhost` origin fails the CORS preflight.
- Labels in the table come from the key name; use a unique `VERIFY_KEY_NAME` so an earlier key can't satisfy the check.
