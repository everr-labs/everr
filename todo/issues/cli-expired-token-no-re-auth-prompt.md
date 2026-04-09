## What
When the CLI auth token expires, commands fail with a generic HTTP 401 error instead of prompting the user to re-authenticate.

## Where
`crates/everr-core/src/api.rs` — `ApiClient::get()` / all HTTP methods  
`packages/desktop-app/src-cli/src/auth.rs` — `require_session_with_refresh`

## Steps to reproduce
1. Log in with `everr login`
2. Wait for the token to expire (or manually expire it server-side)
3. Run any CLI command (e.g. `everr status`)

## Expected
The CLI detects the 401, clears the stale session, and prompts: _"Session expired. Run `everr login` to re-authenticate."_ (or triggers the login flow automatically)

## Actual
Raw error: `CLI API request failed with 401: <server body>`  
No hint that the fix is `everr login`.

## Priority
medium

## Notes
`require_session_with_refresh` in `auth.rs` is misleadingly named — it does not refresh; it only validates the stored `api_base_url`. There is no expiry field in `Session`, so expiry is only detectable server-side via 401. The fix would be to detect 401 in `ApiClient` and surface a clear re-login message (or auto-trigger the device flow).
