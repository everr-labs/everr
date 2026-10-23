# Web sign-up, sign-in and session

A new user creates an account with name, email and password, lands on a short "Setting up your organization" screen while their personal organization is provisioned in ClickHouse, then reaches the home page ("Welcome to Everr" onboarding). They can log out, are sent to sign-in when opening a protected page, see an error for a wrong password, and return to the page they asked for after signing in.

## Sub-features

- `auth-sign-up` email/password sign-up creates the user and signs them in, no email verification required.
- `auth-org-setup` sign-up creates a personal organization (`<first name>'s projects`), provisions it (`metadata.clickhouseReady = true`), and shows `/organization-setup` for at least 2.5s before continuing.
- `auth-home` home `/` shows the sidebar with the user's name and the `Welcome to Everr` onboarding (Step 1 of 4).
- `auth-log-out` the user menu's `Log out` ends the session and lands on `/auth/sign-in`.
- `auth-guard` a protected route while signed out redirects to `/auth/sign-in?redirect=<route>`.
- `auth-wrong-password` a wrong password shows `Invalid email or password` and stays on sign-in.
- `auth-sign-in` correct credentials sign in and return to the `redirect` route.

## How to get to it (user POV)

- Open `/auth/sign-up` (or `Sign up` from the sign-in page), fill Name, Email, Password, submit.
- Open `/auth/sign-in`, fill Email, Password, submit. `Forgot password?` and `Sign in with Google` are other entry points (see Gotchas).
- Log out from the user menu at the bottom of the sidebar.

## Driving it with verify-everr

Preconditions:

- Default Cloud selected (`web-launch`, or `--app cloud`); `$V web-launch` printed `WEB READY` and `$V web-doctor` ends with `WEB DOCTOR OK`.
- `VERIFY_NAME`, `VERIFY_EMAIL` (unique per run), `VERIFY_PASSWORD` exported (see SKILL.md Drive).

- The run's browser: `eval "$($V web-browser-env)"` in the driving shell (SKILL.md Browser). Evidence lands in `$SHOTS`.

- **Sign up.** Run:

  ```bash
  agent-browser set viewport 1280 800
  agent-browser open "$WEB/auth/sign-up" && agent-browser wait --text "Create your account" && ab_save sign-up-01-form "Sign-up form: Create your account"
  agent-browser fill "#name" "$VERIFY_NAME" && agent-browser fill "#email" "$VERIFY_EMAIL" && agent-browser fill "#password" "$VERIFY_PASSWORD" && agent-browser press Enter
  agent-browser wait --text "Setting up your organization" && ab_save sign-up-02-organization-setup "After submit: Setting up your organization"
  agent-browser wait --fn "location.pathname === '/'" && agent-browser wait --text "Welcome to Everr" && ab_save sign-up-03-home "Sign-up lands on Home onboarding (Welcome to Everr, Step 1 of 4); the analytics banner is still up until web-onboard answers it"
  ```

  Every command exits `0`; `sign-up-02-organization-setup.url` is `/organization-setup?returnTo=%2F`; `sign-up-03-home.url` is the web origin `/` and `sign-up-03-home.txt` contains `Welcome to Everr`, `Step 1 of 4` and `$VERIFY_NAME` (`auth-sign-up`, `auth-org-setup`, `auth-home`).
- **Finish onboarding (most later recipes).** Run `$V web-onboard`. Exit `0`, prints `ONBOARDED orgs_completed=1`; `web/onboard-05-done.png` shows Home's usage dashboard with no consent banner. It answers the banner with `Deny` and clicks `Continue`, `Check my telemetry`, `I can see my local telemetry`, `Finish onboarding` with focus + Enter (the banner covers `Continue` for a pointer click). Skip it only when the recipe is about onboarding itself (`auth-home` needs `Welcome to Everr`, so run it after the Sign up assertions).
- **Check the stored user and org.** Run `$V web-psql signup-rows "select u.email, u.email_verified, o.name, o.metadata from \"user\" u join member m on m.user_id = u.id join organization o on o.id = m.organization_id where u.email = '$VERIFY_EMAIL'"`. One row, `email_verified` `f`, org name `Verify's projects`, metadata `{"clickhouseReady": true}`.
- **Log out, guard, wrong password, sign back in.** Run:

  ```bash
  agent-browser open "$WEB/" && agent-browser wait --text "Welcome to Everr"
  agent-browser find role button click --name "$VERIFY_NAME" && agent-browser wait --text "Log out" && agent-browser find role menuitem click --name "Log out"
  agent-browser wait --fn "location.pathname === '/auth/sign-in'" && agent-browser wait --text "Sign in to Everr" && ab_save session-01-signed-out
  agent-browser open "$WEB/api-keys" && agent-browser wait --fn "location.pathname === '/auth/sign-in'" && agent-browser wait --text "Sign in to Everr" && ab_save session-02-guard-redirect
  agent-browser fill "#email" "$VERIFY_EMAIL" && agent-browser fill "#password" "wrong-password-123" && agent-browser press Enter
  agent-browser wait --text "Invalid email or password" && ab_save session-03-wrong-password
  agent-browser fill "#password" "$VERIFY_PASSWORD" && agent-browser press Enter
  agent-browser wait --fn "location.pathname === '/api-keys'" && agent-browser wait --text "API keys" && ab_save session-04-signed-in-back
  ```

  Every command exits `0`: `session-01-signed-out.url` ends `/auth/sign-in?redirect=%2F`; `session-02-guard-redirect.url` ends `/auth/sign-in?redirect=%2Fapi-keys`; `session-03-wrong-password.txt` contains `Invalid email or password`; `session-04-signed-in-back.url` ends `/api-keys` (`auth-log-out`, `auth-guard`, `auth-wrong-password`, `auth-sign-in`).
- **Fresh sign-in only.** When a later recipe needs a session and this run's browser has none (it was closed): `agent-browser open "$WEB/auth/sign-in" && agent-browser wait --text "Sign in to Everr"`, fill `#email` and `#password`, `agent-browser press Enter`, then `agent-browser wait --text "Welcome to Everr"`.
- **Proof.** `web/sign-up-*`, `web/session-*`, `db/signup-rows/`.

## Gotchas

- The setup screen enforces a 2.5s minimum and navigates only while it stays open. Opening `/` yourself while it shows restarts the timer; wait for it to navigate (`wait --fn "location.pathname === '/'"`), as the recipe does.
- A loose URL wait such as `wait --url "**/"` or `!location.pathname.startsWith('/auth')` also matches `/organization-setup`. Wait for an exact path plus text instead.
- Sign-up sends verification email to the run's Mailpit. Inspect `MAILPIT_ORIGIN/api/v1/messages` from `web-env` when testing email; sign-in does not require email verification.
- `Sign in with Google` renders but only works with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (see SKILL.md boundary). Report it as skipped.
- `Forgot password?` delivers to this run's Mailpit; inspect its messages when exercising that path.
- The cookie-consent banner ("We use analytics") overlays the bottom right. It covers the sign-in/sign-up submit button, so submit with `agent-browser press Enter`; never click `Accept all` (it turns on analytics storage). `web-onboard` answers it with `Deny`, after which screenshots are clean.
