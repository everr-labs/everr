# chdb-backed Local Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-based local telemetry store with an embedded chdb (in-process ClickHouse). The collector sidecar exposes `POST /sql` over HTTP; the Rust `everr telemetry` CLI becomes a thin HTTP client that passes SQL through.

**Architecture:** A forked upstream `clickhouseexporter` (new repo, vendored via OCB manifest) writes into a single `chdb.Session` through a shared `chdbhandle` package (single worker goroutine + bounded channel). A new `sqlhttp` extension in `collector/extension/sqlhttp/` serves `POST /sql` on localhost using the same handle. The CLI loses all filter flags and becomes one `query` command plus `endpoint` and `ai-instructions`.

**Tech Stack:** Go 1.23+, OpenTelemetry Collector Builder (OCB) 0.145.0, `chdb-go` (latest, pinned), `chdb` C library (macOS prebuilts, x86_64 + arm64), Rust 1.80+ (`reqwest`, `clap`, `serde_json`), Tauri sidecar lifecycle (unchanged).

**Spec:** [`docs/superpowers/specs/2026-04-21-chdb-local-telemetry-design.md`](../specs/2026-04-21-chdb-local-telemetry-design.md). Read the Shared chdb handle and `sqlhttp` sections before starting.

---

## File Structure

### New files — everr repo

| Path | Responsibility |
|---|---|
| `collector/extension/sqlhttp/go.mod` | Go module for the extension (OCB loads each component as a module). |
| `collector/extension/sqlhttp/factory.go` | `NewFactory()` + `createExtension()`. Registers config struct + defaults. |
| `collector/extension/sqlhttp/config.go` | `Config{ Endpoint string }`. |
| `collector/extension/sqlhttp/extension.go` | Extension type — opens `chdbhandle`, starts HTTP server, wires the handler, clean shutdown. |
| `collector/extension/sqlhttp/handler.go` | `POST /sql` handler: read body, run lexer, call `Handle.Do`, cap result at 16 MiB, write response. |
| `collector/extension/sqlhttp/lexer.go` | Single-pass SQL lexer + `ValidateReadOnly(string) error`. |
| `collector/extension/sqlhttp/lexer_test.go` | Table-driven tests for the allowlist, `;` guard, string-literal/comment handling, canary injections. |
| `collector/extension/sqlhttp/handler_test.go` | Handler unit tests with a fake `chdbhandle`. |
| `collector/extension/sqlhttp/README.md` | One paragraph describing the extension. |
| `collector/test/smoke/chdb_smoke_test.go` | End-to-end smoke: boot sidecar, POST OTLP, `SELECT` via `/sql`. |
| `packages/desktop-app/src-cli/src/telemetry/client.rs` | HTTP client — `query(sql, limit) -> Result<Vec<Value>>`. |
| `packages/desktop-app/src-cli/src/telemetry/sibling.rs` | `.last_flush`-based staleness detection. |
| `packages/desktop-app/src-cli/tests/telemetry_query_e2e.rs` | CLI e2e: spawn sidecar on random ports, push OTLP, query via CLI. |
| `packages/desktop-app/src-tauri/src/telemetry/sql_http.rs` | (optional) Helper that surfaces the SQL endpoint to the UI bridge. |
| `crates/everr-core/build/ai_instructions_schema.md` | Committed artifact generated from `DESCRIBE TABLE` output. |
| `collector/cmd/genaischema/main.go` | Build-time generator: call `DESCRIBE TABLE FORMAT JSONEachRow` via `/sql`, render as markdown. |
| (drift check piggybacks on existing collector macOS workflow — no new file) | Regenerate schema, diff against committed copy. See Task 6.3. |

### Modified files — everr repo

| Path | Change |
|---|---|
| `collector/config/manifest.local.yaml` | Drop `fileexporter` at Stage 7. Add `chdbexporter` (Stage 2) + `sqlhttp` (Stage 3). |
| `packages/desktop-app/src-tauri/src/telemetry/collector.yaml.tmpl` | Replace `file` exporter with `chdb`, add `sqlhttp` extension. |
| `packages/desktop-app/src-tauri/src/telemetry/ports.rs` | Export new `SQL_HTTP_PORT`. |
| `crates/everr-core/src/build.rs` | Add `SQL_HTTP_PORT` constants + `sql_http_origin()`. |
| `packages/desktop-app/src-cli/src/cli.rs` | Replace `TelemetrySubcommand::{Traces,Logs}` + all filter flags with `Query(TelemetryQueryArgs)`. |
| `packages/desktop-app/src-cli/src/telemetry/mod.rs` | Drop `otlp`/`store`/`query` modules; add `client`/`sibling`. |
| `packages/desktop-app/src-cli/src/telemetry/commands.rs` | Rewrite against `client` + `sibling`. |
| `CHANGELOG.md` | Entry describing the CLI break (Stage 4+5). |
| `crates/everr-core/src/assistant.rs` | Inline the generated schema block into the ai-instructions output. |

### Deleted files — everr repo (Stage 4+5)

- `packages/desktop-app/src-cli/src/telemetry/otlp.rs`
- `packages/desktop-app/src-cli/src/telemetry/store.rs`
- `packages/desktop-app/src-cli/src/telemetry/query.rs`
- `packages/desktop-app/src-cli/tests/telemetry_e2e.rs` (replaced by `telemetry_query_e2e.rs`)
- `packages/desktop-app/src-cli/tests/telemetry_store.rs` (imports from deleted modules)
- `packages/desktop-app/src-cli/tests/telemetry_commands.rs` (exercises deleted `traces`/`logs` subcommands)

### New files — `chdbexporter` fork repo (separate)

| Path | Responsibility |
|---|---|
| `go.mod` | Module root. |
| `UPSTREAM.md` | Records upstream SHA + sync notes. |
| `factory.go`, `config.go`, `exporter.go` | Copied from upstream `clickhouseexporter`, rewired to `chdb-go` via `chdbhandle`. |
| `internal/schema/*.go` | Copied unchanged from upstream. |
| `chdbhandle/handle.go` | Process-wide worker + bounded queue wrapping `chdb.Session`. |
| `chdbhandle/handle_test.go` | Queue behavior, path-invariant, worker lifecycle, Close-under-load. |
| `exporter_traces_test.go`, `exporter_logs_test.go`, `exporter_metrics_test.go` | Per-signal push round-trip tests against a real chdb tempdir session. |
| `exporter_table_names_test.go` | Custom `table_names` override flows through DDL + INSERT. |

Rationale for putting `chdbhandle` in the fork repo rather than `collector/internal/chdbhandle/`: OCB components are loaded as independent Go modules, and `internal/` visibility would prevent the extension from importing it. Hosting it in the fork repo (which both components already depend on transitively) is the least-friction option.

---

## Stage 0: Concurrency spike (gating)

Purpose: validate that a single-worker + bounded-queue pattern on `chdb-go` survives concurrent INSERT + SELECT under realistic load, **before** investing in the exporter fork.

Venue: a throwaway scratch directory outside the everr repo (e.g. `~/scratch/chdbstress`). Not committed here.

### Task 0.1: Bootstrap the spike module

**Files:**
- Create: `~/scratch/chdbstress/go.mod`
- Create: `~/scratch/chdbstress/main.go`

- [ ] **Step 1: Create a new Go module**

```bash
mkdir -p ~/scratch/chdbstress && cd ~/scratch/chdbstress
go mod init chdbstress
go get github.com/chdb-io/chdb-go
```

Expected: `go.mod` lists `github.com/chdb-io/chdb-go`.

- [ ] **Step 2: Write the harness skeleton**

Create `main.go`:

```go
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"sync/atomic"
	"time"

	"github.com/chdb-io/chdb-go/chdb"
)

type job struct {
	sql  string
	done chan error
}

type stats struct {
	mu        chan struct{} // 1-buf semaphore
	durations []time.Duration
	rejected  uint64
	errors    uint64
}

func main() {
	var (
		path        = flag.String("path", "/tmp/chdbstress-data", "chdb data dir")
		dur         = flag.Duration("duration", 60*time.Second, "total run time")
		insertRate  = flag.Int("insert-rate", 1000, "INSERT ops/sec")
		selectRate  = flag.Int("select-rate", 10, "SELECT ops/sec")
		queueDepth  = flag.Int("queue-depth", 128, "worker queue depth")
		longSelect  = flag.Bool("long-select", false, "fire a 10s scan alongside normal load")
	)
	flag.Parse()

	if err := os.RemoveAll(*path); err != nil {
		log.Fatalf("reset path: %v", err)
	}

	sess, err := chdb.NewSession(*path)
	if err != nil {
		log.Fatalf("open session: %v", err)
	}
	defer sess.Close()

	ddl := `CREATE TABLE IF NOT EXISTS t (
		ts DateTime64(9),
		service LowCardinality(String),
		body String,
		attrs Map(LowCardinality(String), String)
	) ENGINE = MergeTree()
	PARTITION BY toDate(ts)
	ORDER BY (service, ts)
	TTL toDateTime(ts) + INTERVAL 48 HOUR`
	if r, err := sess.Query(ddl, ""); err != nil {
		log.Fatalf("ddl: %v", err)
	} else {
		r.Free()
	}

	jobs := make(chan job, *queueDepth)
	st := &stats{mu: make(chan struct{}, 1)}
	ctx, cancel := context.WithTimeout(context.Background(), *dur)
	defer cancel()

	// Worker.
	go func() {
		for j := range jobs {
			start := time.Now()
			r, err := sess.Query(j.sql, "JSONEachRow")
			d := time.Since(start)
			if err == nil { r.Free() } // avoid native-memory leak per query
			st.record(d, err)
			j.done <- err
		}
	}()

	// INSERT producer.
	go produce(ctx, jobs, st, *insertRate, insertSQL)

	// SELECT producer.
	go produce(ctx, jobs, st, *selectRate, selectSQL)

	// Optional long-SELECT producer.
	if *longSelect {
		go func() {
			for ctx.Err() == nil {
				enqueue(ctx, jobs, st, longSelectSQL())
				time.Sleep(15 * time.Second)
			}
		}()
	}

	<-ctx.Done()
	close(jobs)
	time.Sleep(2 * time.Second) // drain

	st.report()
}

func produce(ctx context.Context, jobs chan<- job, st *stats, rate int, gen func() string) {
	if rate <= 0 {
		return
	}
	tick := time.NewTicker(time.Second / time.Duration(rate))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			enqueue(ctx, jobs, st, gen())
		}
	}
}

func enqueue(ctx context.Context, jobs chan<- job, st *stats, sql string) {
	j := job{sql: sql, done: make(chan error, 1)}
	select {
	case jobs <- j:
		<-j.done
	case <-time.After(2 * time.Second):
		atomic.AddUint64(&st.rejected, 1)
	case <-ctx.Done():
	}
}

func insertSQL() string {
	// Small but non-trivial payload; no prepared statement.
	return fmt.Sprintf(
		`INSERT INTO t FORMAT JSONEachRow {"ts":"%s","service":"bench","body":"hello","attrs":{"k":"v"}}`,
		time.Now().UTC().Format("2006-01-02T15:04:05.999999999"),
	)
}

func selectSQL() string {
	return `SELECT count() FROM t WHERE ts > now64() - INTERVAL 10 SECOND`
}

func longSelectSQL() string {
	return `SELECT service, count() FROM t GROUP BY service ORDER BY count() DESC`
}

func (s *stats) record(d time.Duration, err error) {
	s.mu <- struct{}{}
	s.durations = append(s.durations, d)
	if err != nil {
		s.errors++
	}
	<-s.mu
}

func (s *stats) report() {
	s.mu <- struct{}{}
	sort.Slice(s.durations, func(i, j int) bool { return s.durations[i] < s.durations[j] })
	n := len(s.durations)
	if n == 0 {
		fmt.Println("no samples")
		<-s.mu
		return
	}
	p := func(q float64) time.Duration { return s.durations[int(float64(n-1)*q)] }
	fmt.Printf("count=%d rejected=%d errors=%d\n", n, s.rejected, s.errors)
	fmt.Printf("p50=%s p95=%s p99=%s max=%s\n", p(0.5), p(0.95), p(0.99), s.durations[n-1])
	<-s.mu
}
```

- [ ] **Step 3: Build the harness**

```bash
cd ~/scratch/chdbstress
CGO_ENABLED=1 go build -o chdbstress .
```

Expected: binary produced. If `libchdb.so` / `libchdb.dylib` missing, follow `chdb-go`'s `update_libchdb.sh` first.

- [ ] **Step 4: Commit the spike locally**

```bash
cd ~/scratch/chdbstress
git init && git add . && git commit -m "chdb concurrency spike harness"
```

### Task 0.2: Run the spike, record results

- [ ] **Step 1: Baseline run — INSERT 1k/s, SELECT 10/s, 60s**

```bash
./chdbstress -duration 60s -insert-rate 1000 -select-rate 10 -queue-depth 128
```

Expected: non-zero `count`, `errors=0`, `rejected=0`, p95 < 50ms, p99 < 250ms. Record the numbers in `~/scratch/chdbstress/RESULTS.md`.

- [ ] **Step 2: Overload run — verify queue rejects cleanly**

```bash
./chdbstress -duration 30s -insert-rate 5000 -select-rate 0 -queue-depth 32
```

Expected: process exits cleanly, `errors=0`, `rejected>0`, no stack traces, no segfaults. A non-zero `rejected` is the design intent — it proves the bounded channel backpressure works.

- [ ] **Step 3: Long-SELECT run — verify worker-hold behavior**

```bash
./chdbstress -duration 60s -insert-rate 500 -select-rate 5 -queue-depth 32 -long-select
```

Expected: `rejected` may be non-zero during the long scan window. No crashes, no deadlock, harness exits at the end of the duration.

- [ ] **Step 4: Write findings**

Append to `~/scratch/chdbstress/RESULTS.md` — baseline throughput, p95/p99/max, whether any run paniced, and a one-line verdict (go / no-go).

**Gate:** if any run panics, segfaults, or throughput is an order of magnitude below target (e.g. <100 INSERT/s sustained), STOP and re-evaluate the approach. The spec's Discarded alternatives section has the fallback options.

- [ ] **Step 5: Commit results**

```bash
cd ~/scratch/chdbstress
git add RESULTS.md && git commit -m "spike results"
```

- [ ] **Step 6: Mirror the results into the everr repo**

The spike is a go/no-go gate for the whole migration. Future readers of this plan — and anyone revisiting the chdb decision — need the numbers alongside the spec, not in a throwaway scratch dir. Copy the findings file into `docs/superpowers/specs/`:

```bash
cp ~/scratch/chdbstress/RESULTS.md \
   /Users/guidodorsi/workspace/everr/docs/superpowers/specs/2026-04-21-chdb-spike-results.md
cd /Users/guidodorsi/workspace/everr
git add docs/superpowers/specs/2026-04-21-chdb-spike-results.md
git commit -m "docs: record chdb concurrency spike findings"
```

Also add a one-liner to `chdbexporter/UPSTREAM.md` (Task 1.1 Step 3) pointing at the committed copy, e.g. `Spike results: everr/docs/superpowers/specs/2026-04-21-chdb-spike-results.md`.

---

## Stage 1: Fork `clickhouseexporter`

Venue: a separate repo (`github.com/everr-labs/chdbexporter`). **Not** the everr repo. No everr-repo changes in this stage. Note: the final repo name and visibility are in the spec's Open items section; pick a name in Task 1.1 and lock it in.

### Task 1.1: Bootstrap the fork repo

**Files:**
- Create: `chdbexporter/UPSTREAM.md`
- Create: `chdbexporter/go.mod` (via copy)
- Create: `chdbexporter/factory.go`, `config.go`, `exporter.go`, `internal/**` (via copy)

