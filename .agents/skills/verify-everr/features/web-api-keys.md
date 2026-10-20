# Web API keys

An organization admin creates organization-scoped `ek_` keys on `/api-keys`, choosing a name, an expiration and capabilities (`Send telemetry`, `Manage as code`). The full key is shown once, then the list shows the name and a truncated prefix. Public (browser) keys are a separate section on the same page.

## Sub-features

- `keys-empty` a new organization shows `No organization keys yet` and `No public keys yet`.
- `keys-capability-required` `Create key` stays disabled until at least one capability switch is on.
- `keys-create` creating a key shows `Copy your key now` with the full `ek_...` value exactly once.
- `keys-list` after `Done` the table lists the key name with a truncated `ek_...` prefix.
- `keys-persist` the key is still listed after a reload, and Postgres `apikey` has the row with the chosen permissions.
- `keys-public` `New public key` with allowed origins (not scripted yet).

## How to get to it (user POV)

- Sidebar admin area, or open `/api-keys` directly. Choose `New key`.
- The Home onboarding links here when it needs a key.

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK`, and a signed-in session in this run's profile: `sign-up.json` (or `sign-in.json`) ran in this web run.
- The user is the organization owner (true for the sign-up user).
- `VERIFY_KEY_NAME` exported and unique.

- **Create, list, reload.** Run `$V web-steps api-keys api-keys.json`. All 17 steps `ok`: `01-empty.txt` has `No organization keys yet`; `02-form.png` shows the name filled and `Send telemetry` on; `03-issued.txt` has `Copy your key now` and an `ek_` value; `04-listed.txt` and `05-after-reload.txt` contain `$VERIFY_KEY_NAME` and not `No organization keys yet` (`keys-empty`, `keys-create`, `keys-list`, `keys-persist`).
- **Stored row.** Run `$V web-psql api-key-row "select k.name, k.prefix, k.enabled, k.permissions, o.name as org from apikey k join organization o on o.id = k.reference_id where k.name = '$VERIFY_KEY_NAME'"`. One row: prefix `ek_`, enabled `t`, permissions `{"ingest":["write"]}`, org `Verify's projects`.
- **Capability required.** Run `$V web-steps keys-capability-required api-keys-capability-required.json`. This journey is expected to exit 1 at step `#4` (`Create key` never becomes enabled within 3s), and `failure.png` shows the dialog with both capability switches off (`keys-capability-required`). Any other failing step, or exit 0, is a failed proof.
- **Proof.** `web/api-keys/`, `web/keys-capability-required/`, `db/api-key-row/`.

## Gotchas

- Both capability switches start off in this build; `Create key` is disabled until one is on. The click helper waits for an enabled button, so a missing switch shows up as a 20s timeout on the `Create key` step.
- `03-issued.*` contains the real key. It only works against this run's database, which `web-cleanup` deletes, but do not paste it anywhere.
- Using the key (OTLP ingest on 4318 or `everr apply`) needs the collector service, which is blocked (SKILL.md boundary). Prove creation and storage only.
- Labels in the table come from the key name; use a unique `VERIFY_KEY_NAME` so an earlier key can't satisfy the check.
