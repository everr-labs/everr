# Rejected keys

The public OTLP listeners refuse any request that does not carry a usable ingest key. HTTP answers `401` with an OTLP status body, gRPC answers grpc-status `16` (UNAUTHENTICATED), and nothing is written. The collector decides a missing header or a wrong scheme itself; every other decision comes from the verifier, which the collector calls with the key and the request's `Origin`.

## Sub-features

- `auth-missing`: no `Authorization` header: `401 {"code":16, "message":"missing authorization header"}`, no verifier call.
- `auth-scheme`: a scheme other than `Bearer`: `401 ... "authorization scheme must be Bearer"`, no verifier call.
- `auth-unknown`: a Bearer key the verifier does not know: `401 ... "unauthorized"`, verifier answered `401`.
- `auth-scope`: a key without the `ingest` scope (`apply-only`): `401`, verifier answered `403`.
- `auth-public-no-origin`: a public key without an `Origin` header (server to server): `401`, verifier answered `403`.
- `auth-secret-browser`: a secret key sent with an `Origin` header (from a browser): `401`, verifier answered `403`.
- `auth-public-foreign-origin`: a public key from an origin outside its allowlist: `401`, verifier answered `403`.
- `auth-grpc`: the same rejection over gRPC: grpc-status `16`.
- `auth-no-rows`: none of the rejected markers appear in `app.logs`.

## How to get to it (user POV)

- An SDK configured with no key, a revoked or mistyped key, a key minted for `everr apply` only, or a browser key used from the wrong site.
- Any OTLP/HTTP or OTLP/gRPC client hitting the public listeners.

## Driving it with verify-collector

Preconditions:

- `$V doctor` prints `COLLECTOR DOCTOR OK`.
- The commands run in `bash` (quoted arguments; see README Driving conventions).

- **Missing header.** Run `$V otlp auth-missing logs --no-auth`. `--- HTTP 401 {"code":16, "message":"missing authorization header"}`.
- **Wrong scheme.** Run `$V otlp auth-scheme logs --auth "Basic eA=="`. `--- HTTP 401` with `authorization scheme must be Bearer`.
- **Unknown key.** Run `$V otlp auth-unknown logs --auth "Bearer ek_doesnotexist"`. `--- HTTP 401` with `unauthorized`.
- **No ingest scope.** Run `$V otlp auth-scope logs --key apply-only`. `--- HTTP 401`.
- **Public key, no origin.** Run `$V otlp auth-public-no-origin logs --key public`. `--- HTTP 401`.
- **Secret key from a browser.** Run `$V otlp auth-secret-browser logs --key secret --origin https://allowed.verify.test`. `--- HTTP 401`.
- **Public key, foreign origin.** Run `$V otlp auth-public-foreign-origin logs --key public --origin https://evil.verify.test`. `--- HTTP 401`.
- **gRPC.** Run `$V grpc auth-grpc-missing --no-auth` and `$V grpc auth-grpc-unknown --auth "Bearer ek_nope"`. Both print `--- grpc-status 16`.
- **Verifier decisions.** Run `eval "$($V env)"; tail -n 8 "$VERIFY_LOG"`. One JSON line per verifier call with the key name (`unknown`, `apply-only`, `public`, `secret`), the origin and the status: `401` for the unknown key, `403` for the others. No line for `auth-missing` or `auth-scheme`.
- **Proof, nothing written.** Run `$V ch-until auth-no-rows '"n":0' "SELECT count() AS n FROM app.logs WHERE Body LIKE '%-auth-%'"`. Prints `{"n":0}`.

## Gotchas

- The stub implements the verify-key contract of `packages/app/src/routes/api/internal/verify-key.ts` (shared secret, scope, origin policy), not the application's key store. A claim about key minting, revocation, scopes stored in Postgres or per-organization retention lookup needs [verify-web-app](../../verify-web-app/SKILL.md).
- Failed verifications are cached for 5s per key and origin. Repeating the same rejected key within 5s adds no `verify.log` line.
- A verifier that is down or answers `5xx` is a transient error: the collector serves a key it accepted within the last 30s and rejects others. The stub has no switch for this; stopping it (its pid is `stubPid` in the run's `run.json`) makes `doctor` fail, so clean up and relaunch afterwards.
