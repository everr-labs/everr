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

- `$V web-launch` printed `WEB READY` and `$V web-doctor` ends with `WEB DOCTOR OK`.
- `VERIFY_NAME`, `VERIFY_EMAIL` (unique per run), `VERIFY_PASSWORD` exported (see SKILL.md Drive).

- **Sign up.** Run `$V web-steps sign-up sign-up.json`. Every step `ok`; `web/sign-up/02-organization-setup.txt` contains `Setting up your organization`; `03-home.url` is the web origin `/` and `03-home.txt` contains `Welcome to Everr`, `Step 1 of 4` and `$VERIFY_NAME` (`auth-sign-up`, `auth-org-setup`, `auth-home`).
- **Check the stored user and org.** Run `$V web-psql signup-rows "select u.email, u.email_verified, o.name, o.metadata from \"user\" u join member m on m.user_id = u.id join organization o on o.id = m.organization_id where u.email = '$VERIFY_EMAIL'"`. One row, `email_verified` `f`, org name `Verify's projects`, metadata `{"clickhouseReady": true}`.
- **Log out, guard, wrong password, sign back in.** Run `$V web-steps sign-out-sign-in sign-out-sign-in.json`. All 20 steps `ok`: `01-signed-out.url` is `/auth/sign-in?redirect=%2F`; `02-guard-redirect.url` is `/auth/sign-in?redirect=%2Fapi-keys`; `03-wrong-password.txt` contains `Invalid email or password`; `04-signed-in-back.url` is `/api-keys` (`auth-log-out`, `auth-guard`, `auth-wrong-password`, `auth-sign-in`).
- **Fresh sign-in only.** When a later journey needs a session and the profile was reset, run `$V web-steps sign-in sign-in.json`; it ends on `/` with `Welcome to Everr`.
- **Proof.** `web/sign-up/`, `web/sign-out-sign-in/`, `db/signup-rows/`.

## Gotchas

- The setup screen enforces a 2.5s minimum and navigates only while it stays open. Shooting it and immediately opening `/` in a new journey restarts the timer; let the journey wait (`waitUrl "^/$"`), as `sign-up.json` does.
- `waitUrl` with a negative lookahead such as `^/(?!auth)` matches `/organization-setup`. Wait for an exact path plus text instead.
- Sign-up always tries to send a verification email to the hardcoded dev SMTP `localhost:1025`. Nothing in the flow needs it. Failures are logged only through the app's OTel logger (pointed at a dead port by default), not in `web.log`. Do not depend on reading that email; on a shared host port 1025 may belong to someone else's mailpit.
- `Sign in with Google` renders but only works with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (see SKILL.md boundary). Report it as skipped.
- `Forgot password?` relies on the same email delivery and is not scripted.
- The cookie-consent banner ("We use analytics") overlays the bottom right. It does not block the scripted clicks; do not click `Accept all`, it changes telemetry persistence for the profile.
