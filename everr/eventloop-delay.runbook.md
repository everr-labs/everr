# Node.js event loop delay — runbook

The **eventloop-delay** alert fires when a service's
`nodejs.eventloop.delay.p99`, averaged over the last 5 minutes, exceeds
**100ms**. Each firing instance is one `ServiceName`.

The event loop is Node's single thread. "Delay" is how long a ready
callback waited before it ran — when it climbs, the process is **blocked**
(CPU-bound work, synchronous I/O, or GC pauses) and every request served by
that instance gets slower. This runbook localizes which of those it is.

## 1. Confirm severity

```panel
ref: eventloop-delay
```

- **p99 spiking while p50 stays low** → occasional stalls (a periodic job, a
  few heavy requests). Annoying tail latency, not a meltdown.
- **All percentiles elevated together** → sustained saturation; the loop is
  behind continuously and the service is broadly slow.

## 2. Is the loop CPU-saturated?

```panel
ref: eventloop-utilization
```

- **Utilization near 100%** → the loop is genuinely busy: CPU-bound work on
  the main thread (large JSON parse/stringify, synchronous crypto/zlib,
  tight loops, regex backtracking). Move it off the loop — stream/chunk it,
  or push it to `worker_threads`.
- **Low utilization but high delay** → the loop is _blocked_, not busy:
  synchronous filesystem calls, a native addon, or GC pauses. Check memory
  next.

## 3. GC / memory pressure

```panel
ref: heap-used
```

A heap that sawtooths up to the limit and back drives frequent major GCs,
and each major GC pause freezes the loop. Growth that never drops back is a
leak. Mitigations: cut per-request allocation, raise `--max-old-space-size`
if the working set is legitimately large, or fix the leak.

## 4. Common causes & what to do

| Signal                           | Likely cause                                     | Action                                                   |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| High utilization, high delay     | CPU-bound work on the main thread                | Offload to `worker_threads`; chunk/stream heavy work     |
| Low utilization, high delay      | Synchronous I/O or native call blocking the loop | Replace sync `fs`/crypto with async; audit native addons |
| Heap sawtooth near the limit     | GC pauses                                        | Reduce allocations; raise heap; check for leaks          |
| Delay tracks request bursts      | Overload                                         | Scale out or shed load                                   |
| One service only, after a deploy | Regression in that release                       | Correlate with deploy history; roll back                 |

## 5. Related

- [App server latency](./eventloop-delay.app-server-latency.md) — find the
  offending requests: which endpoints and server functions are slow, the
  heaviest operations, and the worst individual requests with their traces.
  Event loop delay surfaces there as elevated request latency; use that page
  to find who is affected, then come back here to see whether the loop is
  the cause.