- [ ] **Step 1: Pick an upstream SHA**

```bash
cd /tmp
git clone https://github.com/open-telemetry/opentelemetry-collector-contrib.git ocb-contrib
cd ocb-contrib
# Pin the upstream SHA matching OCB 0.145.0 in manifest.local.yaml.
git log --oneline v0.145.0 -- exporter/clickhouseexporter | head -1
```

Record the SHA — it goes into `UPSTREAM.md`.

- [ ] **Step 2: Copy upstream files into a fresh repo**

```bash
mkdir -p ~/workspace/chdbexporter && cd ~/workspace/chdbexporter
git init
cp -r /tmp/ocb-contrib/exporter/clickhouseexporter/* .
```

- [ ] **Step 3: Write `UPSTREAM.md`**

```markdown
# Upstream

Forked from `opentelemetry-collector-contrib/exporter/clickhouseexporter`.

- Upstream SHA: <sha-from-step-1>
- Upstream tag: v0.145.0
- Last sync: <today>

## Resync procedure

1. `git fetch upstream` (remote points to contrib)
2. `git diff <prev-sha>..<new-sha> -- exporter/clickhouseexporter` for review
3. Manually apply non-trivial changes; rerun the handle-based tests
4. Update this file's SHA + date
```

- [ ] **Step 4: Rewrite `go.mod` module path**

Change the module path to `github.com/everr-labs/chdbexporter`. Remove `go-mod:` `clickhouse-go` dependency lines. Add `github.com/chdb-io/chdb-go`.

```bash
go mod edit -module github.com/everr-labs/chdbexporter
go mod edit -droprequire github.com/ClickHouse/clickhouse-go/v2
go get github.com/chdb-io/chdb-go
go mod tidy
```

Expected: `go mod tidy` succeeds. The package will not yet compile because files still reference `clickhouse-go`; that's expected — next task rewires them.

- [ ] **Step 5: First commit**

```bash
cd ~/workspace/chdbexporter
git add . && git commit -m "initial fork of clickhouseexporter at SHA <sha>"
```

### Task 1.2: Build the `chdbhandle` package

**Files:**
- Create: `chdbexporter/chdbhandle/handle.go`
- Create: `chdbexporter/chdbhandle/handle_test.go`

- [ ] **Step 1: Write failing tests for Open/path invariant**

Create `chdbhandle/handle_test.go`:

```go
package chdbhandle

import (
	"context"
	"errors"
	"testing"
	"time"
)

// IMPORTANT: Open wraps a process-wide singleton (the `global` var in
// handle.go + globalSession inside chdb-go). None of these tests may use
// t.Parallel() — running them concurrently would race for the path pin.
// Each test must Close the handle it opens; Close resets `global = nil`
// so the next test gets a fresh pin.

func TestOpenSamePathReturnsSameHandle(t *testing.T) {
	path := t.TempDir()
	h1, err := Open(path, Options{})
	if err != nil { t.Fatal(err) }
	defer h1.Close()
	h2, err := Open(path, Options{})
	if err != nil { t.Fatal(err) }
	if h1 != h2 { t.Fatal("expected same handle for same path") }
}

func TestOpenDifferentPathRejected(t *testing.T) {
	p1, p2 := t.TempDir(), t.TempDir()
	h, err := Open(p1, Options{})
	if err != nil { t.Fatal(err) }
	defer h.Close()
	if _, err := Open(p2, Options{}); !errors.Is(err, ErrPathPinned) {
		t.Fatalf("expected ErrPathPinned, got %v", err)
	}
}

func TestDoRunsOnWorker(t *testing.T) {
	h, err := Open(t.TempDir(), Options{})
	if err != nil { t.Fatal(err) }
	defer h.Close()

	var called bool
	err = h.Do(context.Background(), func(s Session) error {
		called = true
		r, err := s.Query("SELECT 1", "JSONEachRow")
		if err != nil { return err }
		r.Free()
		return nil
	})
	if err != nil { t.Fatal(err) }
	if !called { t.Fatal("fn was never called") }
}

func TestDoReturnsErrQueueFullOnSaturation(t *testing.T) {
	h, err := Open(t.TempDir(), Options{QueueDepth: 1})
	if err != nil { t.Fatal(err) }
	defer h.Close()

	block := make(chan struct{})
	go h.Do(context.Background(), func(s Session) error { <-block; return nil })
	// Second call fills the queue; third must reject without blocking.
	go h.Do(context.Background(), func(s Session) error { return nil })
	time.Sleep(50 * time.Millisecond)

	// Non-blocking probe — queue is full right now, so Do must return
	// ErrQueueFull on the fast-path even though ctx has no deadline.
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // pre-cancel to force the fallback branch
	err = h.Do(ctx, func(s Session) error { return nil })
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("expected ErrQueueFull, got %v", err)
	}
	close(block)
}

func TestDoReturnsCtxErrWhenDeadlineExpires(t *testing.T) {
	h, err := Open(t.TempDir(), Options{QueueDepth: 1})
	if err != nil { t.Fatal(err) }
	defer h.Close()

	// Fill the worker with a long-running job so the queue drains slowly.
	block := make(chan struct{})
	go h.Do(context.Background(), func(s Session) error { <-block; return nil })
	time.Sleep(20 * time.Millisecond)

	// Queue has one free slot — enqueue succeeds, then the worker is held
	// by the blocking job. Do waits for the worker; ctx.Done should fire.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err = h.Do(ctx, func(s Session) error { return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected DeadlineExceeded, got %v", err)
	}
	close(block)
}

// Close must not panic even if Do() sends race with shutdown. The worker
// signals via h.closed and drains queued jobs with ErrClosed; we never close
// h.jobs (closing it would panic concurrent senders).
func TestCloseDoesNotPanicUnderConcurrentDo(t *testing.T) {
	h, err := Open(t.TempDir(), Options{QueueDepth: 4})
	if err != nil { t.Fatal(err) }

	// Fire several Do() calls concurrently with Close. Some may land in the
	// queue before close; others may race with it. None must panic; each must
	// return either nil or ErrClosed.
	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() {
			done <- h.Do(context.Background(), func(s Session) error { return nil })
		}()
	}
	time.Sleep(5 * time.Millisecond) // let some land in the queue
	h.Close()

	deadline := time.After(2 * time.Second)
	for i := 0; i < 8; i++ {
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, ErrClosed) {
				t.Fatalf("Do() returned unexpected error %v", err)
			}
		case <-deadline:
			t.Fatal("Do() callers hung after Close")
		}
	}
}
```

- [ ] **Step 2: Run tests — expect failure**

```bash
go test ./chdbhandle/...
```

Expected: FAIL (types don't exist yet).

- [ ] **Step 3: Implement `chdbhandle/handle.go`**

```go
// Package chdbhandle wraps chdb-go's process-global session behind a single
// worker goroutine and a bounded request queue. Concurrent callers enqueue
// jobs; the worker executes them serially against the underlying session.
//
// The chdb-go session is a process-global singleton (see chdb-go/chdb/session.go).
// This package enforces: one session per process lifetime, one path, no
// reopening.
package chdbhandle

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/chdb-io/chdb-go/chdb"
)

var (
	ErrQueueFull   = errors.New("chdbhandle: work queue full")
	ErrPathPinned  = errors.New("chdbhandle: path already pinned for this process")
	ErrClosed      = errors.New("chdbhandle: handle closed")
)

// Result is what Session.Query returns. Exported so external tests (e.g.
// the sqlhttp extension) can implement fakes.
//
// IMPORTANT: Buf() is backed by chdb-purego memory that is NOT managed by the
// Go GC. Callers MUST call Free() when they are done with the buffer (use
// defer r.Free() right after the error check). Failing to call Free() leaks
// memory per query — a fast path to OOM under load.
type Result interface {
	Buf() []byte
	Free()
}

// Session is the subset of chdb-go's *chdb.Session that chdbhandle exposes to
// callers. External tests substitute fakes that implement this interface.
type Session interface {
	Query(sql, format string) (Result, error)
}

type sessionAdapter struct{ *chdb.Session }

func (s sessionAdapter) Query(sql, format string) (Result, error) {
	r, err := s.Session.Query(sql, format)
	if err != nil { return nil, err }
	return resultAdapter{r}, nil
}

// resultAdapter wraps chdb-go's *chdb.Result so we can expose the Free() hook
// through our own interface. The underlying type already has Free() — we just
// promote it to the Result interface contract.
type resultAdapter struct{ *chdb.Result }

func (r resultAdapter) Buf() []byte { return r.Result.Buf() }
func (r resultAdapter) Free()       { r.Result.Free() }

type Options struct {
	// QueueDepth is the bounded capacity of the work queue. 0 → default of 128.
	QueueDepth int
}

type Handle struct {
	path     string
	jobs     chan job
	sess     Session
	done     chan struct{}
	wg       sync.WaitGroup
	closed   chan struct{}
	closeOnce sync.Once
}

type job struct {
	ctx  context.Context
	fn   func(Session) error
	done chan error
}

var (
	globalMu sync.Mutex
	global   *Handle
)

// Open returns the process-wide Handle. The first caller's path wins; any
// subsequent Open with a different path returns ErrPathPinned regardless of
// whether Close has run. See the spec's "Invariant: path is fixed for process
// lifetime" section.
func Open(path string, opts Options) (*Handle, error) {
	globalMu.Lock()
	defer globalMu.Unlock()
	if global != nil {
		if global.path != path { return nil, ErrPathPinned }
		return global, nil
	}
	if opts.QueueDepth <= 0 { opts.QueueDepth = 128 }

	sess, err := chdb.NewSession(path)
	if err != nil { return nil, err }

	h := &Handle{
		path: path,
		jobs: make(chan job, opts.QueueDepth),
		sess: sessionAdapter{sess},
		closed: make(chan struct{}),
	}
	h.wg.Add(1)
	go h.worker()
	global = h
	return h, nil
}

// Do submits fn to the worker. It distinguishes three failure kinds so
// callers can map them to different error responses:
//
//   - ErrQueueFull: the bounded channel is full *right now* (non-blocking
//     send failed). Caller should treat the system as saturated.
//   - ctx.Err() (DeadlineExceeded / Canceled): caller's context gave up
//     while waiting for space or for the worker. Not necessarily
//     saturation — could be a slow in-flight query holding the worker.
//   - ErrClosed: the handle is shutting down.
//
// fn runs with exclusive session access; it must not retain the Session or
// perform unbounded blocking I/O.
func (h *Handle) Do(ctx context.Context, fn func(Session) error) error {
	select {
	case <-h.closed:
		return ErrClosed
	default:
	}
	j := job{ctx: ctx, fn: fn, done: make(chan error, 1)}

	// Fast-path non-blocking enqueue. If it fails, the channel is literally
	// full — surface that distinctly from a caller-side ctx cancellation.
	select {
	case h.jobs <- j:
	default:
		select {
		case <-ctx.Done():
			return ErrQueueFull
		case <-h.closed:
			return ErrClosed
		case h.jobs <- j:
		}
	}

	select {
	case err := <-j.done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-h.closed:
		return ErrClosed
	}
}

// Close stops the worker and releases the underlying session.
//
// OWNERSHIP: only the sqlhttp extension's Shutdown() calls Close() in
// production. Individual callers (e.g. the exporter) must NEVER call Close —
// doing so would yank the session out from under peer components that still
// hold a *Handle reference. The handle lives for the entire collector process
// lifetime; at shutdown, the extension is the single point that tears it
// down. The spec's "do not close from individual callers" rule is enforced
// by convention, not by a compile-time guard.
//
// Close does NOT close the jobs channel: doing so would race with concurrent
// Do() sends and panic. Instead it signals h.closed; the worker observes that
// signal in its select loop and returns, draining whatever jobs were already
// enqueued by completing them with ErrClosed.
//
// Close DOES clear the `global` singleton so that a subsequent Open() in the
// same process can pin a fresh path — required for the test suite, which
// must run multiple Open/Close cycles serially. In production this is a
// no-op (process exits; nothing calls Open again).
func (h *Handle) Close() {
	h.closeOnce.Do(func() {
		close(h.closed)
		h.wg.Wait()
		_ = h.sess // underlying chdb session is released when GC collects it

		globalMu.Lock()
		if global == h { global = nil }
		globalMu.Unlock()
	})
}

// worker runs as a single goroutine for the lifetime of the handle. It reads
// from h.jobs until h.closed fires. After h.closed fires, it drains any jobs
// still sitting in the channel by completing them with ErrClosed — this
// unblocks any Do() caller that slipped a job in just before shutdown.
func (h *Handle) worker() {
	defer h.wg.Done()
	for {
		select {
		case <-h.closed:
			// Drain in-flight jobs so their Do() callers don't hang.
			for {
				select {
				case j := <-h.jobs:
					j.done <- ErrClosed
				default:
					return
				}
			}
		case j := <-h.jobs:
			if err := j.ctx.Err(); err != nil {
				j.done <- err
				continue
			}
			j.done <- j.fn(h.sess)
		}
	}
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
go test ./chdbhandle/...
```

Expected: PASS.

- [ ] **Step 5: Add a queue-wait metrics field (visible from Stage 3 onward)**

Add to `Handle`:

```go
type Metrics struct {
	QueueDepth func() int
	Rejected   func() uint64
}

func (h *Handle) Metrics() Metrics { /* return closures over atomics */ }
```

Extend the worker to track rejected count via `atomic.AddUint64`. Skip if the spike didn't motivate it; revisit in Stage 3 when the extension wires metrics into OTel's self-telemetry.

- [ ] **Step 6: Commit**

```bash
cd ~/workspace/chdbexporter
git add chdbhandle && git commit -m "chdbhandle: single worker + bounded queue"
```

### Task 1.3: Rewire exporter storage to `chdbhandle`

**Files:**
- Modify: `chdbexporter/exporter.go`
- Modify: `chdbexporter/factory.go`, `config.go`

- [ ] **Step 1: List clickhouse-go call sites**

```bash
cd ~/workspace/chdbexporter
grep -rn "clickhouse-go\|clickhouse\.Open\|sql.DB\|db.Exec\|db.PrepareBatch" .
```

Expected: a finite list — DDL in `init`/`start`, batched INSERT in each `push*` method. Record this list; each call site is a single-line rewrite.

- [ ] **Step 2: Rip out `config.Config.DSN`, `cluster`, `replication`, `compress`, `username`, `password`, `database` fields**

Replace with:

```go
type Config struct {
	// Path to the chdb data directory.
	Path string `mapstructure:"path"`

	// TTL applied to every OTel table (MergeTree TTL clause).
	TTL time.Duration `mapstructure:"ttl"`

	// TableNames is optional per-signal override. Defaults match upstream.
	TableNames TableNames `mapstructure:"table_names"`

	// Embedded exporter helper configs (keep upstream).
	exporterhelper.TimeoutConfig `mapstructure:",squash"`
	QueueBatchConfig             exporterhelper.QueueBatchConfig `mapstructure:",squash"`
	BackOffConfig                configretry.BackOffConfig       `mapstructure:",squash"`
}

func (c *Config) Validate() error {
	if c.Path == "" { return errors.New("path must be set") }
	if c.TTL <= 0 { return errors.New("ttl must be > 0") }
	return nil
}
```

- [ ] **Step 3: Replace the `*sql.DB` field with a `*chdbhandle.Handle`**

In `exporter.go`:

```go
import "github.com/everr-labs/chdbexporter/chdbhandle"

type chdbExporter struct {
	cfg    *Config
	h      *chdbhandle.Handle
	logger *zap.Logger
	// Upstream prebuilds INSERT statements per signal. KEEP them.
	insertSQLTraces                      string
	insertSQLLogs                        string
	insertSQLMetricsSum                  string
	insertSQLMetricsGauge                string
	insertSQLMetricsHistogram            string
	insertSQLMetricsExponentialHistogram string
	insertSQLMetricsSummary              string
}

func newExporter(cfg *Config, settings exporter.Settings) (*chdbExporter, error) {
	h, err := chdbhandle.Open(cfg.Path, chdbhandle.Options{
		// OTel retry queue handles backpressure; the handle queue is a
		// belt-and-braces buffer.
		QueueDepth: 128,
	})
	if err != nil { return nil, err }
	return &chdbExporter{ cfg: cfg, h: h, logger: settings.Logger, /* ... */ }, nil
}

func (e *chdbExporter) start(ctx context.Context, _ component.Host) error {
	// Run DDL on startup. Each Query returns a Result that owns native memory
	// — Free() it even though we discard the buf.
	return e.h.Do(ctx, func(s chdbhandle.Session) error {
		for _, ddl := range allDDL(e.cfg) {
			r, err := s.Query(ddl, "")
			if err != nil { return err }
			r.Free()
		}
		return nil
	})
}

func (e *chdbExporter) shutdown(context.Context) error {
	// The handle is process-wide — do not close from individual callers.
	return nil
}
```

- [ ] **Step 4: Rewrite each `pushTraces`/`pushLogs`/`pushMetrics*`**

Pattern (traces shown; logs/metrics follow the same shape):

```go
func (e *chdbExporter) pushTraces(ctx context.Context, td ptrace.Traces) error {
	// Keep the upstream row-marshalling helper unchanged.
	rows := marshalTraces(td, e.cfg)
	if len(rows) == 0 { return nil }

	// JSONEachRow body: one row per line.
	var body strings.Builder
	body.WriteString(e.insertSQLTraces) // "INSERT INTO otel_traces FORMAT JSONEachRow "
	for _, r := range rows {
		b, _ := json.Marshal(r)
		body.Write(b)
		body.WriteByte('\n')
	}

	return e.h.Do(ctx, func(s chdbhandle.Session) error {
		r, err := s.Query(body.String(), "")
		if err != nil { return err }
		r.Free()
		return nil
	})
}
```

- [ ] **Step 5: Update `factory.go` to build/register the new config + exporter**

Replace `exporter.NewFactoryFunc` call sites with the new `newExporter` constructor. Ensure `createTraces/Logs/Metrics` return wrappers using `exporterhelper.NewTraces/Logs/Metrics`.

- [ ] **Step 6: Compile**

```bash
cd ~/workspace/chdbexporter
go build ./...
```

Expected: no errors. If `clickhouse-go` references remain, the compile fails loud — fix them before proceeding.

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "exporter: rewire storage to chdbhandle"
```

### Task 1.4: Traces-pipeline unit test

**Files:**
- Create: `chdbexporter/exporter_traces_test.go`

- [ ] **Step 1: Write the failing test**

```go
package chdbexporter

import (
	"context"
	"testing"

	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestPushTracesRoundTrip(t *testing.T) {
	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
	}
	ex, err := newExporter(cfg, exportertest.NewNopSettings(exportertest.NopType))
	if err != nil { t.Fatal(err) }
	if err := ex.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "unit")
	ss := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	ss.SetName("test-span")
	ss.SetTraceID([16]byte{1})
	ss.SetSpanID([8]byte{2})

	if err := ex.pushTraces(context.Background(), td); err != nil {
		t.Fatalf("push: %v", err)
	}

	// Assert round-trip via the same handle.
	var got uint64
	err = ex.h.Do(context.Background(), func(s chdbhandle.Session) error {
		r, err := s.Query(`SELECT count() FROM otel_traces`, "JSONEachRow")
		if err != nil { return err }
		defer r.Free()
		// Parse the single row's count field.
		var v struct { Count uint64 `json:"count()"` }
		json.Unmarshal(r.Buf(), &v)
		got = v.Count
		return nil
	})
	if err != nil { t.Fatal(err) }
	if got != 1 { t.Fatalf("want 1 row, got %d", got) }
}
```

- [ ] **Step 2: Run**

```bash
go test ./... -run TestPushTraces -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add exporter_traces_test.go && git commit -m "test: traces pipeline round-trip"
```

### Task 1.5: Logs-pipeline unit test

**Files:**
- Create: `chdbexporter/exporter_logs_test.go`

- [ ] **Step 1: Write the failing test**

Copy Task 1.4's structure; swap `ptrace.NewTraces()` for `plog.NewLogs()`, a log record with body `"hello"`, and assert `SELECT count() FROM otel_logs`.

- [ ] **Step 2: Run, expect pass, commit**

```bash
go test ./... -run TestPushLogs -v && git add exporter_logs_test.go && git commit -m "test: logs pipeline round-trip"
```

### Task 1.6: Metrics-pipeline unit tests

**Files:**
- Create: `chdbexporter/exporter_metrics_test.go`

- [ ] **Step 1: One sub-test per metric kind — sum, gauge, histogram, exponential-histogram, summary**

For each, assert the correct `otel_metrics_*` table receives the row. Use `pmetric.NewMetrics()` fixtures. Follow the same round-trip pattern.

- [ ] **Step 2: Run, expect pass, commit**

```bash
go test ./... -run TestPushMetrics -v && git add exporter_metrics_test.go && git commit -m "test: metrics pipelines round-trip"
```

### Task 1.7: `table_names` config override test

The spec keeps `Config.TableNames` as a per-signal override so ops can rename tables if they ever clash. We don't ship non-default values, but the field is part of the public config surface and must actually flow into DDL + INSERT — otherwise it's dead code. This test exercises a custom table name end-to-end.

**Files:**
- Create: `chdbexporter/exporter_table_names_test.go`

- [ ] **Step 1: Write the failing test**

```go
package chdbexporter

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/pdata/plog"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

