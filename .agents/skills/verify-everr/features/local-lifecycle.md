# Local stack lifecycle

`everr local start` brings up the local UI server and the embedded collector (OTLP/HTTP in, SQL/HTTP out, chDB on disk) as one instance; `everr local status` reports its endpoints; `everr local stop` shuts the whole instance down. Starting again while it runs is a no-op that reprints the same endpoints.

## Sub-features

- `life-start-detach` starts in the background and returns once ready, printing `otlp`, `sql`, `ui`, `log`.
- `life-start-again` repeated start reuses the running instance (same `instance_id`).
- `life-status` prints the three endpoints and exits 0 while running.
- `life-health` collector and UI `/health` identify the same instance.
- `life-stop` stops UI and collector, frees all ports.
- `life-status-stopped` status exits 2 once stopped.

## How to get to it (user POV)

- `everr local start` (foreground, opens the browser), `everr local start -d` / `--detach`, `--no-open`, `--quiet`.
- `everr local status`.
- `everr local stop`.
- `everr local ui` opens the running UI in the default browser (not driven here: needs a desktop browser handler).

## Driving it with verify-everr

Preconditions:

- `$V launch` printed `READY` (this is `life-start-detach`; its output is in `launch.stdout`).
- `$V doctor` ends with `DOCTOR OK` (covers `life-health`).

- **Start output.** Inspect the launch evidence. `cat .verify-everr/artifacts/$RUN_ID/launch.stdout` shows `otlp: http://127.0.0.1:<p>`, `sql: ...`, `ui: ...`, `log: /tmp/verify-everr/<RUN_ID>/logs/local.log`, and `launch.exit` is `0`.
- **Status.** Run `$V cli life-status -- local status`. Exit `0`, stdout has `otlp:`, `sql:`, `ui:` with the run's origins (compare with `$V env`).
- **Start again.** Note the id from `$V ui-get /health | jq -r .instance_id`, run `$V cli life-start-again -- local start --detach --no-open`. Exit `0`, stdout is the same three endpoint lines without a `log:` line, and `/health` still reports the same `instance_id`.
- **Collector status via UI.** Run `$V ui-cmd get_collector_status`. JSON has `"status":"running"` and `telemetryDir` under `/tmp/verify-everr/<RUN_ID>/telemetry`.
- **Stop.** Run `$V cli life-stop -- local stop`. Exit `0`, stdout `Everr stopped`. `ss -ltn` no longer lists the three run ports.
- **Stopped status.** Run `$V cli life-status-stopped -- local status`. Exit `2`; stdout is `otlp: stopped`, `sql: stopped`, `ui: stopped` and stderr says ``Everr isn't running - run `everr local start` ``.
- **Proof.** The `cli/life-*` folders plus `launch.*`. Finish with `$V cleanup` (safe after a manual stop).

## Gotchas

- Port and data-dir overrides (`EVERR_*_ORIGIN`) only work in debug builds. The release `everr` always uses 54418/54420/54421 and the real user data dir: never use it for verification.
- `local start` refuses to start if any of its ports is held by something that is not a matching Everr instance ("port occupied by an unrecognized service").
- One instance per telemetry dir: a second supervisor on the same `EVERR_TELEMETRY_DIR` fails on `local.lock`, and the log dir has its own lock (`use EVERR_LOCAL_LOG_DIR for a separate instance`).
- Detached start waits up to 20s for readiness. On a cold box the first start includes extracting the embedded collector and chDB into the cache dir.
- The UI server rejects requests whose `Host` is not exactly its origin; use `$V ui-get` instead of bare curl.
