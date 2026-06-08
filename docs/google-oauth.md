# Google OAuth Setup

Everr uses Better Auth's built-in Google provider. The app expects the Google OAuth redirect URI to be derived from `BETTER_AUTH_URL`:

```text
${BETTER_AUTH_URL}/api/auth/callback/google
```

For local development, the default callback is:

```text
http://localhost:5173/api/auth/callback/google
```

## 1. Create the Google OAuth app

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create the Google Cloud project for Everr.
3. Configure the OAuth consent screen:
   - User type: `External`, unless this is only for a Google Workspace organization.
   - App name: `Everr`.
   - User support email and developer contact email: use the appropriate Everr addresses.
   - Scopes: keep the default profile/email scopes. Everr does not need sensitive Google API scopes for sign-in.
   - Publishing status: use `Testing` for local/dev and add test users, then switch to production when ready.
4. Go to `APIs & Services` -> `Credentials`.
5. Click `Create Credentials` -> `OAuth client ID`.
6. Choose `Web application`.
7. Add authorized redirect URIs:
   - Local: `http://localhost:5173/api/auth/callback/google`
   - Production: `https://<app-domain>/api/auth/callback/google`
8. Create the client and copy the `Client ID` and `Client Secret`.

Google matches redirect URIs exactly, including scheme, host, port, path, case, and trailing slash. Do not add a trailing slash to the callback URI.

## 2. Configure Everr

Set these environment variables:

```dotenv
BETTER_AUTH_URL="http://localhost:5173"
GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="<client-secret>"
```

For production, set `BETTER_AUTH_URL` to the public app origin:

```dotenv
BETTER_AUTH_URL="https://<app-domain>"
```

Store the client secret in the deployment secret manager. Do not commit it.

## 3. Verify

1. Start the web app.
2. Open `/auth/sign-in`.
3. Click `Sign in with Google`.
4. Complete the Google flow.
5. Confirm the browser returns to Everr and the user lands on the expected route.

If Google returns `redirect_uri_mismatch`, compare the redirect URI in Google Cloud with `${BETTER_AUTH_URL}/api/auth/callback/google`. The values must match exactly.

References:

- [Better Auth Google provider docs](https://better-auth.com/docs/authentication/google)
- [Better Auth OAuth docs](https://better-auth.com/docs/concepts/oauth)
- [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