func TestTableNameOverrideRoutesToCustomTable(t *testing.T) {
	cfg := &Config{
		Path:       t.TempDir(),
		TTL:        48 * time.Hour,
		TableNames: TableNames{Logs: "custom_logs"},
	}
	ex, err := newExporter(cfg, exportertest.NewNopSettings(exportertest.NopType))
	if err != nil { t.Fatal(err) }
	if err := ex.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "unit")
	rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("hello")

	if err := ex.pushLogs(context.Background(), ld); err != nil {
		t.Fatalf("push: %v", err)
	}

	// The row must land in custom_logs, NOT otel_logs.
	assertCount := func(table string, want uint64) {
		t.Helper()
		var got uint64
		err := ex.h.Do(context.Background(), func(s chdbhandle.Session) error {
			r, err := s.Query("SELECT count() FROM "+table, "JSONEachRow")
			if err != nil { return err }
			defer r.Free()
			var v struct{ Count uint64 `json:"count()"` }
			_ = json.Unmarshal(r.Buf(), &v)
			got = v.Count
			return nil
		})
		if err != nil { t.Fatalf("count(%s): %v", table, err) }
		if got != want { t.Fatalf("%s: want %d rows, got %d", table, want, got) }
	}
	assertCount("custom_logs", 1)

	// The default table must NOT have been created.
	err = ex.h.Do(context.Background(), func(s chdbhandle.Session) error {
		r, err := s.Query("SELECT 1 FROM otel_logs LIMIT 1", "JSONEachRow")
		if err != nil { return err }
		r.Free()
		return nil
	})
	if err == nil {
		t.Fatal("otel_logs exists but shouldn't — override leaked to default DDL")
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd ~/workspace/chdbexporter
go test ./... -run TestTableNameOverride -v
```

Expected: FAIL — most likely `TableNames.Logs` is not wired into `allDDL()` or `insertSQLLogs`.

- [ ] **Step 3: Wire `TableNames` through DDL + INSERT**

Find `allDDL(cfg)` and every `insertSQL*` field in `exporter.go`. Replace every hardcoded `otel_logs` / `otel_traces` / `otel_metrics_*` with `cfg.TableNames.<Signal>()`, where `TableNames.<Signal>()` returns the override if set and the default otherwise. Sketch:

```go
type TableNames struct {
	Traces                      string `mapstructure:"traces"`
	Logs                        string `mapstructure:"logs"`
	MetricsSum                  string `mapstructure:"metrics_sum"`
	MetricsGauge                string `mapstructure:"metrics_gauge"`
	MetricsHistogram            string `mapstructure:"metrics_histogram"`
	MetricsExponentialHistogram string `mapstructure:"metrics_exponential_histogram"`
	MetricsSummary              string `mapstructure:"metrics_summary"`
}

func (t TableNames) TracesName() string { return firstNonEmpty(t.Traces, "otel_traces") }
func (t TableNames) LogsName() string   { return firstNonEmpty(t.Logs,   "otel_logs")   }
// ...one helper per signal...

func firstNonEmpty(a, b string) string { if a != "" { return a }; return b }
```

Thread the helper result into `allDDL` and `newExporter`'s `insertSQL*` assignments.

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./... -run TestTableNameOverride -v
```

Expected: PASS. The existing Task 1.4/1.5/1.6 tests continue to pass (they use the zero-valued `TableNames{}` which resolves to defaults).

- [ ] **Step 5: Commit**

```bash
git add chdbexporter/exporter_table_names_test.go chdbexporter/exporter.go chdbexporter/config.go
git commit -m "exporter: honor TableNames override in DDL + INSERT"
```

### Task 1.8: Publish the fork and tag a release

OCB resolves `gomod` entries through the normal Go module proxy. A local tag alone isn't reachable from `go get` unless the remote exists AND we've pushed the tag. Before Stage 2 can run `make build-local`, the fork must be pushed.

- [ ] **Step 1: Ensure the GitHub remote exists**

```bash
cd ~/workspace/chdbexporter
gh repo view everr-labs/chdbexporter >/dev/null 2>&1 || \
  gh repo create everr-labs/chdbexporter --private --source . --push
```

Expected: the repo exists under `everr-labs/chdbexporter` (private).

- [ ] **Step 2: Tag and push v0.1.0**

```bash
cd ~/workspace/chdbexporter
git tag v0.1.0
git push origin main --tags
```

Expected: `git ls-remote --tags origin` lists `refs/tags/v0.1.0`.

- [ ] **Step 3: Record the tag in `UPSTREAM.md`**

Under a new "## Fork releases" heading: `v0.1.0 — initial chdb cut from upstream clickhouseexporter v0.145.0`.

This is the version Stage 2 vendors. If you're iterating on fork code before a real release, use the local-replace approach in Task 2.1 Step 2 below instead of chasing tags.

---

## Stage 2: Vendor the fork into the everr collector

### Task 2.1: Update `manifest.local.yaml`

**Files:**
- Modify: `collector/config/manifest.local.yaml`

- [ ] **Step 1: Add the fork to the exporters list**

```yaml
exporters:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/exporter/fileexporter v0.145.0
  - gomod: github.com/everr-labs/chdbexporter v0.1.0
```

Note: `fileexporter` stays for this stage; it's removed in Stage 7.

- [ ] **Step 2: (During active fork development) Add a `replaces` entry pointing at the local checkout**

If you're iterating on the fork between releases, OCB's `replaces` section lets the build resolve the module out of a local path instead of the proxy. This is only needed during development — production CI builds should not carry it.

```yaml
replaces:
  - github.com/everr-labs/chdbexporter => /Users/guidodorsi/workspace/chdbexporter
```

Alternatively, use a Go pseudo-version that points at the tip of a local-only branch (OCB passes this straight to `go mod`):

```yaml
exporters:
  - gomod: github.com/everr-labs/chdbexporter v0.0.0-00010101000000-000000000000
```

Pick ONE approach — tagged release (Step 1 only), or local replace (Step 1 + Step 2). Before merging this PR, drop any `replaces` entry so the committed manifest points at the published tag.

- [ ] **Step 3: Rebuild the collector**

```bash
cd /Users/guidodorsi/workspace/everr/collector
make build-local
```

Expected: OCB regenerates `build-local/`, `go build` succeeds, `build-local/everr-local-collector` produced.

- [ ] **Step 4: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/config/manifest.local.yaml
git commit -m "collector: vendor chdbexporter fork"
```

### Task 2.2: Smoke test in everr repo

**Files:**
- Create: `collector/test/smoke/chdb_smoke_test.go`

- [ ] **Step 1: Write the failing test**

```go
package smoke

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// resolveCollectorBinary returns the path to the built everr-local-collector.
// Honors $EVERR_COLLECTOR_BIN if set (CI); otherwise resolves relative to this
// test file so `go test ./...` from any cwd still finds the binary.
func resolveCollectorBinary(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("EVERR_COLLECTOR_BIN"); env != "" { return env }
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok { t.Fatal("runtime.Caller failed") }
	// thisFile = <repo>/collector/test/smoke/chdb_smoke_test.go
	// binary   = <repo>/collector/build-local/everr-local-collector
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "build-local", "everr-local-collector")
}

// Boots everr-local-collector with a chdb exporter, pushes an OTLP log, and
// asserts the on-disk chdb directory has rows. Gated on CGO + libchdb.
func TestChdbSmoke(t *testing.T) {
	binary := resolveCollectorBinary(t)
	if _, err := os.Stat(binary); err != nil { t.Skipf("collector not built: %v", err) }

	tmp := t.TempDir()
	cfg := filepath.Join(tmp, "collector.yaml")
	writeConfig(t, cfg, tmp)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--config", cfg)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil { t.Fatal(err) }
	t.Cleanup(func() { cancel(); cmd.Wait() })

	waitHealth(t, "http://127.0.0.1:54399/", 5*time.Second)

	// Push one OTLP log.
	body := []byte(`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityText":"INFO","body":{"stringValue":"hello"}}]}]}]}`)
	resp, err := http.Post("http://127.0.0.1:54398/v1/logs", "application/json", bytes.NewReader(body))
	if err != nil { t.Fatal(err) }
	resp.Body.Close()
	if resp.StatusCode != 200 { t.Fatalf("OTLP status %d", resp.StatusCode) }

	// Give the batch processor time to flush.
	time.Sleep(2 * time.Second)

	// chdb data dir must contain part files.
	entries, _ := os.ReadDir(filepath.Join(tmp, "chdb"))
	if len(entries) == 0 { t.Fatal("chdb data dir empty after push") }
}

