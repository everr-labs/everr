## What
Production error: "can't access property 'user', e is undefined" on `/runs/list` for an authenticated user.

## Where
Likely `packages/app/src/routes/_authenticated.tsx` — `beforeLoad`:
```ts
const auth = await getAuth();
if (!auth.user) { ... }
```

This is not confirmed, but it is the only place in the production bundle where a variable literally named `e` is assigned the result of `getAuth()` and then has `.user` accessed on it. All other `.user` accesses in the bundle either use a different variable name (e.g. `t`) or go through the safe `go()` wrapper from the WorkOS SDK which handles `undefined` before accessing any property.

The production bundle (`main-CdXrkRlC.js`) contains:
```js
let e=await Xe();if(!e.user)throw oe({href:await Je()});if(!e.organizationId)throw oe({to:`/onboarding`})
```

Firefox's error format includes the variable name in the message ("can't access property 'user', **e** is undefined"), which is what was reported. The variable name `e` here is from minification of the local `auth` variable in `beforeLoad`, not from any library code.

## Steps to reproduce
Unknown — happened in production on `/runs/list` for an already-authenticated user.

## Expected
`getAuth()` always returns `{ user: null }` or a full auth object (never `undefined`) per the WorkOS SDK source.

## Actual
`getAuth()` resolved to `undefined`, crashing on `.user` access and triggering the error boundary.

## Priority
high

## Notes
- SPA mode is enabled (`spa: { enabled: true }` in `vite.config.ts`) — all route loading is client-side, no SSR involved.
- The Vite plugin (`@tanstack/devtools-vite`) correctly strips devtools from production builds — that was ruled out as a cause.
- `getAuth` is a TanStack Start server function (GET). The SDK's `getAuthFromContext()` never returns `undefined`. Possible causes:
  - A TanStack Start edge case where a server function call resolves to `undefined` instead of throwing (e.g. during session expiry or a race condition in the WorkOS session refresh flow).
  - Stale deps: `package.json` targets `@tanstack/react-start@1.167.16` but installed version is `1.166.12` — running `pnpm install` might resolve edge cases fixed in newer versions.
- The defensive fix would be `if (!auth?.user)` but this was not applied — investigate root cause first.
- The same bug also manifests as "Query data cannot be undefined. Please make sure to return a value other than undefined from your query function. Affected query key: ["runs","jobs","<traceId>"]" in the browser console. `getRunJobs` is also a `createServerFn` (GET), so it hits the same edge case. React Query v5 surfaces this as a hard error because it disallows `undefined` query data.
