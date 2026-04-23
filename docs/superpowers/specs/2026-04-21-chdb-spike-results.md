# chdb concurrency spike results

Date: 2026-04-22
Host: Darwin arm64
Go module: `github.com/chdb-io/chdb-go v1.11.0`
Native library: `libchdb` `v26.1.0` installed at `/opt/homebrew/lib/libchdb.so`

## Harness notes

- The final harness waits for producers to stop before closing the work queue. An earlier draft could panic on shutdown with `send on closed channel`; the numbers below are from the corrected harness only.
- The original `longSelectSQL()` from the plan (`SELECT service, count() ...`) was too fast on the tiny scratch dataset to create meaningful worker hold time.
- `chdb` rejects `sleep(10)` with `Code: 160 ... maximum sleep time is 3000000 microseconds`, so the long-read simulation was adjusted to `SELECT sleep(3)`.
- The plan's overload shape (`5000 INSERT/s`, `queue-depth=32`) did not saturate this machine, so an additional forced-saturation run (`queue-depth=1`, both producers active, `sleep(3)`) was added to explicitly verify reject behavior.

## Results

### Baseline

Command:

```bash
./chdbstress -duration 60s -insert-rate 1000 -select-rate 10 -queue-depth 128
```

Output:

```text
count=10109 rejected=0 errors=0
p50=1.708917ms p95=2.511708ms p99=58.995ms max=1.619554917s
```

Verdict: pass. The baseline target (`errors=0`, `rejected=0`, p95 < 50ms, p99 < 250ms) is comfortably met.

### Overload

Command:

```bash
./chdbstress -duration 30s -insert-rate 5000 -select-rate 0 -queue-depth 32
```

Output:

```text
count=5597 rejected=0 errors=0
p50=1.649417ms p95=2.166042ms p99=47.452416ms max=1.675783667s
```

Verdict: clean exit, but no rejects observed at the plan's exact parameters. On this machine the worker still kept up well enough that the bounded queue did not fill.

### Worker-hold

Command:

```bash
./chdbstress -duration 60s -insert-rate 500 -select-rate 5 -queue-depth 32 -long-select
```

Output:

```text
count=8734 rejected=0 errors=0
p50=1.754583ms p95=2.778583ms p99=44.88225ms max=3.015562125s
```

Verdict: pass. No crash or deadlock under a repeated 3s worker-hold query; max latency rose to the hold time as expected.

### Forced saturation (extra verification)

Command:

```bash
./chdbstress -duration 20s -insert-rate 1000 -select-rate 1000 -queue-depth 1 -long-select
```

Output:

```text
count=4413 rejected=1 errors=0
p50=1.504875ms p95=2.251125ms p99=7.201625ms max=3.020370166s
```

Verdict: pass. The bounded queue rejected cleanly under explicit contention, with no crash, hang, or query errors.

## Final verdict

Go.

The single-worker + bounded-queue design is viable for local telemetry. On this machine the normal-load and moderate-overload cases stay well within the target latency envelope, and the forced-contention case proves the queue rejects cleanly instead of wedging or crashing.