func writeConfig(t *testing.T, path, tmp string) {
	t.Helper()
	cfg := fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:54398
processors:
  batch:
    timeout: 500ms
exporters:
  chdb:
    path: %q
    ttl: 48h
extensions:
  health_check:
    endpoint: 127.0.0.1:54399
service:
  extensions: [health_check]
  pipelines:
    logs: { receivers: [otlp], processors: [batch], exporters: [chdb] }
`, filepath.Join(tmp, "chdb"))
	if err := os.WriteFile(path, []byte(cfg), 0644); err != nil { t.Fatal(err) }
}

func waitHealth(t *testing.T, url string, d time.Duration) {
	t.Helper()
	dl := time.Now().Add(d)
	for time.Now().Before(dl) {
		if r, err := http.Get(url); err == nil && r.StatusCode == 200 { r.Body.Close(); return }
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("healthcheck never came up")
}

func init() {
	_ = json.RawMessage{} // silence unused import until expanded
}
```

- [ ] **Step 2: Run (expect pass)**

```bash
cd collector
make build-local
go test ./test/smoke/... -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/test/smoke/chdb_smoke_test.go
git commit -m "collector: smoke test for chdbexporter round-trip"
```

---

## Stage 3: Build the `sqlhttp` extension

### Startup-ordering note

OpenTelemetry Collector lifecycle starts extensions **before** exporters, which means `sqlhttp` opens its TCP listener before `chdbexporter` has run its DDL. A query hitting `/sql` in that window would fail with "table doesn't exist". Two mitigations stack:

1. **In-extension readiness gate.** The extension's `Start()` spawns a background goroutine that polls `SELECT 1 FROM otel_logs LIMIT 1` via the shared handle. Until the probe succeeds, the `/sql` handler returns `503 Retry-After: 1` with body `{"error":"collector starting"}`. Implemented in Task 3.3.
2. **CLI retry.** `client.rs` retries once on 503 (Task 4.5). A cold-cache first query therefore takes at most one round-trip extra.

Accepted compromise: if the exporter's DDL itself fails (e.g. permissions), the readiness probe never flips and `/sql` returns 503 indefinitely. That's the right behavior — a collector with no tables is not queryable, and the failure path is the same as the session not opening at all.

### Task 3.1: Scaffold the extension module

**Files:**
- Create: `collector/extension/sqlhttp/go.mod`
- Create: `collector/extension/sqlhttp/config.go`
- Create: `collector/extension/sqlhttp/factory.go`
- Create: `collector/extension/sqlhttp/extension.go`
- Create: `collector/extension/sqlhttp/README.md`

- [ ] **Step 1: Init the module**

```bash
cd /Users/guidodorsi/workspace/everr/collector/extension/sqlhttp
go mod init github.com/everr-labs/everr/collector/extension/sqlhttp
go get go.opentelemetry.io/collector/extension@v0.145.0
go get go.opentelemetry.io/collector/component@v0.145.0
go get github.com/everr-labs/chdbexporter@v0.1.0
```

- [ ] **Step 2: Write `config.go`**

```go
package sqlhttp

import (
	"errors"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

type Config struct {
	Endpoint string `mapstructure:"endpoint"`
	// Path must match the chdbexporter's path. The handle enforces a single
	// process-wide path anyway, but the extension needs to know it for Open.
	Path string `mapstructure:"path"`

	// Tunable timeouts. Zero uses the defaults from the spec.
	QueryTimeout   time.Duration `mapstructure:"query_timeout"`
	EnqueueTimeout time.Duration `mapstructure:"enqueue_timeout"`
	MaxResultBytes int64         `mapstructure:"max_result_bytes"`
}

func (c *Config) Validate() error {
	if c.Endpoint == "" { return errors.New("endpoint must be set") }
	if c.Path == "" { return errors.New("path must be set") }
	return nil
}

func (c *Config) applied() Config {
	out := *c
	if out.QueryTimeout == 0 { out.QueryTimeout = 5 * time.Second }
	if out.EnqueueTimeout == 0 { out.EnqueueTimeout = 2 * time.Second }
	if out.MaxResultBytes == 0 { out.MaxResultBytes = 16 << 20 }
	return out
}

// Re-export so callers don't depend on chdbhandle directly.
type Session = chdbhandle.Session
```

- [ ] **Step 3: Write `factory.go`**

```go
package sqlhttp

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

const typeStr = "sqlhttp"

func NewFactory() extension.Factory {
	return extension.NewFactory(
		component.MustNewType(typeStr),
		createDefaultConfig,
		createExtension,
		component.StabilityLevelDevelopment,
	)
}

func createDefaultConfig() component.Config {
	return &Config{Endpoint: "127.0.0.1:54320"}
}

func createExtension(_ context.Context, settings extension.Settings, cfg component.Config) (extension.Extension, error) {
	return newExtension(cfg.(*Config), settings), nil
}
```

- [ ] **Step 4: Write `extension.go`**

```go
package sqlhttp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

type sqlExt struct {
	cfg      Config
	logger   *zap.Logger
	handle   *chdbhandle.Handle
	hdlr     *handler
	srv      *http.Server
	listener net.Listener
	stopCh   chan struct{}
}

func newExtension(cfg *Config, settings extension.Settings) *sqlExt {
	return &sqlExt{
		cfg:    cfg.applied(),
		logger: settings.Logger,
		stopCh: make(chan struct{}),
	}
}

func (e *sqlExt) Start(ctx context.Context, _ component.Host) error {
	h, err := chdbhandle.Open(e.cfg.Path, chdbhandle.Options{})
	if err != nil { return err }
	e.handle = h

	e.hdlr = &handler{
		handle:         h,
		queryTimeout:   e.cfg.QueryTimeout,
		enqueueTimeout: e.cfg.EnqueueTimeout,
		maxBytes:       e.cfg.MaxResultBytes,
		logger:         e.logger,
	}
	mux := http.NewServeMux()
	mux.Handle("/sql", e.hdlr)

	ln, err := net.Listen("tcp", e.cfg.Endpoint)
	if err != nil { return err }
	e.listener = ln
	e.srv = &http.Server{ Handler: mux, ReadHeaderTimeout: 5 * time.Second }
	go func() {
		if err := e.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			e.logger.Error("sqlhttp serve", zap.Error(err))
		}
	}()
	go e.probeReady()
	return nil
}

// probeReady polls the session until at least one known OTel table exists,
// then flips handler.ready. Runs until ctx/shutdown.
func (e *sqlExt) probeReady() {
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-e.stopCh:
			return
		case <-tick.C:
		}
		err := e.handle.Do(context.Background(), func(s chdbhandle.Session) error {
			r, err := s.Query("SELECT 1 FROM otel_logs LIMIT 1", "JSONEachRow")
			if err != nil { return err }
			r.Free()
			return nil
		})
		if err == nil {
			e.hdlr.ready.Store(true)
			return
		}
	}
}

func (e *sqlExt) Shutdown(ctx context.Context) error {
	close(e.stopCh)
	if e.srv != nil { _ = e.srv.Shutdown(ctx) }
	if e.handle != nil { e.handle.Close() }
	return nil
}
```

- [ ] **Step 5: Compile — expect failure because `handler` isn't defined yet**

```bash
go build ./...
```

Expected: FAIL. Handler lives in Task 3.3.

- [ ] **Step 6: Stub the handler so the module compiles**

Create `handler.go` with:

```go
package sqlhttp

import (
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

type handler struct {
	handle         *chdbhandle.Handle
	queryTimeout   time.Duration
	enqueueTimeout time.Duration
	maxBytes       int64
	logger         *zap.Logger
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}
```

- [ ] **Step 7: Write the README**

Create `collector/extension/sqlhttp/README.md`:

```markdown
# sqlhttp

A read-only HTTP gateway in front of the local chdb session. Serves
`POST /sql` on `127.0.0.1` with a `JSONEachRow` response body.

## Read-only by construction

Requests are filtered by a first-token allowlist (`SELECT`, `WITH`,
`EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`) and a single-statement guard —
any `;` outside literals rejects the request. See `lexer.go`.

## Query cancellation caveat

`chdb-go` has no cancel API today. Once dispatched to the worker, a
query runs to completion in native code, even if:

- the HTTP caller disconnects,
- the `query_timeout` fires (the handler returns 503 early, but the
  worker stays blocked),
- the extension is shutting down.

A pathological query can therefore hold the single worker goroutine for
tens of seconds, backing up the bounded queue and causing subsequent
requests to return `ErrQueueFull` → 503.

**Mitigation (caller-side):** add `LIMIT` aggressively, prefer narrow
`WHERE` clauses, and avoid unbounded `GROUP BY`. The `ai-instructions`
output emphasizes these practices to the AI consumer.

## Response limits

- Request body: 64 KiB of SQL text.
- Response body: `max_result_bytes` (default 16 MiB); exceeded → 413.

## Debug override

In debug builds only, the CLI honors `$EVERR_SQL_HTTP_ORIGIN` to point
at an arbitrary origin (used by integration tests). Release builds
ignore it.
```

- [ ] **Step 8: Compile & commit**

```bash
go build ./...
cd /Users/guidodorsi/workspace/everr
git add collector/extension/sqlhttp
git commit -m "sqlhttp: scaffold extension"
```

### Task 3.2: Read-only lexer

**Files:**
- Create: `collector/extension/sqlhttp/lexer.go`
- Create: `collector/extension/sqlhttp/lexer_test.go`

- [ ] **Step 1: Write failing tests**

```go
package sqlhttp

import (
	"errors"
	"testing"
)

func TestValidateReadOnly(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		want error
	}{
		{"select", "SELECT 1", nil},
		{"leading spaces", "   SELECT 1", nil},
		{"lowercase", "select 1", nil},
		{"with CTE", "WITH x AS (SELECT 1) SELECT * FROM x", nil},
		{"parenthesized union", "(SELECT 1) UNION (SELECT 2)", nil},
		{"explain", "EXPLAIN SELECT 1", nil},
		{"describe", "DESCRIBE otel_logs", nil},
		{"desc", "DESC otel_logs", nil},
		{"show", "SHOW TABLES", nil},
		{"leading line comment", "-- hi\nSELECT 1", nil},
		{"leading block comment", "/* hi */ SELECT 1", nil},
		{"trailing semi", "SELECT 1;", nil},
		{"trailing semi + comment", "SELECT 1; -- bye", nil},

		{"insert", "INSERT INTO t VALUES (1)", ErrNotReadOnly},
		{"create", "CREATE TABLE t (x Int32) ENGINE=MergeTree() ORDER BY x", ErrNotReadOnly},
		{"drop", "DROP TABLE t", ErrNotReadOnly},
		{"truncate", "TRUNCATE TABLE t", ErrNotReadOnly},
		{"alter", "ALTER TABLE t ADD COLUMN y Int32", ErrNotReadOnly},
		{"rename", "RENAME TABLE t TO u", ErrNotReadOnly},
		{"optimize", "OPTIMIZE TABLE t", ErrNotReadOnly},
		{"grant", "GRANT SELECT ON *.* TO u", ErrNotReadOnly},

		{"select; insert", "SELECT 1; INSERT INTO t VALUES (1)", ErrMultiStatement},
		{"select ; select", "SELECT 1 ; SELECT 2", ErrMultiStatement},
		{"semicolon in string is fine", "SELECT 'a;b'", nil},
		{"semicolon in line comment fine", "SELECT 1 -- ; stuff\n", nil},
		{"semicolon in block comment fine", "SELECT 1 /* ; stuff */", nil},
		{"escaped quote handled", `SELECT 'it\'s fine'`, nil},
		{"double-quoted ident with semi is fine", `SELECT "col;name" FROM t`, nil},

		{"empty", "", ErrEmpty},
		{"whitespace only", "   \n\t", ErrEmpty},
		{"comments only", "-- hi\n/* yo */", ErrEmpty},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateReadOnly(c.sql)
			if !errors.Is(err, c.want) {
				t.Fatalf("ValidateReadOnly(%q): got %v, want %v", c.sql, err, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run — expect fail**

```bash
cd /Users/guidodorsi/workspace/everr/collector/extension/sqlhttp
go test -run TestValidateReadOnly -v
```

Expected: FAIL (`ValidateReadOnly` undefined).

- [ ] **Step 3: Implement the lexer**

```go
package sqlhttp

import (
	"errors"
	"strings"
	"unicode"
)

var (
	ErrEmpty          = errors.New("sqlhttp: empty query")
	ErrNotReadOnly    = errors.New("sqlhttp: only SELECT/WITH/EXPLAIN/DESCRIBE/DESC/SHOW allowed")
	ErrMultiStatement = errors.New("sqlhttp: multi-statement queries are not allowed")
)

var allowedFirstTokens = map[string]struct{}{
	"SELECT": {}, "WITH": {}, "EXPLAIN": {}, "DESCRIBE": {}, "DESC": {}, "SHOW": {},
}

// ValidateReadOnly runs a single lexical pass over sql, skipping whitespace,
// block comments, line comments, single-quoted literals, and double-quoted
// identifiers. It returns:
//   - ErrEmpty       if the query has no non-comment/non-whitespace content
//   - ErrNotReadOnly if the first effective token (after an optional leading
//     '(' strip) isn't in the allowlist
//   - ErrMultiStatement if any ';' appears outside a literal/comment except
//     as the last effective token (trailing ';' is tolerated)
func ValidateReadOnly(sql string) error {
	l := &lexer{src: sql}
	l.skipLeading()

	// Strip any number of leading '(' — parenthesized SELECTs are valid
	// top-level statements in ClickHouse.
	for l.peek() == '(' {
		l.pos++
		l.skipLeading()
	}

	word := l.readWord()
	if word == "" { return ErrEmpty }
	if _, ok := allowedFirstTokens[strings.ToUpper(word)]; !ok {
		return ErrNotReadOnly
	}

	// Walk the rest looking for ';'. Track literals + comments so we ignore
	// them.
	for l.pos < len(l.src) {
		if err := l.stepForSemi(); err != nil { return err }
	}
	return nil
}

type lexer struct {
	src string
	pos int
}

// skipLeading consumes whitespace + line/block comments.
func (l *lexer) skipLeading() {
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		switch {
		case unicode.IsSpace(rune(c)):
			l.pos++
		case strings.HasPrefix(l.src[l.pos:], "--"):
			for l.pos < len(l.src) && l.src[l.pos] != '\n' { l.pos++ }
		case strings.HasPrefix(l.src[l.pos:], "/*"):
			l.pos += 2
			for l.pos+1 < len(l.src) && !(l.src[l.pos] == '*' && l.src[l.pos+1] == '/') {
				l.pos++
			}
			if l.pos+1 < len(l.src) { l.pos += 2 }
		default:
			return
		}
	}
}

func (l *lexer) peek() byte {
	if l.pos >= len(l.src) { return 0 }
	return l.src[l.pos]
}

func (l *lexer) readWord() string {
	start := l.pos
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) { break }
		l.pos++
	}
	return l.src[start:l.pos]
}

// stepForSemi advances one logical unit: whitespace, comment, literal, or
// bare character. Returns ErrMultiStatement if a semicolon appears before
// end-of-input (with trailing whitespace/comments tolerated).
func (l *lexer) stepForSemi() error {
	c := l.src[l.pos]
	switch {
	case strings.HasPrefix(l.src[l.pos:], "--"):
		for l.pos < len(l.src) && l.src[l.pos] != '\n' { l.pos++ }
	case strings.HasPrefix(l.src[l.pos:], "/*"):
		l.pos += 2
		for l.pos+1 < len(l.src) && !(l.src[l.pos] == '*' && l.src[l.pos+1] == '/') { l.pos++ }
		if l.pos+1 < len(l.src) { l.pos += 2 }
	case c == '\'':
		l.pos++
		for l.pos < len(l.src) {
			if l.src[l.pos] == '\\' && l.pos+1 < len(l.src) { l.pos += 2; continue }
			if l.src[l.pos] == '\'' { l.pos++; return nil }
			l.pos++
		}
	case c == '"':
		l.pos++
		for l.pos < len(l.src) && l.src[l.pos] != '"' { l.pos++ }
		if l.pos < len(l.src) { l.pos++ }
	case c == ';':
		// Check whether anything meaningful follows.
		l.pos++
		save := l.pos
		l.skipLeading()
		if l.pos >= len(l.src) { return nil } // trailing ';' OK
		l.pos = save
		return ErrMultiStatement
	default:
		l.pos++
	}
	return nil
}
```

- [ ] **Step 4: Run tests**

```bash
go test -run TestValidateReadOnly -v
```

Expected: PASS on every case. Fix any gaps — the list in Step 1 is the contract.

- [ ] **Step 5: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/extension/sqlhttp/lexer.go collector/extension/sqlhttp/lexer_test.go
git commit -m "sqlhttp: read-only lexer"
```

### Task 3.3: Request handler

**Files:**
- Modify: `collector/extension/sqlhttp/handler.go`
- Create: `collector/extension/sqlhttp/handler_test.go`

- [ ] **Step 1: Write failing handler tests with a fake handle**

```go
package sqlhttp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.uber.org/zap"
)

type fakeResult struct {
	buf        []byte
	freedCount *int // optional: set in tests that want to verify Free() was called
}

func (r fakeResult) Buf() []byte { return r.buf }
func (r fakeResult) Free() {
	if r.freedCount != nil { *r.freedCount++ }
}

// newTestHandler builds a handler where the handle field is never exercised;
// every test pins handler.exec to a user-supplied function so the chdbhandle
// dependency is not touched. This keeps the unit tests hermetic.
func newTestHandler() *handler {
	h := &handler{
		handle:         nil,
		queryTimeout:   5 * time.Second,
		enqueueTimeout: 2 * time.Second,
		maxBytes:       1 << 16,
		logger:         zap.NewNop(),
	}
	h.ready.Store(true) // bypass the readiness gate for unit tests
	return h
}

func TestHandlerReturns503BeforeReady(t *testing.T) {
	h := newTestHandler()
	h.ready.Store(false)
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("SELECT 1"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 503 { t.Fatalf("status %d", w.Code) }
	if w.Header().Get("Retry-After") != "1" {
		t.Fatalf("Retry-After: %q", w.Header().Get("Retry-After"))
	}
}

func TestHandlerHappyPath(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return []byte(`{"a":1}` + "\n"), nil
	}
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("SELECT 1"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 { t.Fatalf("status %d", w.Code) }
	if w.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("content-type: %q", w.Header().Get("Content-Type"))
	}
}

func TestHandlerReadOnlyViolation(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("INSERT INTO t VALUES (1)"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 400 { t.Fatalf("status %d", w.Code) }
}

func TestHandlerResultTooBig(t *testing.T) {
	h := newTestHandler()
	h.maxBytes = 4
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return []byte(`{"a":"way too long"}` + "\n"), nil
	}
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("SELECT 1"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 413 { t.Fatalf("status %d", w.Code) }
}

func TestHandlerQueueFullReturns503(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return nil, chdbhandle.ErrQueueFull
	}
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("SELECT 1"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 503 { t.Fatalf("status %d", w.Code) }
	if w.Header().Get("Retry-After") != "1" {
		t.Fatalf("Retry-After: %q", w.Header().Get("Retry-After"))
	}
}

func TestHandlerChdbError(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return nil, errors.New("column X not found")
	}
	req := httptest.NewRequest("POST", "/sql", strings.NewReader("SELECT 1"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 500 { t.Fatalf("status %d", w.Code) }
	body, _ := io.ReadAll(w.Body)
	if !bytes.Contains(body, []byte("column X not found")) {
		t.Fatalf("expected error envelope with chdb message, got %s", body)
	}
}
```

- [ ] **Step 2: Run — expect fail**

```bash
go test -run TestHandler -v
```

Expected: FAIL — handler is still the stub.

- [ ] **Step 3: Implement the real handler**

```go
package sqlhttp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

type handler struct {
	handle         *chdbhandle.Handle
	queryTimeout   time.Duration
	enqueueTimeout time.Duration
	maxBytes       int64
	logger         *zap.Logger

	// ready flips to 1 once a probe SELECT succeeds. Until then /sql returns
	// 503 with Retry-After: 1. See the Startup-ordering note above Task 3.1.
	ready atomic.Bool

	// exec is separated from handle so tests can inject a fake. Default is
	// (h *handler).execReal.
	exec func(ctx context.Context, sql string) ([]byte, error)
}

const maxRequestBody = 64 << 10 // 64 KiB SQL text

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.ready.Load() {
		w.Header().Set("Retry-After", "1")
		httpError(w, http.StatusServiceUnavailable, "collector starting")
		return
	}
	if r.Method != http.MethodPost {
		httpError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody+1))
	r.Body.Close()
	if err != nil {
		httpError(w, http.StatusBadRequest, fmt.Sprintf("read body: %v", err))
		return
	}
	if int64(len(body)) > maxRequestBody {
		httpError(w, http.StatusBadRequest, "SQL too large")
		return
	}
	sql := string(body)

	if err := ValidateReadOnly(sql); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}

	exec := h.exec
	if exec == nil { exec = h.execReal }

	ctx, cancel := context.WithTimeout(r.Context(), h.queryTimeout+h.enqueueTimeout)
	defer cancel()

	out, err := exec(ctx, sql)
	switch {
	case errors.Is(err, chdbhandle.ErrQueueFull):
		w.Header().Set("Retry-After", "1")
		httpError(w, http.StatusServiceUnavailable, "busy")
		return
	case errors.Is(err, context.DeadlineExceeded):
		w.Header().Set("Retry-After", "1")
		httpError(w, http.StatusServiceUnavailable, "timeout")
		return
	case err != nil:
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if int64(len(out)) > h.maxBytes {
		httpError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("result exceeded %d bytes; add LIMIT or narrow the WHERE", h.maxBytes))
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// execReal dispatches the SQL to the single-worker handle.
//
// CANCELLATION CAVEAT: chdb-go has no cancel API. Once the worker calls
// s.Query(sql, ...), the query runs to completion in native code — `queryTimeout`
// only causes *this function* to return early to the HTTP caller; the worker
// stays blocked until the native call returns. A pathological SELECT (e.g.
// full scan without LIMIT on a multi-GB table) will therefore:
//
//   1. Return 503 "timeout" to the user.
//   2. Continue holding the single worker goroutine until chdb finishes.
//   3. Cause subsequent Do() calls to back up in the bounded queue, and
//      eventually return ErrQueueFull → 503.
//
// Stage 0's concurrency spike explicitly stress-tests this scenario (see the
// --long-select flag) so we have empirical numbers for the worst case.
// Mitigation: the CLI docs and ai-instructions header tell users to add LIMIT
// aggressively and prefer narrow WHERE clauses. See the extension README.
func (h *handler) execReal(ctx context.Context, sql string) ([]byte, error) {
	enqueueCtx, cancel := context.WithTimeout(ctx, h.enqueueTimeout)
	defer cancel()

	var out []byte
	err := h.handle.Do(enqueueCtx, func(s chdbhandle.Session) error {
		qCtx, qCancel := context.WithTimeout(ctx, h.queryTimeout)
		defer qCancel()
		_ = qCtx // informational — chdb-go has no cancel API; see block comment above.

		r, err := s.Query(sql, "JSONEachRow")
		if err != nil { return err }
		defer r.Free() // chdb-purego memory is not Go-GC managed.

		if int64(len(r.Buf())) > h.maxBytes {
			return errResultTooBig
		}
		// Copy — r.Buf() is freed on function return.
		out = append(out[:0], r.Buf()...)
		return nil
	})
	return out, err
}

var errResultTooBig = errors.New("sqlhttp: result exceeded cap")

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
go test ./... -v
```

Expected: PASS on every handler and lexer test.

- [ ] **Step 5: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/extension/sqlhttp/handler.go collector/extension/sqlhttp/handler_test.go
git commit -m "sqlhttp: handler with read-only check + buffered response"
```

### Task 3.4: Wire `sqlhttp` into `manifest.local.yaml`

**Files:**
- Modify: `collector/config/manifest.local.yaml`

- [ ] **Step 1: Add the extension**

```yaml
extensions:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/extension/healthcheckextension v0.145.0
  - gomod: github.com/everr-labs/everr/collector/extension/sqlhttp v0.0.0-SNAPSHOT
    path: ./extension/sqlhttp
```

The `path:` directive points OCB at the local module so we don't need a separate release tag during development.

- [ ] **Step 2: Rebuild, run smoke test**

```bash
cd collector
make build-local
go test ./test/smoke/... -v
```

Expected: build succeeds; smoke test still passes (it doesn't use `/sql` yet).

- [ ] **Step 3: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/config/manifest.local.yaml
git commit -m "collector: register sqlhttp extension"
```

### Task 3.5: Integration test for `/sql` round-trip

**Files:**
- Modify: `collector/test/smoke/chdb_smoke_test.go`

- [ ] **Step 1: Extend the smoke test to POST `/sql`**

Append to `chdb_smoke_test.go`:

```go
func TestSQLHTTPRoundTrip(t *testing.T) {
	binary := resolveCollectorBinary(t)
	if _, err := os.Stat(binary); err != nil { t.Skipf("collector not built: %v", err) }

	tmp := t.TempDir()
	cfg := filepath.Join(tmp, "collector.yaml")
	writeConfigWithSQL(t, cfg, tmp)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--config", cfg)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil { t.Fatal(err) }
	t.Cleanup(func() { cancel(); cmd.Wait() })

	waitHealth(t, "http://127.0.0.1:54399/", 5*time.Second)

	logBody := []byte(`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"svc"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityText":"INFO","body":{"stringValue":"hello"}}]}]}]}`)
	resp, err := http.Post("http://127.0.0.1:54398/v1/logs", "application/json", bytes.NewReader(logBody))
	if err != nil { t.Fatal(err) }
	resp.Body.Close()

	time.Sleep(2 * time.Second)

	resp, err = http.Post("http://127.0.0.1:54320/sql", "text/plain",
		strings.NewReader(`SELECT count() AS c FROM otel_logs`))
	if err != nil { t.Fatal(err) }
	defer resp.Body.Close()
	if resp.StatusCode != 200 { t.Fatalf("sql status %d", resp.StatusCode) }
	body, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(body, []byte(`"c":1`)) {
		t.Fatalf("expected count=1, got %s", body)
	}

	// Read-only enforcement.
	resp, _ = http.Post("http://127.0.0.1:54320/sql", "text/plain",
		strings.NewReader(`INSERT INTO otel_logs VALUES (1)`))
	if resp.StatusCode != 400 { t.Fatalf("expected 400, got %d", resp.StatusCode) }
	resp.Body.Close()
}

func writeConfigWithSQL(t *testing.T, path, tmp string) {
	t.Helper()
	cfg := fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:54398
processors:
  batch:
    timeout: 500ms
exporters:
  chdb:
    path: %q
    ttl: 48h
extensions:
  health_check:
    endpoint: 127.0.0.1:54399
  sqlhttp:
    endpoint: 127.0.0.1:54320
    path: %q
service:
  extensions: [health_check, sqlhttp]
  pipelines:
    logs: { receivers: [otlp], processors: [batch], exporters: [chdb] }
`, filepath.Join(tmp, "chdb"), filepath.Join(tmp, "chdb"))
	if err := os.WriteFile(path, []byte(cfg), 0644); err != nil { t.Fatal(err) }
}
```

- [ ] **Step 2: Run**

```bash
cd collector
make build-local
go test ./test/smoke/... -run TestSQLHTTPRoundTrip -v
```

Expected: PASS (count=1, INSERT returns 400).

- [ ] **Step 3: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/test/smoke/chdb_smoke_test.go
git commit -m "test: /sql round-trip + read-only enforcement"
```

---

## Stage 4+5: Flip the template AND rewrite the CLI (single merge)

**Bundling rationale:** splitting these causes a window where `main` has the new template (no JSON files written) while the CLI still reads JSON files — `everr telemetry traces|logs` returns empty for everyone. Single merge keeps the CLI and its backing data coherent at every commit on `main`.

**Merge strategy (bisect hygiene):**

Internal task commits in this stage are *not* individually buildable — e.g. between Task 4.3 (template flipped → collector writes chdb, no JSON files) and Task 4.7 (old CLI modules deleted), intermediate `HEAD`s have the CLI compiled against `otlp.rs`/`store.rs`/`query.rs` pointing at data that no longer exists. `git bisect` would trip over them.

Two-part mitigation, both required:

1. **Squash-merge this PR.** Configure the PR with "Squash and merge" so `main` only ever sees one commit that spans `4.1 → 4.10`. The per-task commits below are for local review only.
2. **Advise `git bisect skip` on any stray range.** If a hotfix forks off one of the intermediate commits (e.g. someone locally branches mid-stage), add the range to `.git-blame-ignore-revs` and tell bisect runs to `git bisect skip <range>`. Document this in the PR description.

Per-task commits below remain as-is — they make each reviewer step small. The squash-merge collapses them at integration time.

### Task 4.1: `everr-core`: add `SQL_HTTP_PORT` and `sql_http_origin()`

**Files:**
- Modify: `crates/everr-core/src/build.rs`

- [ ] **Step 1: Write failing test**

Add to the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn sql_http_origin_matches_port() {
    let origin = super::sql_http_origin();
    assert!(origin.starts_with("http://127.0.0.1:"));
    let port: u16 = origin.rsplit(':').next().unwrap().parse().unwrap();
    assert_eq!(port, super::SQL_HTTP_PORT);
}
```

Run: `cargo test -p everr-core sql_http_origin`. Expected: FAIL (undefined).

- [ ] **Step 2: Add constants and function**

Below the existing port constants:

```rust
#[cfg(debug_assertions)]
pub const SQL_HTTP_PORT: u16 = 54320;

#[cfg(not(debug_assertions))]
pub const SQL_HTTP_PORT: u16 = 54420;

/// Origin for the local telemetry SQL HTTP endpoint served by the collector
/// sidecar's `sqlhttp` extension. The `everr telemetry` CLI targets this.
///
/// Task 4.9 extends this with a debug-only `EVERR_SQL_HTTP_ORIGIN` override.
pub fn sql_http_origin() -> String {
    format!("http://127.0.0.1:{SQL_HTTP_PORT}")
}
```

- [ ] **Step 3: Run test — expect pass**

```bash
cargo test -p everr-core
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/everr-core/src/build.rs
git commit -m "everr-core: expose SQL_HTTP_PORT and sql_http_origin"
```

### Task 4.2: Tauri ports re-export

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/telemetry/ports.rs`

- [ ] **Step 1: Add `SQL_HTTP_PORT` to the re-export**

```rust
pub use everr_core::build::{HEALTHCHECK_PORT, OTLP_HTTP_PORT, SQL_HTTP_PORT};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/desktop-app/src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add packages/desktop-app/src-tauri/src/telemetry/ports.rs
git commit -m "tauri: re-export SQL_HTTP_PORT"
```

### Task 4.3: Flip `collector.yaml.tmpl`

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/telemetry/collector.yaml.tmpl`
- Modify: `packages/desktop-app/src-tauri/src/telemetry/sidecar.rs`

- [ ] **Step 1: Replace the template body**

New content:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:{OTLP_PORT}

processors:
  batch:
    timeout: 1s
    send_batch_size: 512

exporters:
  chdb:
    path: "{TELEMETRY_DIR}/chdb"
    ttl: 48h

extensions:
  health_check:
    endpoint: 127.0.0.1:{HEALTH_PORT}
  sqlhttp:
    endpoint: 127.0.0.1:{SQL_HTTP_PORT}
    path: "{TELEMETRY_DIR}/chdb"

service:
  extensions: [health_check, sqlhttp]
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [chdb] }
    logs:    { receivers: [otlp], processors: [batch], exporters: [chdb] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [chdb] }
  telemetry:
    metrics:
      level: none
    logs:
      level: warn
```

- [ ] **Step 2: Extend `render_config` with the new placeholder**

In `sidecar.rs`, find `fn render_config` and change to:

```rust
fn render_config(telemetry_dir: &Path) -> String {
    CONFIG_TEMPLATE
        .replace("{OTLP_PORT}", &OTLP_HTTP_PORT.to_string())
        .replace("{HEALTH_PORT}", &HEALTHCHECK_PORT.to_string())
        .replace("{SQL_HTTP_PORT}", &SQL_HTTP_PORT.to_string())
        .replace("{TELEMETRY_DIR}", &telemetry_dir.display().to_string())
}
```

Also add `SQL_HTTP_PORT` to the existing `use` line:

```rust
use crate::telemetry::ports::{HEALTHCHECK_PORT, OTLP_HTTP_PORT, SQL_HTTP_PORT};
```

- [ ] **Step 3: Delete the orphaned-collector guard's stale port reference**

The existing `kill_orphaned_collector()` uses `HEALTHCHECK_PORT`. Leave unchanged — the health port is still a good anchor.

- [ ] **Step 4: Verify compile**

```bash
cd packages/desktop-app/src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add packages/desktop-app/src-tauri/src/telemetry/collector.yaml.tmpl
git add packages/desktop-app/src-tauri/src/telemetry/sidecar.rs
git commit -m "tauri: collector config uses chdb exporter and sqlhttp extension"
```

### Task 4.4: CLI cli.rs — new surface

**Files:**
- Modify: `packages/desktop-app/src-cli/src/cli.rs`

- [ ] **Step 1: Replace `TelemetrySubcommand` enum**

Remove `Traces(TelemetryQueryArgs)`, `Logs(TelemetryLogsArgs)`, and the entire `TelemetryLogsArgs` struct. Remove all filter flags from `TelemetryQueryArgs`. Replace the telemetry subtree with:

```rust
#[derive(Subcommand, Debug)]
pub enum TelemetrySubcommand {
    /// Run a SQL query against local telemetry.
    Query(TelemetryQueryArgs),
    /// Print the local collector's OTLP and SQL endpoints.
    Endpoint,
    /// Print AI-oriented guidance for `everr telemetry`.
    #[command(name = "ai-instructions")]
    AiInstructions,
}

#[derive(Args, Debug, Default)]
pub struct TelemetryQueryArgs {
    /// The SQL query to run. Keep it in quotes. Include LIMIT yourself; the
    /// CLI does not inject one.
    pub sql: String,
    /// Output format. Default: table on TTY, ndjson otherwise.
    #[arg(long, value_enum)]
    pub format: Option<TelemetryFormat>,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub enum TelemetryFormat {
    Json,
    Ndjson,
    Table,
}
```

- [ ] **Step 2: Compile — expect errors in `commands.rs`**

```bash
cd packages/desktop-app/src-cli
cargo check
```

Expected: errors at `commands.rs` call sites. Those are fixed in Task 4.6.

- [ ] **Step 3: Commit the cli surface change only after Tasks 4.5 + 4.6 compile**

Defer the commit to the end of Task 4.6.

### Task 4.5: Build `client.rs`

**Files:**
- Create: `packages/desktop-app/src-cli/src/telemetry/client.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/mod.rs`

- [ ] **Step 1: Replace `mod.rs` exports**

```rust
pub mod client;
pub mod commands;
pub mod sibling;
```

(`otlp`, `store`, `query` are deleted in Task 4.7.)

- [ ] **Step 2: Write failing client unit test**

Create `client.rs`:

```rust
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::Value;

pub struct Rows {
    pub values: Vec<Value>,
}

pub struct QueryClient {
    origin: String,
    http: Client,
}

impl QueryClient {
    pub fn new(origin: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self { origin, http }
    }

    /// Run a SQL query. Retries once on 503 after the server's Retry-After.
    pub fn query(&self, sql: &str) -> Result<Rows> {
        let url = format!("{}/sql", self.origin);
        let mut attempt = 0;
        loop {
            let resp = self.http.post(&url)
                .header("content-type", "text/plain")
                .body(sql.to_string())
                .send()
                .with_context(|| format!("POST {url}"))?;

            let status = resp.status();
            if status == StatusCode::SERVICE_UNAVAILABLE && attempt == 0 {
                let retry = resp.headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(1);
                std::thread::sleep(Duration::from_secs(retry));
                attempt += 1;
                continue;
            }

            let body = resp.text().unwrap_or_default();
            return match status {
                StatusCode::OK => parse_ndjson(&body),
                StatusCode::SERVICE_UNAVAILABLE =>
                    bail!("telemetry collector is busy — try again in a moment"),
                StatusCode::BAD_REQUEST | StatusCode::INTERNAL_SERVER_ERROR
                | StatusCode::PAYLOAD_TOO_LARGE => Err(anyhow!("{}", pass_through(&body))),
                other => Err(anyhow!("unexpected status {other}: {body}")),
            };
        }
    }
}

fn parse_ndjson(body: &str) -> Result<Rows> {
    let mut values = Vec::new();
    for line in body.lines() {
        if line.is_empty() { continue; }
        values.push(serde_json::from_str(line)
            .with_context(|| format!("parse row: {line}"))?);
    }
    Ok(Rows { values })
}

fn pass_through(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = v.get("error").and_then(|e| e.as_str()) {
            return msg.to_string();
        }
    }
    body.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[test]
    fn query_parses_ndjson_rows() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(POST).path("/sql");
            then.status(200)
                .header("content-type", "application/x-ndjson")
                .body(r#"{"a":1}
{"a":2}"#);
        });
        let cli = QueryClient::new(server.base_url());
        let rows = cli.query("SELECT *").unwrap();
        assert_eq!(rows.values.len(), 2);
        assert_eq!(rows.values[0].get("a").unwrap(), &Value::Number(1.into()));
    }

    #[test]
    fn query_surfaces_error_envelope() {
        let server = MockServer::start();
        let _m = server.mock(|when, then| {
            when.method(POST).path("/sql");
            then.status(400).body(r#"{"error":"bad sql"}"#);
        });
        let cli = QueryClient::new(server.base_url());
        let err = cli.query("bogus").unwrap_err();
        assert!(err.to_string().contains("bad sql"));
    }

    #[test]
    fn query_retries_once_on_503() {
        let server = MockServer::start();
        let _m1 = server.mock(|when, then| {
            when.method(POST).path("/sql");
            then.status(503).header("retry-after", "0");
        });
        let cli = QueryClient::new(server.base_url());
        let err = cli.query("SELECT 1").unwrap_err();
        assert!(err.to_string().contains("busy"));
    }
}
```

- [ ] **Step 3: Add `httpmock` to dev-dependencies**

In `packages/desktop-app/src-cli/Cargo.toml`:

```toml
[dev-dependencies]
httpmock = "0.7"
```

Compatibility check: the crate already pulls in `reqwest 0.12` (with `blocking` feature). `httpmock 0.7` uses `hyper 1.x` internally, which is the same major as `reqwest 0.12`. If `cargo update` surfaces a conflict, fall back to hand-rolling a mock server with `std::net::TcpListener` + a tiny accept loop in `tests/support/mock_server.rs`. Do this only if `httpmock` breaks — it's the fallback, not the plan.

Also inspect `tests/support/mod.rs` for existing HTTP-mock helpers; if there's already a shared harness for the `api-commands` tests, reuse it instead of adding `httpmock`.

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop-app/src-cli
cargo test --lib telemetry::client
```

Expected: PASS.

### Task 4.6: Rewrite `commands.rs`

**Files:**
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs`

- [ ] **Step 1: Replace the whole file**

```rust
use std::io::{self, IsTerminal};

use anyhow::{Context, Result};
use serde_json::Value;

use crate::cli::{TelemetryArgs, TelemetryFormat, TelemetryQueryArgs, TelemetrySubcommand};
use crate::telemetry::client::{QueryClient, Rows};
use crate::telemetry::sibling;

pub fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Query(q) => run_query(q),
        TelemetrySubcommand::Endpoint => run_endpoint(),
        TelemetrySubcommand::AiInstructions => run_ai_instructions(),
    }
}

fn run_endpoint() -> Result<()> {
    println!("{}", everr_core::build::otlp_http_origin());
    println!("{}", everr_core::build::sql_http_origin());
    Ok(())
}

fn run_ai_instructions() -> Result<()> {
    print!("{}", everr_core::assistant::render_telemetry_ai_instructions());
    Ok(())
}

fn run_query(args: TelemetryQueryArgs) -> Result<()> {
    sibling::maybe_emit_banner();

    let client = QueryClient::new(everr_core::build::sql_http_origin());

    let rows = match client.query(&args.sql) {
        Ok(rows) => rows,
        Err(err) => {
            // Use reqwest's structured error flag rather than string-matching
            // the message (which is OS-localized and has changed across
            // reqwest versions). `is_connect()` returns true for any failure
            // during connection establishment — refused, unreachable, TLS, etc.
            // — which is exactly the "sidecar not up" case we want to catch.
            if let Some(source) = err.downcast_ref::<reqwest::Error>() {
                if source.is_connect() {
                    eprintln!("telemetry collector isn't running — start the Everr desktop app");
                    std::process::exit(2);
                }
            }
            return Err(err).context("query failed");
        }
    };

    let fmt = args.format.unwrap_or_else(|| {
        if io::stdout().is_terminal() { TelemetryFormat::Table } else { TelemetryFormat::Ndjson }
    });
    render(&rows, fmt);
    Ok(())
}

fn render(rows: &Rows, fmt: TelemetryFormat) {
    match fmt {
        TelemetryFormat::Ndjson => {
            for row in &rows.values {
                println!("{}", serde_json::to_string(row).unwrap());
            }
        }
        TelemetryFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&rows.values).unwrap());
        }
        TelemetryFormat::Table => render_table(rows),
    }
}

fn render_table(rows: &Rows) {
    let Some(first) = rows.values.first() else {
        println!("(no rows)");
        return;
    };
    let cols: Vec<&str> = first.as_object().map(|m| m.keys().map(String::as_str).collect())
        .unwrap_or_default();
    if cols.is_empty() { println!("(rows are not objects)"); return; }

    println!("{}", cols.join(" | "));
    for row in &rows.values {
        let cells: Vec<String> = cols.iter().map(|k| {
            row.get(*k).map(value_to_cell).unwrap_or_default()
        }).collect();
        println!("{}", cells.join(" | "));
    }
}

fn value_to_cell(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}
```

- [ ] **Step 2: Compile**

```bash
cd packages/desktop-app/src-cli
cargo check
```

Expected: no errors. If sibling detection isn't yet in place, the call site will fail — that's Task 4.7.

- [ ] **Step 3: Commit Tasks 4.4 + 4.5 + 4.6 together**

```bash
cd /Users/guidodorsi/workspace/everr
git add packages/desktop-app/src-cli/src/cli.rs
git add packages/desktop-app/src-cli/src/telemetry/client.rs
git add packages/desktop-app/src-cli/src/telemetry/mod.rs
git add packages/desktop-app/src-cli/src/telemetry/commands.rs
git add packages/desktop-app/src-cli/Cargo.toml
git commit -m "cli: rewrite telemetry around sqlhttp"
```

### Task 4.7: Sibling-staleness detection via `.last_flush`

**Files:**
- Create: `packages/desktop-app/src-cli/src/telemetry/sibling.rs`
- Delete: `packages/desktop-app/src-cli/src/telemetry/otlp.rs`
- Delete: `packages/desktop-app/src-cli/src/telemetry/store.rs`
- Delete: `packages/desktop-app/src-cli/src/telemetry/query.rs`

- [ ] **Step 1: Write failing unit test**

```rust
// packages/desktop-app/src-cli/src/telemetry/sibling.rs
use std::path::Path;
use std::time::{Duration, SystemTime};

const STALE_SIBLING_THRESHOLD: Duration = Duration::from_secs(5 * 60);

fn last_flush(dir: &Path) -> Option<SystemTime> {
    std::fs::metadata(dir.join("chdb/.last_flush")).ok()?.modified().ok()
}

/// Emits the sibling-staleness banner to stderr if the OTHER build's
/// `.last_flush` is newer than this build's by more than STALE_SIBLING_THRESHOLD.
///
/// Under the chdb architecture, "switching" to the sibling's data means
/// talking to the sibling's collector process (its SQL endpoint lives on a
/// different port). There is no `--telemetry-dir` flag anymore — the CLI
/// always targets its own build's sidecar. The banner's action for the user
/// is: run the OTHER build of the desktop app (and, optionally, use its
/// matching `everr` CLI).
pub fn maybe_emit_banner() {
    let this = match everr_core::build::telemetry_dir() { Ok(d) => d, Err(_) => return };
    let sibling = match everr_core::build::telemetry_dir_sibling() { Ok(d) => d, Err(_) => return };
    let (Some(t), Some(s)) = (last_flush(&this), last_flush(&sibling)) else { return };
    if let Ok(delta) = s.duration_since(t) {
        if delta > STALE_SIBLING_THRESHOLD {
            eprintln!(
                "heads-up: the {} Everr build wrote data {}s more recently than this one ({}). \
                 You're probably querying the wrong sidecar — switch desktop-app builds.",
                sibling_label(), delta.as_secs(), this.display(),
            );
        }
    }
}

/// Returns "release" when running in debug and vice versa — used to tell the
/// user which other build wrote more recent telemetry.
#[cfg(debug_assertions)]
fn sibling_label() -> &'static str { "release" }
#[cfg(not(debug_assertions))]
fn sibling_label() -> &'static str { "debug" }

#[cfg(test)]
mod tests {
    use super::last_flush;
    use std::fs;
    use std::time::SystemTime;

    #[test]
    fn last_flush_returns_none_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(last_flush(dir.path()).is_none());
    }

    #[test]
    fn last_flush_reads_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let chdb = dir.path().join("chdb");
        fs::create_dir(&chdb).unwrap();
        fs::write(chdb.join(".last_flush"), b"").unwrap();
        let t = last_flush(dir.path()).unwrap();
        assert!(t <= SystemTime::now());
    }
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
cd packages/desktop-app/src-cli
cargo test --lib telemetry::sibling
```

Expected: PASS.

- [ ] **Step 3: Delete the old modules and any tests that import them**

```bash
cd packages/desktop-app/src-cli
git rm src/telemetry/otlp.rs src/telemetry/store.rs src/telemetry/query.rs
git rm tests/telemetry_store.rs tests/telemetry_commands.rs
```

`tests/telemetry_store.rs` imports `use everr_cli::telemetry::{query, store}` — compilation fails the moment those modules are gone. `tests/telemetry_commands.rs` drives the removed `traces`/`logs` subcommands. The new coverage lives in `client.rs` unit tests and `tests/telemetry_query_e2e.rs`; no rewrite needed.

Also inspect `packages/desktop-app/src-cli/tests/support/mod.rs` — if it exposes any helper referencing `telemetry::otlp/store/query`, prune those exports:

```bash
grep -n "telemetry::" packages/desktop-app/src-cli/tests/support/mod.rs
```

Delete or rewire any hit.

- [ ] **Step 4: Verify full CLI build**

```bash
cd packages/desktop-app/src-cli
cargo build
cargo test
```

Expected: builds and all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add packages/desktop-app/src-cli/src/telemetry/sibling.rs
git add packages/desktop-app/src-cli/src/telemetry
git commit -m "cli: sibling-staleness via .last_flush; drop legacy modules"
```

### Task 4.8: `.last_flush` sentinel in the exporter

**Files:**
- Modify: `chdbexporter/exporter.go` (in the fork repo)

- [ ] **Step 1: Restructure each `push*` function to capture err, then touch the sentinel**

Task 1.3 Step 4 wrote each push as a single `return e.h.Do(...)` expression. Rewrite them to bind the result before returning, so the sentinel touch can happen on success:

```go
func (e *chdbExporter) pushTraces(ctx context.Context, td ptrace.Traces) error {
    rows := marshalTraces(td, e.cfg)
    if len(rows) == 0 { return nil }

    var body strings.Builder
    body.WriteString(e.insertSQLTraces)
    for _, r := range rows {
        b, _ := json.Marshal(r)
        body.Write(b)
        body.WriteByte('\n')
    }

    err := e.h.Do(ctx, func(s chdbhandle.Session) error {
        r, err := s.Query(body.String(), "")
        if err != nil { return err }
        r.Free()
        return nil
    })
    if err == nil {
        _ = touchSentinel(e.cfg.Path)
    }
    return err
}
```

Apply the same pattern to `pushLogs` and every `pushMetrics*` — the sentinel reflects "we committed *some* data to chdb recently," so every signal touches it.

Where `touchSentinel` is:

```go
// touchSentinel updates .last_flush so the CLI sibling-staleness check sees
// that this build is actively writing. The file lives inside the chdb data
// directory: {telemetry_dir}/chdb/.last_flush (cfg.Path IS {telemetry_dir}/chdb).
func touchSentinel(path string) error {
    p := filepath.Join(path, ".last_flush")
    // os.WriteFile opens, writes (zero bytes), and closes in one call — no
    // lingering FD. Then Chtimes bumps mtime to "now" for the staleness check.
    if err := os.WriteFile(p, nil, 0644); err != nil { return err }
    now := time.Now()
    return os.Chtimes(p, now, now)
}
```

- [ ] **Step 2: Unit test the sentinel updates**

Extend `exporter_logs_test.go`:

```go
func TestPushLogsTouchesSentinel(t *testing.T) {
	cfg := &Config{Path: t.TempDir(), TTL: 48 * time.Hour}
	ex, err := newExporter(cfg, exportertest.NewNopSettings(exportertest.NopType))
	if err != nil { t.Fatal(err) }
	if err := ex.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	ld := plog.NewLogs()
	rs := ld.ResourceLogs().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc")
	rec := rs.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	rec.Body().SetStr("hello")

	before := time.Now().Add(-time.Second)
	if err := ex.pushLogs(context.Background(), ld); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(cfg.Path, ".last_flush"))
	if err != nil { t.Fatalf("sentinel missing: %v", err) }
	if info.ModTime().Before(before) {
		t.Fatalf("sentinel mtime %v older than %v", info.ModTime(), before)
	}
}
```

Expected: PASS.

- [ ] **Step 3: Tag a new fork release (`v0.2.0`) and bump `manifest.local.yaml`**

```bash
cd ~/workspace/chdbexporter
git commit -am "exporter: touch .last_flush sentinel after each batch"
git tag v0.2.0
```

Update the everr repo's `collector/config/manifest.local.yaml` to `v0.2.0` and rebuild:

```bash
cd /Users/guidodorsi/workspace/everr/collector
make build-local
```

- [ ] **Step 4: Commit the bump**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/config/manifest.local.yaml
git commit -m "collector: bump chdbexporter to v0.2.0 (sentinel)"
```

### Task 4.9: CLI e2e test

**Files:**
- Create: `packages/desktop-app/src-cli/tests/telemetry_query_e2e.rs`
- Delete: `packages/desktop-app/src-cli/tests/telemetry_e2e.rs`

- [ ] **Step 1: Write the e2e test**

```rust
use std::process::Command;
use std::time::Duration;

// Boots the collector sidecar on random ports, pushes one OTLP log,
// then runs `everr-dev telemetry query` and asserts the row appears.
//
// Gated on presence of the built collector binary (see smoke test).
#[test]
fn telemetry_query_happy_path() {
    let Some(binary) = resolve_collector_binary() else { return };
    let dir = tempfile::tempdir().unwrap();

    let otlp_port = pick_free_port();
    let sql_port = pick_free_port();
    let health_port = pick_free_port();
    let cfg = dir.path().join("collector.yaml");
    std::fs::write(&cfg, format!(
        r#"
receivers: {{ otlp: {{ protocols: {{ http: {{ endpoint: "127.0.0.1:{otlp_port}" }} }} }} }}
processors: {{ batch: {{ timeout: 500ms }} }}
exporters: {{ chdb: {{ path: "{dir}/chdb", ttl: 48h }} }}
extensions:
  health_check: {{ endpoint: "127.0.0.1:{health_port}" }}
  sqlhttp: {{ endpoint: "127.0.0.1:{sql_port}", path: "{dir}/chdb" }}
service:
  extensions: [health_check, sqlhttp]
  pipelines:
    logs: {{ receivers: [otlp], processors: [batch], exporters: [chdb] }}
"#, otlp_port = otlp_port, sql_port = sql_port, health_port = health_port,
    dir = dir.path().display()
    )).unwrap();

    let mut child = Command::new(&binary)
        .arg("--config").arg(&cfg)
        .spawn().unwrap();
    let _guard = KillOnDrop(&mut child);

    wait_http(&format!("http://127.0.0.1:{health_port}/"), Duration::from_secs(5));

    // Push an OTLP log.
    push_log(otlp_port);

    std::thread::sleep(Duration::from_secs(2));

    // Invoke the CLI with a pinned SQL origin via env.
    let cli = target_binary("everr-dev");
    let out = Command::new(&cli)
        .env("EVERR_SQL_HTTP_ORIGIN", format!("http://127.0.0.1:{sql_port}"))
        .args(["telemetry", "query", "SELECT count() AS c FROM otel_logs", "--format", "ndjson"])
        .output().unwrap();
    assert!(out.status.success(), "cli exit: {:?}", out);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("\"c\":1"), "stdout: {stdout}");
}

fn pick_free_port() -> u16 {
    let sock = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    sock.local_addr().unwrap().port()
}

fn wait_http(url: &str, deadline: Duration) {
    let start = std::time::Instant::now();
    while start.elapsed() < deadline {
        if reqwest::blocking::get(url).map(|r| r.status().is_success()).unwrap_or(false) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timed out waiting for {url}");
}

fn push_log(otlp_port: u16) {
    let body = r#"{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"svc"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityText":"INFO","body":{"stringValue":"hello"}}]}]}]}"#;
    reqwest::blocking::Client::new()
        .post(format!("http://127.0.0.1:{otlp_port}/v1/logs"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
}

fn resolve_collector_binary() -> Option<std::path::PathBuf> {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../collector/build-local/everr-local-collector");
    p.exists().then_some(p)
}

fn target_binary(name: &str) -> std::path::PathBuf {
    // CARGO_BIN_EXE_<name> is set by cargo for integration tests in the same
    // crate as the binary. Otherwise fall back to the target/debug dir.
    let env_key = format!("CARGO_BIN_EXE_{}", name.replace('-', "_"));
    if let Ok(p) = std::env::var(&env_key) {
        return std::path::PathBuf::from(p);
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/debug")
        .join(name)
}

struct KillOnDrop<'a>(&'a mut std::process::Child);
impl Drop for KillOnDrop<'_> {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
```

- [ ] **Step 2: Support the `EVERR_SQL_HTTP_ORIGIN` override**

In `crates/everr-core/src/build.rs`, update `sql_http_origin()`:

```rust
/// Origin for the local telemetry SQL HTTP endpoint served by the collector
/// sidecar's `sqlhttp` extension.
///
/// In debug builds (everr-dev, cargo test, cargo tauri dev), the
/// `EVERR_SQL_HTTP_ORIGIN` environment variable overrides the default so
/// integration tests can target a random port. Release builds ignore it.
/// This override is **not** a user-facing feature — do not document it.
pub fn sql_http_origin() -> String {
    #[cfg(debug_assertions)]
    if let Ok(origin) = std::env::var("EVERR_SQL_HTTP_ORIGIN") {
        return origin;
    }
    format!("http://127.0.0.1:{SQL_HTTP_PORT}")
}
```

- [ ] **Step 3: Run**

```bash
cd packages/desktop-app/src-cli
cargo test --test telemetry_query_e2e -- --nocapture
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git rm packages/desktop-app/src-cli/tests/telemetry_e2e.rs
git add packages/desktop-app/src-cli/tests/telemetry_query_e2e.rs
git add crates/everr-core/src/build.rs
git commit -m "cli: e2e query against live collector"
```

### Task 4.10: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the break-note**

At the top of `CHANGELOG.md`:

```markdown
## Unreleased

### Breaking changes — `everr telemetry`

- **Removed:** `everr telemetry traces` and `everr telemetry logs`, along with
  every filter flag: `--service`, `--level`, `--trace-id`, `--from`, `--to`,
  `--attr`, `--name`, `--egrep`, `--target`.
- **New:** `everr telemetry query "<SQL>"` — passes SQL to the collector's
  `/sql` endpoint. See `everr telemetry ai-instructions` for the schema.
- **Migration:** every previous invocation maps to a SQL query. Examples:
  - `telemetry logs --level ERROR --from now-1h` →
    `telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 200"`
  - `telemetry traces --service X --trace-id abc` →
    `telemetry query "SELECT * FROM otel_traces WHERE ServiceName='X' AND TraceId='abc' LIMIT 50"`
- **Compatibility:** existing shell aliases and scripts must be updated. The
  local telemetry directory's on-disk format has changed; previous
  `otlp-*.json` files are ignored (not migrated).
- **`--telemetry-dir` removed:** previously `everr telemetry <subcommand>` took
  `--telemetry-dir <path>` to read from an arbitrary data directory. The new
  CLI targets its own build's collector sidecar by HTTP, so a path on disk
  isn't meaningful. The sibling-staleness banner now tells you which desktop
  build to run, rather than which directory to pass.
- **Installer size:** the collector sidecar grows by ~120 MB for the shipped
  universal macOS binary (~60 MB per architecture × 2, x86_64 + arm64), due
  to the bundled `libchdb`.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "changelog: document telemetry CLI break"
```

---

## Stage 6: `ai-instructions` generator + drift CI

### Task 6.1: Build the generator

**Files:**
- Create: `collector/cmd/genaischema/main.go`

We deliberately avoid parsing `SHOW CREATE TABLE` output. CODEC clauses, `Map(LowCardinality(String), String)`, and other nested types make the DDL syntax hostile to quick-and-dirty regex parsing. Instead we issue `DESCRIBE TABLE <name>` (the `/sql` handler forces the `JSONEachRow` output format server-side) — ClickHouse returns one row per column with clean `name`/`type` fields, and we render those directly as markdown.

- [ ] **Step 1: Write failing test for the renderer**

Create `collector/cmd/genaischema/render_test.go`:

```go
package main

import "testing"

func TestRenderTableEmitsMarkdownTable(t *testing.T) {
	cols := []Column{
		{Name: "Timestamp", Type: "DateTime64(9)"},
		{Name: "Attributes", Type: "Map(LowCardinality(String), String)"},
		{Name: "SeverityText", Type: "LowCardinality(String)"},
	}
	got := RenderTable("otel_logs", cols)
	want := `## otel_logs

| column | type |
|---|---|
| Timestamp | DateTime64(9) |
| Attributes | Map(LowCardinality(String), String) |
| SeverityText | LowCardinality(String) |
`
	if got != want { t.Fatalf("diff:\nGOT:\n%s\nWANT:\n%s", got, want) }
}
```

- [ ] **Step 2: Implement `RenderTable` + `Column`**

Create `collector/cmd/genaischema/render.go`:

```go
package main

import (
	"fmt"
	"strings"
)

// Column is one row from DESCRIBE TABLE FORMAT JSONEachRow.
// Extra fields (default_type, default_expression, comment, codec_expression,
// ttl_expression) are ignored by design — the AI only needs name + type.
type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func RenderTable(name string, cols []Column) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## %s\n\n| column | type |\n|---|---|\n", name)
	for _, c := range cols {
		fmt.Fprintf(&b, "| %s | %s |\n", c.Name, c.Type)
	}
	return b.String()
}
```

- [ ] **Step 3: Run — expect pass**

```bash
cd collector/cmd/genaischema
go test -v
```

Expected: PASS.

- [ ] **Step 4: Write `main.go`**

The generator avoids importing the fork — OCB components are pulled in via `manifest.local.yaml`, not as direct Go dependencies of the everr repo. Instead, it boots the already-built `everr-local-collector` against a tmpdir config, waits for `/sql` readiness, then issues `DESCRIBE TABLE <name> FORMAT JSONEachRow` over HTTP for each table.

```go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var tables = []string{
	"otel_traces",
	"otel_logs",
	"otel_metrics_sum",
	"otel_metrics_gauge",
	"otel_metrics_histogram",
	"otel_metrics_exponential_histogram",
	"otel_metrics_summary",
}

func main() {
	out := flag.String("out", "", "output file")
	binary := flag.String("binary", "collector/build-local/everr-local-collector",
		"path to everr-local-collector")
	flag.Parse()
	if *out == "" { log.Fatal("--out required") }
	if _, err := os.Stat(*binary); err != nil { log.Fatalf("binary: %v", err) }

	dir, err := os.MkdirTemp("", "gen-ai-schema-*")
	if err != nil { log.Fatal(err) }
	defer os.RemoveAll(dir)

	cfgPath := filepath.Join(dir, "collector.yaml")
	writeGenConfig(cfgPath, dir)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, *binary, "--config", cfgPath)
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Start(); err != nil { log.Fatal(err) }
	defer cmd.Wait()

	// Push one OTLP log to trigger DDL + populate the ready probe.
	waitHealth("http://127.0.0.1:54399/", 10*time.Second)
	pokeOTLP("http://127.0.0.1:54398/v1/logs")
	waitReady("http://127.0.0.1:54397/sql", 10*time.Second)

	var b strings.Builder
	b.WriteString("# Local telemetry schema\n\n")
	for _, t := range tables {
		cols, err := describe("http://127.0.0.1:54397/sql", t)
		if err != nil { log.Fatalf("%s: %v", t, err) }
		b.WriteString(RenderTable(t, cols))
		b.WriteString("\n")
	}
	if err := os.WriteFile(*out, []byte(b.String()), 0644); err != nil { log.Fatal(err) }
}

func writeGenConfig(path, dir string) {
	// Ports 54397/54398/54399 are chosen to NOT collide with the desktop-app
	// collector sidecar. Debug sidecar uses 54318/54319/54320; release uses
	// 54418/54419/54420 (see crates/everr-core/src/build.rs). Running the
	// generator against a live sidecar would otherwise fail on bind.
	cfg := fmt.Sprintf(`
receivers: { otlp: { protocols: { http: { endpoint: "127.0.0.1:54398" } } } }
processors: { batch: { timeout: 100ms } }
exporters: { chdb: { path: %q, ttl: 48h } }
extensions:
  health_check: { endpoint: "127.0.0.1:54399" }
  sqlhttp: { endpoint: "127.0.0.1:54397", path: %q }
service:
  extensions: [health_check, sqlhttp]
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [chdb] }
    logs:    { receivers: [otlp], processors: [batch], exporters: [chdb] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [chdb] }
`, filepath.Join(dir, "chdb"), filepath.Join(dir, "chdb"))
	if err := os.WriteFile(path, []byte(cfg), 0644); err != nil { log.Fatal(err) }
}

func waitHealth(url string, d time.Duration) {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if r, err := http.Get(url); err == nil && r.StatusCode == 200 { r.Body.Close(); return }
		time.Sleep(100 * time.Millisecond)
	}
	log.Fatalf("health timeout: %s", url)
}

func waitReady(sqlURL string, d time.Duration) {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		r, _ := http.Post(sqlURL, "text/plain", strings.NewReader("SELECT 1"))
		if r != nil {
			r.Body.Close()
			if r.StatusCode == 200 { return }
		}
		time.Sleep(250 * time.Millisecond)
	}
	log.Fatalf("sqlhttp never became ready: %s", sqlURL)
}

func pokeOTLP(url string) {
	body := []byte(`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"gen"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityText":"INFO","body":{"stringValue":"hi"}}]}]}]}`)
	for _, p := range []string{"/v1/logs", "/v1/traces", "/v1/metrics"} {
		_, _ = http.Post(strings.Replace(url, "/v1/logs", p, 1), "application/json",
			strings.NewReader(string(body)))
	}
}

// describe runs `DESCRIBE TABLE <name>` via the /sql endpoint and parses the
// JSONEachRow body — one JSON object per line, each with name + type fields.
// This is vastly more robust than parsing SHOW CREATE TABLE output, which
// contains CODECs, nested types with commas (Map(LowCardinality(String), ...)),
// and ENGINE clauses that a naive regex can't handle.
func describe(sqlURL, table string) ([]Column, error) {
	r, err := http.Post(sqlURL, "text/plain",
		strings.NewReader(fmt.Sprintf("DESCRIBE TABLE %s", table)))
	if err != nil { return nil, err }
	defer r.Body.Close()
	if r.StatusCode != 200 {
		body, _ := io.ReadAll(r.Body)
		return nil, fmt.Errorf("status %d: %s", r.StatusCode, body)
	}

	var cols []Column
	sc := bufio.NewScanner(r.Body)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 { continue }
		var c Column
		if err := json.Unmarshal(line, &c); err != nil {
			return nil, fmt.Errorf("decode row: %w (line=%q)", err, string(line))
		}
		cols = append(cols, c)
	}
	return cols, sc.Err()
}
```

Note: the ports are hard-coded to 54397/54398/54399 — chosen specifically to NOT collide with either the debug sidecar (54318/54319/54320) or the release sidecar (54418/54419/54420). The generator spawns its own short-lived collector on these ports, so it's safe to run while the desktop app is up. If you see "bind: address already in use" here, something else on the machine is on the 54397/54398/54399 band.

- [ ] **Step 5: Run the generator, commit the artifact**

```bash
cd /Users/guidodorsi/workspace/everr
go run ./collector/cmd/genaischema --out crates/everr-core/build/ai_instructions_schema.md
git add collector/cmd/genaischema crates/everr-core/build/ai_instructions_schema.md
git commit -m "ai-instructions: build-time schema generator"
```

### Task 6.2: Wire the generated schema into `assistant.rs`

The current `render_telemetry_ai_instructions()` returns a `&'static str` that
`include_str!`s `crates/everr-core/assets/telemetry-instructions.md`. That file
describes the about-to-be-removed `everr telemetry traces` / `everr telemetry logs`
commands, so we can't just reuse it. Migrate it in two halves — a hand-written
*header* (intro + instrumentation guidance, rewritten around
`everr telemetry query`) and a hand-written *examples* file (SQL recipes that
mirror the old filter flags). The auto-generated schema (Task 6.1) slots between
them.

**Files:**
- Create: `crates/everr-core/build/ai_instructions_header.md`
- Create: `crates/everr-core/build/ai_instructions_examples.md`
- Delete: `crates/everr-core/assets/telemetry-instructions.md`
- Modify: `crates/everr-core/src/assistant.rs`

- [ ] **Step 1: Create the header file**

Write `crates/everr-core/build/ai_instructions_header.md`. This captures the
intro and the instrumentation guidance from the old `telemetry-instructions.md`,
but rewritten so the query surface is `everr telemetry query` instead of the
removed `traces` / `logs` subcommands.

```markdown
Use Everr telemetry when debugging a locally running OpenTelemetry-instrumented
service or app — investigate runtime behavior, errors, slow requests/interactions,
or verify that instrumentation changes produce the expected spans/logs. Data is
stored in an embedded ClickHouse (chdb) database owned by the local collector
sidecar; it exists only while the Everr Desktop app is running.

Also use Everr telemetry as the output target when *adding* new instrumentation
to diagnose slowness, errors, or regressions. Emit OTLP spans/events to the
local collector instead of ad-hoc `eprintln!` / `console.log` /
`tracing-subscriber fmt` output — the query command below then becomes your
inspection loop, and you iterate in the same tool you'd use to verify.

Command:
- `everr telemetry query "<SQL>"`: runs a read-only SQL statement against the
  collector's embedded ClickHouse and returns rows as JSON. Only `SELECT`,
  `WITH`, `EXPLAIN`, `DESCRIBE`, and `SHOW` statements are accepted — writes,
  DDL, and multi-statement scripts are rejected at the HTTP layer. Responses
  are capped at 16 MiB.
- `everr telemetry ai-instructions`: prints this document (intro + schema +
  examples). Re-run after a collector version bump to pick up schema changes.
- `everr telemetry endpoint`: prints the collector's OTLP HTTP origin. Point
  your SDK's OTLP HTTP exporter at that value — do NOT hardcode a port.

Investigation playbook:
- Start broad, then narrow: filter by `ServiceName` first, then add a time
  window (`Timestamp > now() - INTERVAL 1 HOUR`), then `SeverityNumber` /
  `SpanName` / message predicates once you know where to look.
- Use `otel_logs` for *what* happened, `otel_traces` for *why it was slow* or
  how a request flowed.
- Pivot from a log to its trace: `SELECT TraceId FROM otel_logs WHERE ...` and
  feed the result into a `SELECT * FROM otel_traces WHERE TraceId = '...'`.
- If results are empty, query `SELECT max(Timestamp) FROM otel_logs` — a stale
  max means the emitting service isn't running or isn't pointed at the local
  collector.

Adding new instrumentation:
- The collector runs only on the local machine and only while the Everr
  Desktop app is running.
- Get the collector's OTLP HTTP origin with `everr telemetry endpoint` and
  point the SDK's OTLP HTTP exporter at it. Do NOT hardcode the port.
- Use the language's standard OTel SDK (Rust: `tracing` +
  `tracing-opentelemetry` + OTLP HTTP exporter; Node/TS:
  `@opentelemetry/sdk-node` + OTLP HTTP exporter).
- Span around the entry point and around every I/O call (file, network, DB,
  subprocess) — that's what makes "where did the time go" legible in
  `otel_traces`.
- Set `service.name` on the resource so `WHERE ServiceName = '<name>'` can
  isolate your output from other services sharing the collector.

After modifying instrumented code, verify the change landed:
- Trigger the code path you edited in the running service
- `everr telemetry query "SELECT Timestamp, Body FROM otel_logs WHERE ScopeName = '<module>' AND Timestamp > now() - INTERVAL 2 MINUTE ORDER BY Timestamp DESC LIMIT 20"`
  to confirm new log output
- `everr telemetry query "SELECT Timestamp, SpanName, Duration FROM otel_traces WHERE ServiceName = '<service.name>' AND SpanName = '<span>' AND Timestamp > now() - INTERVAL 2 MINUTE ORDER BY Timestamp DESC LIMIT 20"`
  to confirm new or changed spans
- Don't claim "verified" unless the returned rows reflect the code you just
  edited (timestamps within the window, attribute values that match the change).
```

Column names (`SeverityNumber`, `ScopeName`, `SpanName`, `Duration`,
`TraceId`, `ServiceName`, etc.) are the ones emitted by the forked
`chdbexporter`'s default DDL — they will appear verbatim in the
auto-generated schema block, so the assertions added in Step 4 of this task
and the examples in Step 2 below stay in sync automatically.

- [ ] **Step 2: Create the examples file**

Write `crates/everr-core/build/ai_instructions_examples.md`. These mirror the
filter flags from the old CLI so engineers have a working SQL starting point
for each investigation shape.

```markdown
## Example queries

Recent error logs (last hour, newest first):

    everr telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body \
      FROM otel_logs \
      WHERE SeverityNumber >= 17 \
        AND Timestamp > now() - INTERVAL 1 HOUR \
      ORDER BY Timestamp DESC \
      LIMIT 200"

One trace end-to-end (spans, newest first):

    everr telemetry query "SELECT Timestamp, SpanName, Duration, StatusCode, StatusMessage \
      FROM otel_traces \
      WHERE TraceId = '<trace-id>' \
      ORDER BY Timestamp ASC"

Slowest spans for a service (last 15 minutes):

    everr telemetry query "SELECT SpanName, quantile(0.95)(Duration) AS p95, count() AS n \
      FROM otel_traces \
      WHERE ServiceName = '<service.name>' \
        AND Timestamp > now() - INTERVAL 15 MINUTE \
      GROUP BY SpanName \
      ORDER BY p95 DESC \
      LIMIT 20"

Logs matching a regex on the message body:

    everr telemetry query "SELECT Timestamp, ServiceName, Body \
      FROM otel_logs \
      WHERE match(Body, '<re2-pattern>') \
        AND Timestamp > now() - INTERVAL 1 HOUR \
      ORDER BY Timestamp DESC \
      LIMIT 200"

Logs correlated to a specific trace:

    everr telemetry query "SELECT Timestamp, SeverityText, Body \
      FROM otel_logs \
      WHERE TraceId = '<trace-id>' \
      ORDER BY Timestamp ASC"

Pivot from a log to its trace (two queries):

    everr telemetry query "SELECT TraceId FROM otel_logs WHERE ScopeName = '<module>' AND Timestamp > now() - INTERVAL 5 MINUTE LIMIT 1"
    everr telemetry query "SELECT * FROM otel_traces WHERE TraceId = '<id-from-above>' ORDER BY Timestamp ASC"

Check freshness — if `last_seen` is stale, the emitting service isn't running:

    everr telemetry query "SELECT max(Timestamp) AS last_seen FROM otel_logs"
```

- [ ] **Step 3: Embed the markdown**

Locate `render_telemetry_ai_instructions()` (currently around line 268 of
`crates/everr-core/src/assistant.rs`) and replace both it and the
`TELEMETRY_INSTRUCTIONS` constant (line 11) with:

```rust
pub fn render_telemetry_ai_instructions() -> String {
    let mut out = String::new();
    out.push_str(include_str!("../build/ai_instructions_header.md"));
    out.push_str("\n\n");
    out.push_str(include_str!("../build/ai_instructions_schema.md"));
    out.push_str("\n\n");
    out.push_str(include_str!("../build/ai_instructions_examples.md"));
    out
}
```

Remove:

- the `const TELEMETRY_INSTRUCTIONS: &str = include_str!("../assets/telemetry-instructions.md");` line
- the file `crates/everr-core/assets/telemetry-instructions.md`

The signature change (`&'static str` → `String`) does not break the single
caller at `packages/desktop-app/src-cli/src/telemetry/commands.rs:34` — it's
a `print!("{}", …)`, which accepts either.

- [ ] **Step 4: Update the stale test assertions**

The existing test at `crates/everr-core/src/assistant.rs` around lines 732–739 still references the removed `everr telemetry traces` / `everr telemetry logs` commands. Replace the assertion block:

```rust
#[test]
fn telemetry_ai_instructions_includes_both_commands_and_playbook() {
    let rendered = render_telemetry_ai_instructions();
    assert!(rendered.contains("everr telemetry traces"));
    assert!(rendered.contains("everr telemetry logs"));
    assert!(rendered.contains("Investigation playbook:"));
    assert!(rendered.contains("After modifying instrumented code"));
}
```

with this updated version:

```rust
#[test]
fn telemetry_ai_instructions_includes_query_command_and_schema() {
    let rendered = render_telemetry_ai_instructions();
    assert!(rendered.contains("everr telemetry query"));
    assert!(rendered.contains("everr telemetry ai-instructions"));
    // Schema block is generated at build time — assert its header landed in the output.
    // The generator (Task 6.1) writes "# Local telemetry schema" at the top of the schema
    // markdown and emits "## <table_name>" for each table.
    assert!(rendered.contains("Local telemetry schema"));
    assert!(rendered.contains("otel_logs"));
    assert!(rendered.contains("otel_traces"));
    assert!(rendered.contains("Investigation playbook:"));
    assert!(rendered.contains("After modifying instrumented code"));
}
```

The rename (`_includes_both_commands_and_playbook` → `_includes_query_command_and_schema`) is deliberate — the old name described the two-command surface we just removed.

The header file you wrote in Step 1 already mentions both `everr telemetry query` and `everr telemetry ai-instructions`, and the generator emits `# Local telemetry schema` at the top of its markdown output (Task 6.1 Step 4 `main.go`) — so all three `assert!` checks land without further edits.

- [ ] **Step 5: Test**

```bash
cargo test -p everr-core telemetry_ai_instructions
```

Expected: PASS (the rendered string contains `everr telemetry query`, `Local telemetry schema`, `otel_logs`, `otel_traces`, `Investigation playbook:`, and `After modifying instrumented code`). The `ai_instructions_schema.md` file must already be checked in for this to compile — Task 6.1 Step 5 commits it.

- [ ] **Step 6: Commit**

```bash
git add crates/everr-core/src/assistant.rs
git add crates/everr-core/build/ai_instructions_header.md
git add crates/everr-core/build/ai_instructions_examples.md
git rm crates/everr-core/assets/telemetry-instructions.md
git commit -m "assistant: embed generated telemetry schema"
```

### Task 6.3: Drift-detection CI

Rather than spin up a second macOS runner (the collector's existing macOS job already has `libchdb` installed, pays ~10× the Linux cost, and keeps a warm Go build cache), **fold the drift check into the existing collector macOS job**. That job already:

- runs `make build-local` (produces `collector/build-local/everr-local-collector`)
- has `libchdb` installed at the OS level (required for CGO)
- has a hot Go module cache

All we need is an extra step that runs the generator against the just-built binary and diffs against the committed schema.

Path filter: only trigger when something that actually affects generated DDL changes. That's the fork version pin, the generator, or the committed schema artifact — NOT the entire `collector/**` tree.

**Files:**
- Modify: `.github/workflows/collector.yml` (or whatever the existing macOS collector job is named)

- [ ] **Step 1: Locate the existing macOS collector workflow**

```bash
grep -rn "build-local\|everr-local-collector\|libchdb" .github/workflows/
```

Expected: a single workflow that already builds the collector on macOS. If there isn't one yet (first time adding the chdb path), the step below is a new job inside that workflow — add `libchdb` install per the chdb-go docs and confirm `make build-local` runs there.

- [ ] **Step 2: Append a drift check step**

In the existing collector macOS job, after `make build-local`, append:

```yaml
      - name: Check ai-instructions schema drift
        # Only run when something that affects DDL changed.
        if: |
          contains(github.event.pull_request.changed_files, 'collector/cmd/genaischema/') ||
          contains(github.event.pull_request.changed_files, 'collector/config/manifest.local.yaml') ||
          contains(github.event.pull_request.changed_files, 'crates/everr-core/build/ai_instructions_schema.md')
        run: |
          go run ./collector/cmd/genaischema \
            --binary collector/build-local/everr-local-collector \
            --out /tmp/new-schema.md
          diff -u crates/everr-core/build/ai_instructions_schema.md /tmp/new-schema.md
```

Note: `if` uses `contains(...)` on the GH payload rather than workflow-level `paths:` because we're gating a single step, not the whole workflow. If the job's existing `paths:` is already narrow enough, drop the `if`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/collector.yml
git commit -m "ci: ai-instructions drift check piggybacks on collector macOS job"
```

Rationale for NOT creating a separate workflow file: `macos-14` minutes are ~10× the cost of Linux. A stand-alone `ai-instructions-drift.yml` would pay that cost twice per PR (once here, once in the collector job), and would need its own `libchdb` install step. Piggybacking is cheaper and simpler.

---

## Stage 7: Delete the `file` exporter after soak

Run only after the chdb path has been on `main` for at least one week without telemetry-related incidents.

### Task 7.1: Drop `fileexporter` from the manifest

**Files:**
- Modify: `collector/config/manifest.local.yaml`

- [ ] **Step 1: Remove the line**

```yaml
exporters:
  - gomod: github.com/everr-labs/chdbexporter v0.2.0
```

(`fileexporter` deleted.)

- [ ] **Step 2: Rebuild, confirm smoke + CLI e2e**

```bash
cd collector
make build-local
go test ./test/smoke/... -v
cd ../packages/desktop-app/src-cli
cargo test --test telemetry_query_e2e -- --nocapture
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/config/manifest.local.yaml
git commit -m "collector: drop file exporter after chdb soak"
```

---

## Final verification

- [ ] **End-to-end run**

Launch the Tauri dev app, reproduce a log from any instrumented code path, then run from a terminal:

```bash
everr-dev telemetry endpoint
everr-dev telemetry query "SELECT Timestamp, ServiceName, Body FROM otel_logs ORDER BY Timestamp DESC LIMIT 5"
```

Expected: both endpoints printed; 5 most-recent log rows in a table.

- [ ] **Confirm CHANGELOG and release notes are in place before tagging a release**.
