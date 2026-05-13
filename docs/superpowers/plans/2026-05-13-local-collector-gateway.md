# Local Collector Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated local collector with a hand-maintained gateway binary, reset `chdbexporter` from upstream OTel Contrib `v0.152.0`, and upgrade both collector builds to `v0.152.0`.

**Architecture:** The local binary owns chDB startup, SQL HTTP, readiness, and in-process Collector startup. The Collector config is generated in memory by the gateway. `chdbexporter` receives the gateway-owned chDB handle instead of opening its own database by path.

**Tech Stack:** Go 1.25, OpenTelemetry Collector `v0.152.0`, OpenTelemetry Collector Contrib `v0.152.0`, `chdb-go`, Rust/Tokio sidecar startup, Make/OCB for the main collector.

---

## File Structure

Create or modify these areas:

- `collector/config/manifest.yaml`: upgrade main CI/CD collector to OTel `v0.152.0`, remove unused `spanmetricsconnector`.
- `collector/internal/tools/go.mod`: upgrade `builder` and `mdatagen` to `v0.152.0`.
- `collector/Makefile`: make `build-local` compile the hand-maintained gateway instead of running OCB.
- `collector/exporter/chdbexporter/`: fresh local copy of upstream `exporter/clickhouseexporter` `v0.152.0`, modified for injected chDB.
- `collector/exporter/chdbexporter/UPSTREAM.md`: exact upstream source metadata.
- `collector/exporter/chdbexporter/EVERR_CHANGES.md`: plain-language summary of every local change from upstream.
- `collector/internal/localgateway/chdb/`: shared process-wide chDB handle and queue.
- `collector/internal/localgateway/sqlhttp/`: normal gateway HTTP package copied from the current OTel extension.
- `collector/internal/localgateway/config/`: endpoint parsing and generated Collector config.
- `collector/internal/localgateway/health/`: gateway-owned readiness endpoint.
- `collector/cmd/everr-local-collector/`: hand-maintained gateway command.
- `collector/test/smoke/chdb_smoke_test.go`: update smoke tests to use gateway flags.
- `crates/everr-core/src/collector.rs`: remove or narrow local YAML config rendering after Rust no longer calls it.
- `crates/everr-core/assets/collector.yaml.tmpl`: remove after no callers remain.
- `packages/desktop-app/src-cli/src/telemetry/collector.rs`: spawn the gateway with flags instead of `--config`.
- `packages/desktop-app/src-tauri/src/telemetry/sidecar.rs`: keep invoking `everr local start --quiet`; update tests only if output or readiness assumptions change.
- `packages/desktop-app/src-cli/tests/telemetry_query_e2e.rs`: update collector test startup flags.

## Task 1: Upgrade Main Collector Version And Drop Spanmetrics

**Files:**
- Modify: `collector/config/manifest.yaml`
- Modify: `collector/internal/tools/go.mod`
- Modify after command output if needed: `collector/internal/tools/go.sum`

- [ ] **Step 1: Write the manifest change**

Replace `collector/config/manifest.yaml` with:

```yaml
dist:
  name: everr-collector
  description: CI/CD OpenTelemetry Collector
  output_path: ./build
  debug_compilation: false
  version: 0.1.0
  otelcol_version: 0.152.0

exporters:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter v0.152.0
  - gomod: go.opentelemetry.io/collector/exporter/debugexporter v0.152.0

connectors:
  - gomod: github.com/everr-labs/everr/collector/connector/testlogstotraces v0.152.0

processors:
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.152.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor v0.152.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/attributesprocessor v0.152.0

extensions:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/extension/healthcheckextension v0.152.0

receivers:
  - gomod: github.com/everr-labs/everr/collector/receiver/githubactionsreceiver v0.152.0

providers:
  - gomod: go.opentelemetry.io/collector/confmap/provider/envprovider v1.58.0
  - gomod: go.opentelemetry.io/collector/confmap/provider/fileprovider v1.58.0

replaces:
  - github.com/everr-labs/everr/collector/receiver/githubactionsreceiver => ../receiver/githubactionsreceiver
  - github.com/everr-labs/everr/collector/internal/sharedcomponent => ../internal/sharedcomponent
  - github.com/everr-labs/everr/collector/connector/testlogstotraces => ../connector/testlogstotraces
  - github.com/everr-labs/everr/collector/semconv => ../semconv
```

Keep the final generated build on OTel `v0.152.0` and do not re-add `spanmetricsconnector`.

- [ ] **Step 2: Upgrade the local OCB tools module**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/tools
go get go.opentelemetry.io/collector/cmd/builder@v0.152.0 go.opentelemetry.io/collector/cmd/mdatagen@v0.152.0
go mod tidy
```

Expected: `go.mod` names `builder v0.152.0` and `mdatagen v0.152.0`.

- [ ] **Step 3: Regenerate the main collector build**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
make -C collector build
```

Expected: `collector/build/everr-collector` exists. If OCB reports a provider version mismatch, update only the provider module versions in `collector/config/manifest.yaml`, then rerun this step.

- [ ] **Step 4: Verify spanmetrics is gone**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
rg -n "spanmetrics|span_metrics" collector/config collector/build
```

Expected: no matches in `collector/config/manifest.yaml` or generated main collector files unless a generated dependency comment references a transitive package. There must be no registered spanmetrics connector factory.

- [ ] **Step 5: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/config/manifest.yaml collector/internal/tools/go.mod collector/internal/tools/go.sum collector/build
git commit -m "build: upgrade collector to otel 0.152"
```

## Task 2: Create Gateway chDB Handle Package

**Files:**
- Create: `collector/internal/localgateway/chdb/go.mod`
- Create: `collector/internal/localgateway/chdb/handle.go`
- Create: `collector/internal/localgateway/chdb/handle_test.go`
- Remove later: `third_party/chdbexporter/chdbhandle/`

- [ ] **Step 1: Create the module**

Create `collector/internal/localgateway/chdb/go.mod`:

```go
module github.com/everr-labs/everr/collector/internal/localgateway/chdb

go 1.25.6

require (
	github.com/chdb-io/chdb-go v1.11.0
	github.com/stretchr/testify v1.11.1
)
```

- [ ] **Step 2: Write failing tests for singleton path and queue behavior**

Create `collector/internal/localgateway/chdb/handle_test.go` by copying the current tests from `third_party/chdbexporter/chdbhandle/handle_test.go`, then update the package name and imports:

```go
package chdb

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type fakeResult struct{ buf []byte }

func (r fakeResult) Buf() []byte { return r.buf }
func (r fakeResult) Free()       {}

type fakeSession struct {
	path    string
	closed  bool
	queries []string
	mu      sync.Mutex
}

func (s *fakeSession) Query(query string, _ ...string) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	return fakeResult{buf: []byte(`{"ok":1}` + "\n")}, nil
}

func (s *fakeSession) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
}

func (s *fakeSession) Path() string { return s.path }

func TestOpenPinsPathForProcessLifetime(t *testing.T) {
	t.Cleanup(ResetForTesting)
	firstPath := filepath.Join(t.TempDir(), "one")
	secondPath := filepath.Join(t.TempDir(), "two")

	first, err := Open(firstPath, WithSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	require.NoError(t, err)
	require.NotNil(t, first)

	second, err := Open(firstPath)
	require.NoError(t, err)
	require.Same(t, first, second)

	other, err := Open(secondPath)
	require.ErrorIs(t, err, ErrPathPinned)
	require.Nil(t, other)
}

func TestEnqueueReturnsQueueFull(t *testing.T) {
	t.Cleanup(ResetForTesting)
	block := make(chan struct{})
	handle, err := Open(filepath.Join(t.TempDir(), "chdb"),
		WithQueueSize(1),
		WithSessionFactory(func(path string) (Session, error) {
			return &fakeSession{path: path}, nil
		}),
	)
	require.NoError(t, err)

	firstDone, err := handle.Enqueue(context.Background(), func(context.Context, Session) error {
		<-block
		return nil
	})
	require.NoError(t, err)
	require.NotNil(t, firstDone)

	secondDone, err := handle.Enqueue(context.Background(), func(context.Context, Session) error {
		return nil
	})
	require.NoError(t, err)
	require.NotNil(t, secondDone)

	thirdDone, err := handle.Enqueue(context.Background(), func(context.Context, Session) error {
		return nil
	})
	require.ErrorIs(t, err, ErrQueueFull)
	require.Nil(t, thirdDone)

	close(block)
	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
}

func TestDoReturnsContextCancellation(t *testing.T) {
	t.Cleanup(ResetForTesting)
	handle, err := Open(filepath.Join(t.TempDir(), "chdb"),
		WithSessionFactory(func(path string) (Session, error) {
			return &fakeSession{path: path}, nil
		}),
	)
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = handle.Do(ctx, func(context.Context, Session) error {
		return errors.New("should not run")
	})
	require.ErrorIs(t, err, context.Canceled)
}

func TestCloseDrainsPendingWork(t *testing.T) {
	t.Cleanup(ResetForTesting)
	block := make(chan struct{})
	handle, err := Open(filepath.Join(t.TempDir(), "chdb"),
		WithQueueSize(2),
		WithSessionFactory(func(path string) (Session, error) {
			return &fakeSession{path: path}, nil
		}),
	)
	require.NoError(t, err)

	firstDone, err := handle.Enqueue(context.Background(), func(context.Context, Session) error {
		<-block
		return nil
	})
	require.NoError(t, err)

	secondDone, err := handle.Enqueue(context.Background(), func(context.Context, Session) error {
		return nil
	})
	require.NoError(t, err)

	closeStarted := make(chan struct{})
	go func() {
		close(closeStarted)
		_ = handle.Close()
	}()
	<-closeStarted
	time.Sleep(25 * time.Millisecond)
	close(block)

	require.NoError(t, <-firstDone)
	require.ErrorIs(t, <-secondDone, ErrClosed)
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/chdb
go test ./...
```

Expected: fails because `Open`, `Handle`, `Session`, `Result`, `WithQueueSize`, and `WithSessionFactory` are not defined.

- [ ] **Step 4: Implement the handle**

Create `collector/internal/localgateway/chdb/handle.go` by moving the current implementation from `third_party/chdbexporter/chdbhandle/handle.go` and changing:

```go
package chdbhandle
```

to:

```go
package chdb
```

Export the two test options by renaming:

```go
func withQueueSize(size int) Option
func withSessionFactory(factory sessionFactory) Option
```

to:

```go
func WithQueueSize(size int) Option
func WithSessionFactory(factory sessionFactory) Option
```

Also keep these public types and errors unchanged in behavior:

```go
var (
	ErrQueueFull  = errors.New("chdb handle queue full")
	ErrPathPinned = errors.New("chdb handle path pinned to a different path")
	ErrClosed     = errors.New("chdb handle closed")
)

type Result interface {
	Buf() []byte
	Free()
}

type Session interface {
	Query(query string, outputFormats ...string) (Result, error)
	Close()
	Path() string
}

type Handle struct {
	// fields stay private
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/chdb
go test ./...
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/internal/localgateway/chdb
git commit -m "feat: add local gateway chdb handle"
```

## Task 3: Move SQL HTTP Into The Gateway

**Files:**
- Create: `collector/internal/localgateway/sqlhttp/go.mod`
- Create: `collector/internal/localgateway/sqlhttp/config.go`
- Create: `collector/internal/localgateway/sqlhttp/server.go`
- Create: `collector/internal/localgateway/sqlhttp/handler.go`
- Create: `collector/internal/localgateway/sqlhttp/lexer.go`
- Create: `collector/internal/localgateway/sqlhttp/params.go`
- Create tests copied from `collector/extension/sqlhttp/*_test.go`
- Remove later: `collector/extension/sqlhttp/`

- [ ] **Step 1: Create the module**

Create `collector/internal/localgateway/sqlhttp/go.mod`:

```go
module github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp

go 1.25.6

require (
	github.com/everr-labs/everr/collector/internal/localgateway/chdb v0.0.0-00010101000000-000000000000
	go.uber.org/zap v1.27.1
)

replace github.com/everr-labs/everr/collector/internal/localgateway/chdb => ../chdb
```

- [ ] **Step 2: Copy handler and SQL validation tests**

Copy these files from `collector/extension/sqlhttp/` to `collector/internal/localgateway/sqlhttp/`:

```text
handler.go
handler_test.go
lexer.go
lexer_test.go
params.go
params_test.go
```

In the copied files, replace imports:

```go
"github.com/everr-labs/chdbexporter/chdbhandle"
```

with:

```go
"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
```

Then replace references:

```go
chdbhandle.Handle
chdbhandle.Session
chdbhandle.ErrQueueFull
chdbhandle.ErrClosed
```

with:

```go
chdb.Handle
chdb.Session
chdb.ErrQueueFull
chdb.ErrClosed
```

- [ ] **Step 3: Add gateway server config**

Create `collector/internal/localgateway/sqlhttp/config.go`:

```go
package sqlhttp

import "time"

const (
	DefaultQueryTimeout   = 5 * time.Second
	DefaultEnqueueTimeout = 2 * time.Second
	DefaultMaxResultBytes = 16 << 20
)

type Config struct {
	Endpoint       string
	QueryTimeout   time.Duration
	EnqueueTimeout time.Duration
	MaxResultBytes int64
}

func (c Config) Applied() Config {
	out := c
	if out.QueryTimeout == 0 {
		out.QueryTimeout = DefaultQueryTimeout
	}
	if out.EnqueueTimeout == 0 {
		out.EnqueueTimeout = DefaultEnqueueTimeout
	}
	if out.MaxResultBytes == 0 {
		out.MaxResultBytes = DefaultMaxResultBytes
	}
	return out
}
```

- [ ] **Step 4: Add the normal HTTP server wrapper**

Create `collector/internal/localgateway/sqlhttp/server.go`:

```go
package sqlhttp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"go.uber.org/zap"
)

type Server struct {
	cfg    Config
	handle *chdb.Handle
	logger *zap.Logger

	server       *http.Server
	listener     net.Listener
	shutdownOnce sync.Once
}

func NewServer(cfg Config, handle *chdb.Handle, logger *zap.Logger) *Server {
	return &Server{
		cfg:    cfg.Applied(),
		handle: handle,
		logger: logger,
	}
}

func (s *Server) Start() error {
	handler := &handler{
		handle:         s.handle,
		queryTimeout:   s.cfg.QueryTimeout,
		enqueueTimeout: s.cfg.EnqueueTimeout,
		maxBytes:       s.cfg.MaxResultBytes,
		logger:         s.logger,
	}
	handler.ready.Store(true)

	mux := http.NewServeMux()
	mux.Handle("/sql", handler)

	ln, err := net.Listen("tcp", s.cfg.Endpoint)
	if err != nil {
		return err
	}
	s.listener = ln
	s.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := s.server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("sqlhttp serve", zap.Error(err))
		}
	}()

	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	var err error
	s.shutdownOnce.Do(func() {
		if s.server != nil {
			err = s.server.Shutdown(ctx)
		}
	})
	return err
}
```

- [ ] **Step 5: Run tests to verify failures are import-only**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/sqlhttp
go test ./...
```

Expected: any failures should be from copied tests needing package/import updates, not from behavior changes.

- [ ] **Step 6: Fix copied tests**

Apply these mechanical test changes:

```text
package sqlhttp stays package sqlhttp
old fake handle imports use local chdb package
defaultMaxResultBytes becomes DefaultMaxResultBytes if referenced outside handler.go
```

If a copied test constructs the old OTel extension, remove that test from the gateway package and replace it with a server test that starts `NewServer` on `127.0.0.1:0`.

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/sqlhttp
go test ./...
```

Expected: all SQL validation, parameter substitution, read-only, and handler tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/internal/localgateway/sqlhttp
git commit -m "feat: move sql http into local gateway"
```

## Task 4: Copy Upstream ClickHouse Exporter v0.152.0

**Files:**
- Create: `collector/exporter/chdbexporter/`
- Create: `collector/exporter/chdbexporter/UPSTREAM.md`
- Create: `collector/exporter/chdbexporter/EVERR_CHANGES.md`

- [ ] **Step 1: Copy upstream exporter exactly**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
rm -rf collector/exporter/chdbexporter
tmpdir="$(mktemp -d)"
curl -fsSL https://github.com/open-telemetry/opentelemetry-collector-contrib/archive/refs/tags/v0.152.0.tar.gz \
  | tar -xz -C "$tmpdir" --strip-components=2 opentelemetry-collector-contrib-0.152.0/exporter/clickhouseexporter
mkdir -p collector/exporter
mv "$tmpdir/clickhouseexporter" collector/exporter/chdbexporter
rm -rf "$tmpdir"
```

Expected: `collector/exporter/chdbexporter/config.go` exists and still contains upstream package/import names before local edits.

- [ ] **Step 2: Rewrite module and import path names**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/exporter/chdbexporter
perl -pi -e 's#github.com/open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter#github.com/everr-labs/everr/collector/exporter/chdbexporter#g' $(rg -l 'clickhouseexporter|github.com/open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter')
perl -pi -e 's#module github.com/open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter#module github.com/everr-labs/everr/collector/exporter/chdbexporter#' go.mod
```

Keep package names as `clickhouseexporter` for this step. Renaming the Go package can happen later if it stays low-risk; component type and module path matter more.

- [ ] **Step 3: Add upstream metadata**

Create `collector/exporter/chdbexporter/UPSTREAM.md`:

```markdown
# Upstream

Source repository: `open-telemetry/opentelemetry-collector-contrib`
Source package: `exporter/clickhouseexporter`
Source tag: `v0.152.0`
Source release date: `2026-05-11`

This package started as a copy of upstream ClickHouse exporter `v0.152.0`.
Local changes are tracked in `EVERR_CHANGES.md`.
```

- [ ] **Step 4: Add local change log**

Create `collector/exporter/chdbexporter/EVERR_CHANGES.md`:

```markdown
# Everr Changes To Upstream ClickHouse Exporter

This file records the meaningful differences from upstream `open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter` at `v0.152.0`.

## Initial copy

- Copied upstream `exporter/clickhouseexporter` from tag `v0.152.0`.
- Changed the Go module path to `github.com/everr-labs/everr/collector/exporter/chdbexporter`.

## Planned local changes

- Inject a gateway-owned chDB handle instead of opening a ClickHouse network connection.
- Remove remote ClickHouse runtime options that do not apply to local chDB.
- Keep upstream table schema and OTLP row conversion behavior where chDB supports it.
- Use `7d` as the local default TTL.
- Keep the `v0.151.0` upstream logs table schema update unless chDB rejects a specific DDL feature.
```

- [ ] **Step 5: Tidy and run the copied tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/exporter/chdbexporter
go mod tidy
go test ./...
```

Expected: pure unit tests pass or integration tests fail because no ClickHouse server is available. If integration tests run by default and require Docker/ClickHouse, gate them with build tags or skip conditions matching upstream patterns before continuing.

- [ ] **Step 6: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/exporter/chdbexporter
git commit -m "feat: copy clickhouse exporter 0.152"
```

## Task 5: Adapt chdbexporter For Injected chDB

**Files:**
- Modify: `collector/exporter/chdbexporter/go.mod`
- Modify: `collector/exporter/chdbexporter/config.go`
- Modify: `collector/exporter/chdbexporter/factory.go`
- Modify: `collector/exporter/chdbexporter/exporter_logs.go`
- Modify: `collector/exporter/chdbexporter/exporter_logs_json.go`
- Modify: `collector/exporter/chdbexporter/exporter_traces.go`
- Modify: `collector/exporter/chdbexporter/exporter_traces_json.go`
- Modify: `collector/exporter/chdbexporter/exporter_metrics.go`
- Modify: `collector/exporter/chdbexporter/internal/clickhouse.go`
- Modify: `collector/exporter/chdbexporter/internal/metrics/*.go`
- Modify: `collector/exporter/chdbexporter/EVERR_CHANGES.md`
- Test: `collector/exporter/chdbexporter/*_test.go`

- [ ] **Step 1: Add local chDB dependency**

In `collector/exporter/chdbexporter/go.mod`, add:

```go
require github.com/everr-labs/everr/collector/internal/localgateway/chdb v0.0.0-00010101000000-000000000000

replace github.com/everr-labs/everr/collector/internal/localgateway/chdb => ../../internal/localgateway/chdb
```

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/exporter/chdbexporter
go mod tidy
```

Expected: the local chDB module resolves.

- [ ] **Step 2: Write failing factory injection test**

Add to `collector/exporter/chdbexporter/factory_test.go`:

```go
func TestNewFactoryWithHandleRequiresHandle(t *testing.T) {
	factory := NewFactoryWithHandle(nil)
	cfg := factory.CreateDefaultConfig()
	_, err := factory.CreateLogs(context.Background(), exportertest.NewNopSettings(metadata.Type), cfg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "chdb handle is required")
}
```

Add imports if missing:

```go
import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/exporter/exportertest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
)
```

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/exporter/chdbexporter
go test ./... -run TestNewFactoryWithHandleRequiresHandle
```

Expected: fails because `NewFactoryWithHandle` is not defined.

- [ ] **Step 3: Add injected handle factory**

Modify `collector/exporter/chdbexporter/factory.go` so the public constructors are:

```go
func NewFactory() exporter.Factory {
	return NewFactoryWithHandle(nil)
}

func NewFactoryWithHandle(handle *chdb.Handle) exporter.Factory {
	creators := &factoryCreators{handle: handle}
	return exporter.NewFactory(
		metadata.Type,
		createDefaultConfig,
		exporter.WithLogs(creators.createLogsExporter, metadata.LogsStability),
		exporter.WithTraces(creators.createTracesExporter, metadata.TracesStability),
		exporter.WithMetrics(creators.createMetricExporter, metadata.MetricsStability),
	)
}

type factoryCreators struct {
	handle *chdb.Handle
}

func (c *factoryCreators) requireHandle() (*chdb.Handle, error) {
	if c.handle == nil {
		return nil, errors.New("chdb handle is required")
	}
	return c.handle, nil
}
```

Then change the existing `createLogsExporter`, `createTracesExporter`, and `createMetricExporter` functions into methods on `factoryCreators`. Each method calls `requireHandle()` and passes the handle to the signal exporter constructor.

- [ ] **Step 4: Simplify local config**

In `collector/exporter/chdbexporter/config.go`, remove these remote ClickHouse fields from `Config`:

```go
Endpoint
Username
Password
TLS
ConnectionParams
ClusterName
Compress
AsyncInsert
```

Keep:

```go
Database
LogsTableName
TracesTableName
MetricsTableName
TTL
TableEngine
CreateSchema
JSON
MetricsTables
TimeoutSettings
BackOffConfig
QueueSettings
```

Set local defaults:

```go
TTL:          7 * 24 * time.Hour,
CreateSchema: true,
Database:     defaultDatabase,
```

Change `Validate()` so it no longer requires an endpoint:

```go
func (cfg *Config) Validate() error {
	cfg.buildMetricTableNames()
	if cfg.TTL < 0 {
		return errors.New("ttl must be zero or greater")
	}
	return nil
}
```

- [ ] **Step 5: Replace ClickHouse driver execution with chDB execution helpers**

In `collector/exporter/chdbexporter/internal/clickhouse.go`, remove `clickhouse-go` client construction and keep only local helpers:

```go
const DefaultDatabase = "default"

func GenerateTTLExpr(ttl time.Duration, timeField string) string {
	if ttl > 0 {
		switch {
		case ttl%(24*time.Hour) == 0:
			return fmt.Sprintf(`TTL %s + toIntervalDay(%d)`, timeField, ttl/(24*time.Hour))
		case ttl%(time.Hour) == 0:
			return fmt.Sprintf(`TTL %s + toIntervalHour(%d)`, timeField, ttl/time.Hour)
		case ttl%(time.Minute) == 0:
			return fmt.Sprintf(`TTL %s + toIntervalMinute(%d)`, timeField, ttl/time.Minute)
		default:
			return fmt.Sprintf(`TTL %s + toIntervalSecond(%d)`, timeField, ttl/time.Second)
		}
	}
	return ""
}

func CreateDatabase(ctx context.Context, handle *chdb.Handle, database string) error {
	if database == DefaultDatabase {
		return nil
	}
	sql := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS %q", database)
	return Exec(ctx, handle, sql)
}

func Exec(ctx context.Context, handle *chdb.Handle, sql string) error {
	return handle.Do(ctx, func(_ context.Context, s chdb.Session) error {
		result, err := s.Query(sql, "")
		if err != nil {
			return err
		}
		if result != nil {
			result.Free()
		}
		return nil
	})
}
```

Add `GetTableColumns` using `DESC TABLE ... FORMAT JSONEachRow` and JSON decoding into a struct with a `Name` field. Test it with a fake session before using it in exporter startup.

- [ ] **Step 6: Convert signal exporters to use the handle**

For each exporter struct, replace:

```go
db driver.Conn
```

with:

```go
handle *chdb.Handle
```

Constructors receive the handle:

```go
func newLogsExporter(logger *zap.Logger, cfg *Config, handle *chdb.Handle) *logsExporter
func newLogsJSONExporter(logger *zap.Logger, cfg *Config, handle *chdb.Handle) *logsJSONExporter
func newTracesExporter(logger *zap.Logger, cfg *Config, handle *chdb.Handle) *tracesExporter
func newTracesJSONExporter(logger *zap.Logger, cfg *Config, handle *chdb.Handle) *tracesJSONExporter
func newMetricsExporter(logger *zap.Logger, cfg *Config, handle *chdb.Handle) *metricsExporter
```

Startup uses:

```go
if e.cfg.shouldCreateSchema() {
	if err := internal.CreateDatabase(ctx, e.handle, e.cfg.database()); err != nil {
		return err
	}
	// run table DDL through internal.Exec(ctx, e.handle, sql)
}
```

Shutdown becomes a no-op because the gateway owns the handle lifetime:

```go
func (e *logsExporter) shutdown(context.Context) error { return nil }
```

- [ ] **Step 7: Insert rows through JSONEachRow**

Add a package-level helper in `collector/exporter/chdbexporter/exporter_common.go`:

```go
func insertRows(ctx context.Context, handle *chdb.Handle, database, table string, rows []map[string]any) error {
	if len(rows) == 0 {
		return nil
	}

	var body strings.Builder
	body.WriteString(fmt.Sprintf("INSERT INTO %q.%q FORMAT JSONEachRow\n", database, table))
	for _, row := range rows {
		encoded, err := json.Marshal(row)
		if err != nil {
			return err
		}
		body.Write(encoded)
		body.WriteByte('\n')
	}

	return internal.Exec(ctx, handle, body.String())
}
```

Then convert `pushLogsData`, `pushTraceData`, and metric insertion to build `[]map[string]any` with the upstream column names. Use the existing `third_party/chdbexporter` row-building code as a migration reference, but keep the new `v0.152.0` columns such as `EventName` when the table schema supports them.

- [ ] **Step 8: Keep or disable JSON mode explicitly**

If chDB accepts upstream JSON-column DDL in local smoke tests, keep `JSON` support. If chDB rejects JSON-column DDL, change `Validate()` to reject `JSON: true`:

```go
if cfg.JSON {
	return errors.Join(err, errors.New("json mode is not supported by local chdb exporter"))
}
```

Record that decision in `EVERR_CHANGES.md`.

- [ ] **Step 9: Run exporter tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/exporter/chdbexporter
go test ./...
```

Expected: unit tests pass. Integration tests that require remote ClickHouse should be removed, adapted to chDB, or gated so they do not run by default.

- [ ] **Step 10: Update change log**

Append to `collector/exporter/chdbexporter/EVERR_CHANGES.md`:

```markdown
## Injected local chDB runtime

- Added `NewFactoryWithHandle` so the gateway can pass the process-wide chDB handle to the exporter.
- Removed network ClickHouse client startup from signal exporters.
- Made exporter shutdown leave the chDB handle open because the gateway owns its lifetime.
- Inserted rows through chDB `FORMAT JSONEachRow`.
- Kept local default TTL at `7d`.
```

- [ ] **Step 11: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/exporter/chdbexporter
git commit -m "feat: adapt chdb exporter for gateway handle"
```

## Task 6: Add Gateway Config And Health Packages

**Files:**
- Create: `collector/internal/localgateway/config/go.mod`
- Create: `collector/internal/localgateway/config/config.go`
- Create: `collector/internal/localgateway/config/provider.go`
- Create: `collector/internal/localgateway/config/config_test.go`
- Create: `collector/internal/localgateway/health/go.mod`
- Create: `collector/internal/localgateway/health/server.go`
- Create: `collector/internal/localgateway/health/server_test.go`

- [ ] **Step 1: Create config module**

Create `collector/internal/localgateway/config/go.mod`:

```go
module github.com/everr-labs/everr/collector/internal/localgateway/config

go 1.25.6

require go.opentelemetry.io/collector/confmap v1.58.0
```

- [ ] **Step 2: Write config tests**

Create `collector/internal/localgateway/config/config_test.go`:

```go
package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func TestParseEndpointRequiresLocalHTTPURL(t *testing.T) {
	endpoint, err := ParseEndpoint("http://127.0.0.1:54318")
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", endpoint.ListenAddress)

	_, err = ParseEndpoint("https://127.0.0.1:54318")
	require.ErrorContains(t, err, "must use http")

	_, err = ParseEndpoint("http://example.com:54318")
	require.ErrorContains(t, err, "must use localhost or loopback")
}

func TestBuildCollectorConfigUsesLocalDefaults(t *testing.T) {
	cfg := CollectorConfig{
		OTLPListenAddress: "127.0.0.1:54318",
		TTL:               7 * 24 * time.Hour,
	}

	conf := BuildCollectorConfig(cfg)
	raw := conf.ToStringMap()

	processors := raw["processors"].(map[string]any)
	batch := processors["batch"].(map[string]any)
	require.Equal(t, "250ms", batch["timeout"])
	require.Equal(t, 512, batch["send_batch_size"])

	exporters := raw["exporters"].(map[string]any)
	chdb := exporters["chdb"].(map[string]any)
	require.Equal(t, "168h0m0s", chdb["ttl"])
	require.NotContains(t, chdb, "path")
}

func TestStaticProviderReturnsGeneratedConfig(t *testing.T) {
	raw := BuildCollectorConfigMap(CollectorConfig{
		OTLPListenAddress: "127.0.0.1:54318",
		TTL:               7 * 24 * time.Hour,
	})
	factory := NewStaticProviderFactory(raw)
	provider, err := factory.Create(confmap.ProviderSettings{})
	require.NoError(t, err)

	retrieved, err := provider.Retrieve(t.Context(), "everr:local", nil)
	require.NoError(t, err)
	defer func() { _ = retrieved.Close(t.Context()) }()

	conf, err := retrieved.AsConf()
	require.NoError(t, err)
	require.NotNil(t, conf)
}
```

- [ ] **Step 3: Implement config package**

Create `collector/internal/localgateway/config/config.go`:

```go
package config

import (
	"fmt"
	"net"
	"net/url"
	"time"

	"go.opentelemetry.io/collector/confmap"
)

type Endpoint struct {
	Origin        string
	ListenAddress string
}

type CollectorConfig struct {
	OTLPListenAddress string
	TTL               time.Duration
}

func ParseEndpoint(raw string) (Endpoint, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return Endpoint{}, fmt.Errorf("parse endpoint: %w", err)
	}
	if u.Scheme != "http" {
		return Endpoint{}, fmt.Errorf("endpoint %q must use http", raw)
	}
	host := u.Hostname()
	if host != "localhost" && net.ParseIP(host) == nil {
		return Endpoint{}, fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	}
	if ip := net.ParseIP(host); ip != nil && !ip.IsLoopback() {
		return Endpoint{}, fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	}
	if u.Port() == "" {
		return Endpoint{}, fmt.Errorf("endpoint %q must include a port", raw)
	}
	return Endpoint{
		Origin:        fmt.Sprintf("http://%s", u.Host),
		ListenAddress: u.Host,
	}, nil
}

func BuildCollectorConfig(cfg CollectorConfig) *confmap.Conf {
	return confmap.NewFromStringMap(BuildCollectorConfigMap(cfg))
}

func BuildCollectorConfigMap(cfg CollectorConfig) map[string]any {
	if cfg.TTL == 0 {
		cfg.TTL = 7 * 24 * time.Hour
	}

	return map[string]any{
		"receivers": map[string]any{
			"otlp": map[string]any{
				"protocols": map[string]any{
					"http": map[string]any{
						"endpoint": cfg.OTLPListenAddress,
						"cors": map[string]any{
							"allowed_origins": []any{"*"},
						},
					},
				},
			},
		},
		"processors": map[string]any{
			"batch": map[string]any{
				"timeout":         "250ms",
				"send_batch_size": 512,
			},
		},
		"exporters": map[string]any{
			"chdb": map[string]any{
				"ttl": cfg.TTL.String(),
			},
		},
		"service": map[string]any{
			"pipelines": map[string]any{
				"traces": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
				"logs": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
				"metrics": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
			},
			"telemetry": map[string]any{
				"metrics": map[string]any{"level": "none"},
				"logs":    map[string]any{"level": "warn"},
			},
		},
	}
}
```

Create `collector/internal/localgateway/config/provider.go`:

```go
package config

import (
	"context"
	"fmt"

	"go.opentelemetry.io/collector/confmap"
)

const StaticScheme = "everr"
const StaticURI = "everr:local"

type staticProvider struct {
	raw map[string]any
}

func NewStaticProviderFactory(raw map[string]any) confmap.ProviderFactory {
	return confmap.NewProviderFactory(func(confmap.ProviderSettings) confmap.Provider {
		return &staticProvider{raw: raw}
	})
}

func (p *staticProvider) Retrieve(ctx context.Context, uri string, _ confmap.WatcherFunc) (*confmap.Retrieved, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	if uri != StaticURI {
		return nil, fmt.Errorf("unsupported config uri %q", uri)
	}
	return confmap.NewRetrieved(p.raw)
}

func (p *staticProvider) Scheme() string {
	return StaticScheme
}

func (p *staticProvider) Shutdown(context.Context) error {
	return nil
}
```

- [ ] **Step 4: Run config tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/config
go test ./...
```

Expected: all tests pass.

- [ ] **Step 5: Create health module and tests**

Create `collector/internal/localgateway/health/go.mod`:

```go
module github.com/everr-labs/everr/collector/internal/localgateway/health

go 1.25.6
```

Create `collector/internal/localgateway/health/server_test.go`:

```go
package health

import (
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHealthServerReportsReadiness(t *testing.T) {
	server := NewServer("127.0.0.1:0")
	require.NoError(t, server.Start())
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })

	resp, err := http.Get(server.URL() + "/")
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
	_ = resp.Body.Close()

	server.SetReady(true)
	resp, err = http.Get(server.URL() + "/")
	require.NoError(t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, string(body), "ok")
}

func TestHealthServerHasReadHeaderTimeout(t *testing.T) {
	server := NewServer("127.0.0.1:0")
	require.Equal(t, 5*time.Second, server.readHeaderTimeout())
}
```

- [ ] **Step 6: Implement health server**

Create `collector/internal/localgateway/health/server.go`:

```go
package health

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

type Server struct {
	endpoint string
	listener net.Listener
	server   *http.Server
	ready    atomic.Bool
}

func NewServer(endpoint string) *Server {
	return &Server{endpoint: endpoint}
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handle)

	ln, err := net.Listen("tcp", s.endpoint)
	if err != nil {
		return err
	}
	s.listener = ln
	s.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: s.readHeaderTimeout(),
	}

	go func() {
		_ = s.server.Serve(ln)
	}()
	return nil
}

func (s *Server) URL() string {
	if s.listener == nil {
		return ""
	}
	return "http://" + s.listener.Addr().String()
}

func (s *Server) SetReady(ready bool) {
	s.ready.Store(ready)
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *Server) handle(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !s.ready.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "starting"})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) readHeaderTimeout() time.Duration {
	return 5 * time.Second
}
```

- [ ] **Step 7: Run health tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/internal/localgateway/health
go test ./...
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/internal/localgateway/config collector/internal/localgateway/health
git commit -m "feat: add local gateway config and health"
```

## Task 7: Build The Hand-Maintained Local Gateway Binary

**Files:**
- Create: `collector/cmd/everr-local-collector/go.mod`
- Create: `collector/cmd/everr-local-collector/main.go`
- Create: `collector/cmd/everr-local-collector/main_test.go`
- Modify: `collector/Makefile`

- [ ] **Step 1: Create command module**

Create `collector/cmd/everr-local-collector/go.mod`:

```go
module github.com/everr-labs/everr/collector/cmd/everr-local-collector

go 1.25.6

require (
	github.com/everr-labs/everr/collector/exporter/chdbexporter v0.0.0-00010101000000-000000000000
	github.com/everr-labs/everr/collector/internal/localgateway/chdb v0.0.0-00010101000000-000000000000
	github.com/everr-labs/everr/collector/internal/localgateway/config v0.0.0-00010101000000-000000000000
	github.com/everr-labs/everr/collector/internal/localgateway/health v0.0.0-00010101000000-000000000000
	github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp v0.0.0-00010101000000-000000000000
	go.opentelemetry.io/collector/component v1.58.0
	go.opentelemetry.io/collector/otelcol v0.152.0
	go.opentelemetry.io/collector/processor/batchprocessor v0.152.0
	go.opentelemetry.io/collector/receiver/otlpreceiver v0.152.0
	go.uber.org/zap v1.27.1
)

replace github.com/everr-labs/everr/collector/exporter/chdbexporter => ../../exporter/chdbexporter
replace github.com/everr-labs/everr/collector/internal/localgateway/chdb => ../../internal/localgateway/chdb
replace github.com/everr-labs/everr/collector/internal/localgateway/config => ../../internal/localgateway/config
replace github.com/everr-labs/everr/collector/internal/localgateway/health => ../../internal/localgateway/health
replace github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp => ../../internal/localgateway/sqlhttp
```

- [ ] **Step 2: Write CLI parse tests**

Create `collector/cmd/everr-local-collector/main_test.go`:

```go
package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseArgsUsesRequiredEndpointsAndDefaultsTTL(t *testing.T) {
	cfg, err := parseArgs([]string{
		"--otlp-http-endpoint", "http://127.0.0.1:54318",
		"--health-http-endpoint", "http://127.0.0.1:54319",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
	})
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", cfg.otlp.ListenAddress)
	require.Equal(t, "127.0.0.1:54319", cfg.health.ListenAddress)
	require.Equal(t, "127.0.0.1:54320", cfg.sql.ListenAddress)
	require.Equal(t, "/tmp/everr/chdb", cfg.chdbPath)
	require.Equal(t, 7*24*time.Hour, cfg.ttl)
}

func TestParseArgsRejectsMissingChdbPath(t *testing.T) {
	_, err := parseArgs([]string{
		"--otlp-http-endpoint", "http://127.0.0.1:54318",
		"--health-http-endpoint", "http://127.0.0.1:54319",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
	})
	require.ErrorContains(t, err, "chdb path is required")
}
```

- [ ] **Step 3: Implement command entrypoint**

Create `collector/cmd/everr-local-collector/main.go` with these key parts:

```go
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	chdbexporter "github.com/everr-labs/everr/collector/exporter/chdbexporter"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	gwconfig "github.com/everr-labs/everr/collector/internal/localgateway/config"
	"github.com/everr-labs/everr/collector/internal/localgateway/health"
	"github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/processor/batchprocessor"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/otlpreceiver"
	"go.opentelemetry.io/collector/service/telemetry/otelconftelemetry"
	"go.uber.org/zap"
)

type gatewayConfig struct {
	otlp     gwconfig.Endpoint
	health   gwconfig.Endpoint
	sql      gwconfig.Endpoint
	chdbPath string
	ttl      time.Duration
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func parseArgs(args []string) (gatewayConfig, error) {
	fs := flag.NewFlagSet("everr-local-collector", flag.ContinueOnError)
	otlpRaw := fs.String("otlp-http-endpoint", "", "OTLP HTTP endpoint URL")
	healthRaw := fs.String("health-http-endpoint", "", "health endpoint URL")
	sqlRaw := fs.String("sql-http-endpoint", "", "SQL HTTP endpoint URL")
	chdbPath := fs.String("chdb-path", "", "chDB database path")
	ttl := fs.Duration("ttl", 7*24*time.Hour, "local telemetry TTL")
	if err := fs.Parse(args); err != nil {
		return gatewayConfig{}, err
	}
	if *chdbPath == "" {
		return gatewayConfig{}, errors.New("chdb path is required")
	}
	otlp, err := gwconfig.ParseEndpoint(*otlpRaw)
	if err != nil {
		return gatewayConfig{}, fmt.Errorf("otlp http endpoint: %w", err)
	}
	healthEndpoint, err := gwconfig.ParseEndpoint(*healthRaw)
	if err != nil {
		return gatewayConfig{}, fmt.Errorf("health http endpoint: %w", err)
	}
	sqlEndpoint, err := gwconfig.ParseEndpoint(*sqlRaw)
	if err != nil {
		return gatewayConfig{}, fmt.Errorf("sql http endpoint: %w", err)
	}
	return gatewayConfig{
		otlp:     otlp,
		health:   healthEndpoint,
		sql:      sqlEndpoint,
		chdbPath: *chdbPath,
		ttl:      *ttl,
	}, nil
}

func run(args []string) error {
	cfg, err := parseArgs(args)
	if err != nil {
		return err
	}

	logger, err := zap.NewProduction()
	if err != nil {
		return err
	}
	defer func() { _ = logger.Sync() }()

	handle, err := chdb.Open(cfg.chdbPath)
	if err != nil {
		return fmt.Errorf("open chdb: %w", err)
	}
	defer func() { _ = handle.Close() }()

	healthServer := health.NewServer(cfg.health.ListenAddress)
	if err := healthServer.Start(); err != nil {
		return fmt.Errorf("start health: %w", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = healthServer.Shutdown(ctx)
	}()

	sqlServer := sqlhttp.NewServer(sqlhttp.Config{Endpoint: cfg.sql.ListenAddress}, handle, logger)
	if err := sqlServer.Start(); err != nil {
		return fmt.Errorf("start sqlhttp: %w", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = sqlServer.Shutdown(ctx)
	}()

	settings := otelcol.CollectorSettings{
		BuildInfo: component.BuildInfo{
			Command:     "everr-local-collector",
			Description: "Local diagnostic collector gateway",
			Version:     "0.1.0",
		},
		Factories: func() (otelcol.Factories, error) {
			return components(handle)
		},
		ConfigProviderSettings: otelcol.ConfigProviderSettings{
			ResolverSettings: confmap.ResolverSettings{
				URIs: []string{gwconfig.StaticURI},
				ProviderFactories: []confmap.ProviderFactory{
					gwconfig.NewStaticProviderFactory(gwconfig.BuildCollectorConfigMap(gwconfig.CollectorConfig{
						OTLPListenAddress: cfg.otlp.ListenAddress,
						TTL:               cfg.ttl,
					})),
				},
			},
		},
	}

	collector, err := otelcol.NewCollector(settings)
	if err != nil {
		return fmt.Errorf("create collector: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	runErr := make(chan error, 1)
	go func() {
		runErr <- collector.Run(ctx)
	}()

	healthServer.SetReady(true)

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return collector.Shutdown(shutdownCtx)
	case err := <-runErr:
		return err
	}
}

func components(handle *chdb.Handle) (otelcol.Factories, error) {
	factories := otelcol.Factories{
		Telemetry: otelconftelemetry.NewFactory(),
	}
	var err error
	factories.Receivers, err = otelcol.MakeFactoryMap[receiver.Factory](otlpreceiver.NewFactory())
	if err != nil {
		return otelcol.Factories{}, err
	}
	factories.Processors, err = otelcol.MakeFactoryMap[processor.Factory](batchprocessor.NewFactory())
	if err != nil {
		return otelcol.Factories{}, err
	}
	factories.Exporters, err = otelcol.MakeFactoryMap[exporter.Factory](chdbexporter.NewFactoryWithHandle(handle))
	if err != nil {
		return otelcol.Factories{}, err
	}
	factories.Extensions, err = otelcol.MakeFactoryMap[extension.Factory]()
	if err != nil {
		return otelcol.Factories{}, err
	}
	factories.Connectors, err = otelcol.MakeFactoryMap[connector.Factory]()
	if err != nil {
		return otelcol.Factories{}, err
	}
	return factories, nil
}
```

- [ ] **Step 4: Run command tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/cmd/everr-local-collector
go test ./...
```

Expected: CLI parse tests pass.

- [ ] **Step 5: Update local build target**

Modify `collector/Makefile`:

```make
.PHONY: build-local
build-local:
	GOOS=$(OS) GOARCH=$(ARCH) CGO_ENABLED=0 go build -o ./build-local/everr-local-collector ./cmd/everr-local-collector
```

Keep `build` using OCB for the main collector.

- [ ] **Step 6: Build local gateway**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
make -C collector build-local
```

Expected: `collector/build-local/everr-local-collector` exists.

- [ ] **Step 7: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/cmd/everr-local-collector collector/Makefile
git commit -m "feat: add local collector gateway binary"
```

## Task 8: Update Rust Startup To Pass Gateway Flags

**Files:**
- Modify: `packages/desktop-app/src-cli/src/telemetry/collector.rs`
- Modify: `crates/everr-core/src/collector.rs`
- Delete if unused: `crates/everr-core/assets/collector.yaml.tmpl`
- Modify tests under `packages/desktop-app/src-cli/tests/`

- [ ] **Step 1: Write Rust unit test for spawn flags**

In `packages/desktop-app/src-cli/src/telemetry/collector.rs`, extract the argument construction into:

```rust
fn collector_args(telemetry_dir: &Path) -> Result<Vec<String>> {
    Ok(vec![
        "--otlp-http-endpoint".into(),
        everr_core::build::otlp_http_origin(),
        "--health-http-endpoint".into(),
        everr_core::build::healthcheck_origin(),
        "--sql-http-endpoint".into(),
        everr_core::build::sql_http_origin(),
        "--chdb-path".into(),
        telemetry_dir.join("chdb").display().to_string(),
        "--ttl".into(),
        "168h".into(),
    ])
}
```

Add a test:

```rust
#[test]
fn collector_args_include_gateway_flags() {
    let dir = tempfile::tempdir().expect("tempdir");
    let args = collector_args(dir.path()).expect("args");
    assert!(has_pair(&args, "--otlp-http-endpoint", &everr_core::build::otlp_http_origin()));
    assert!(has_pair(&args, "--health-http-endpoint", &everr_core::build::healthcheck_origin()));
    assert!(has_pair(&args, "--sql-http-endpoint", &everr_core::build::sql_http_origin()));
    assert!(args.windows(2).any(|w| w[0] == "--chdb-path" && w[1].ends_with("/chdb")));
    assert!(has_pair(&args, "--ttl", "168h"));
}

fn has_pair(args: &[String], key: &str, value: &str) -> bool {
    args.windows(2).any(|w| w[0] == key && w[1] == value)
}
```

- [ ] **Step 2: Run Rust test and verify failure**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
cargo test -p everr-cli collector_args_include_gateway_flags
```

Expected: fails until `collector_args` exists.

- [ ] **Step 3: Change spawn_collector to use flags**

Replace the old config path flow:

```rust
let config_path =
    everr_core::collector::write_config(&telemetry_dir).context("write collector config")?;
...
let mut child = spawn_collector(&assets, &config_path).await?;
```

with:

```rust
let args = collector_args(&telemetry_dir)?;
...
let mut child = spawn_collector(&assets, &args).await?;
```

Change the function signature:

```rust
async fn spawn_collector(assets: &ExtractedAssets, args: &[String]) -> Result<Child>
```

and the command:

```rust
let mut command = Command::new(&assets.collector);
command
    .args(args)
    .env("CHDB_LIB_PATH", &assets.chdb_lib)
    .env("TZ", "UTC")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
let mut child = command
    .spawn()
    .with_context(|| format!("spawn {}", assets.collector.display()))?;
```

- [ ] **Step 4: Remove local YAML rendering after callers are gone**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
rg -n "write_config|render_config|collector.yaml.tmpl|\\.collector\\.yaml" crates packages
```

If only dead tests remain, remove `render_config`, `write_config`, and `CONFIG_TEMPLATE` from `crates/everr-core/src/collector.rs`, then delete `crates/everr-core/assets/collector.yaml.tmpl`. Keep `wait_healthcheck`, `forward_output`, and `kill_processes_on_port`.

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
cargo test -p everr-core collector
cargo test -p everr-cli telemetry
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add packages/desktop-app/src-cli/src/telemetry/collector.rs crates/everr-core/src/collector.rs crates/everr-core/assets/collector.yaml.tmpl packages/desktop-app/src-cli/tests
git commit -m "feat: spawn local collector gateway with flags"
```

## Task 9: Update Smoke Tests And Remove Old Local OCB Artifacts

**Files:**
- Modify: `collector/test/smoke/chdb_smoke_test.go`
- Delete: `collector/config/manifest.local.yaml`
- Delete: `collector/extension/sqlhttp/`
- Delete: `third_party/chdbexporter/`
- Modify: `collector/Makefile`

- [ ] **Step 1: Update smoke test startup**

Replace smoke test config file creation with gateway args:

```go
args := []string{
	"--otlp-http-endpoint", fmt.Sprintf("http://127.0.0.1:%d", otlpPort),
	"--health-http-endpoint", fmt.Sprintf("http://127.0.0.1:%d", healthPort),
	"--sql-http-endpoint", fmt.Sprintf("http://127.0.0.1:%d", sqlPort),
	"--chdb-path", chdbDir,
	"--ttl", "168h",
}
cmd := exec.CommandContext(ctx, binary, args...)
```

Delete `writeCollectorConfig` and `writeCollectorConfigWithSQL` from the smoke test file after no test calls them.

- [ ] **Step 2: Update readiness waits**

Keep:

```go
waitForHTTP(t, fmt.Sprintf("http://127.0.0.1:%d/", healthPort), 10*time.Second)
```

Then send OTLP logs and query SQL as before.

- [ ] **Step 3: Run smoke tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
make -C collector build-local
go test ./collector/test/smoke -run 'TestChdbSmoke|TestSQLHTTPRoundTrip|TestSQLHTTPParameterizedRoundTrip' -count=1
```

Expected: local gateway starts, OTLP log lands in chDB, `/sql` can query it, and write SQL is rejected.

- [ ] **Step 4: Remove old local OCB and third-party exporter**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
rm -rf collector/extension/sqlhttp
rm -rf third_party/chdbexporter
rm -f collector/config/manifest.local.yaml
```

Then search for stale imports:

```bash
rg -n "github.com/everr-labs/chdbexporter|collector/extension/sqlhttp|manifest.local.yaml|third_party/chdbexporter" .
```

Expected: no matches except in historical docs or changelog entries. Update historical docs only if they claim current behavior.

- [ ] **Step 5: Run collector-wide Go checks**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
make -C collector tidy-all
make -C collector test-all
```

Expected: all collector modules tidy and tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/guidodorsi/workspace/everr
git add collector/test/smoke collector/config collector/extension third_party collector/Makefile
git commit -m "test: update local collector gateway smoke tests"
```

## Task 10: Final Verification

**Files:**
- No planned source edits unless verification finds an issue.

- [ ] **Step 1: Build both collectors**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
make -C collector build
make -C collector build-local
```

Expected: both `collector/build/everr-collector` and `collector/build-local/everr-local-collector` exist.

- [ ] **Step 2: Run focused Go tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
go test ./collector/test/smoke -count=1
```

Expected: smoke tests pass.

- [ ] **Step 3: Run Rust tests touched by startup changes**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
cargo test -p everr-core collector
cargo test -p everr-cli telemetry
```

Expected: tests pass.

- [ ] **Step 4: Run repo search for removed architecture**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
rg -n "third_party/chdbexporter|github.com/everr-labs/chdbexporter|collector/extension/sqlhttp|manifest.local.yaml|collector.yaml.tmpl|\\.collector\\.yaml" .
```

Expected: no current-code matches. Historical design docs may still mention old paths.

- [ ] **Step 5: Verify change summary exists**

Run:

```bash
cd /Users/guidodorsi/workspace/everr
test -f collector/exporter/chdbexporter/UPSTREAM.md
test -f collector/exporter/chdbexporter/EVERR_CHANGES.md
rg -n "v0.152.0|Injected local chDB runtime|7d" collector/exporter/chdbexporter/UPSTREAM.md collector/exporter/chdbexporter/EVERR_CHANGES.md
```

Expected: both docs exist and mention the upstream version plus local runtime changes.

- [ ] **Step 6: Commit verification fixes if any**

If verification required fixes, commit them:

```bash
cd /Users/guidodorsi/workspace/everr
git add .
git commit -m "fix: complete local collector gateway migration"
```

If no files changed, do not create an empty commit.

## Self-Review Notes

Spec coverage:

- Fresh copy from upstream `clickhouseexporter v0.152.0`: Task 4.
- `collector/exporter/chdbexporter`: Tasks 4 and 5.
- Remove `third_party/chdbexporter`: Task 9.
- Hand-maintained local gateway binary: Task 7.
- Gateway initializes shared chDB and passes it to SQL HTTP/exporter: Tasks 2, 3, 5, 7.
- SQL HTTP lives in gateway: Task 3.
- Internal generated Collector config: Tasks 6 and 7.
- Upgrade both collectors to `v0.152.0`: Tasks 1, 4, 7.
- Change summary for exporter modifications: Tasks 4, 5, 10.
- CLI flags for OTLP, health, SQL HTTP, chDB path, TTL: Tasks 6, 7, 8.
- TTL starts at `7d`: Tasks 5, 6, 7, 8, 10.
- Batch timeout is `250ms`: Task 6.
- Drop spanmetrics: Task 1.

Placeholder scan:

- No deferred requirements are intentionally left unspecified.
- The plan names the exact OTel version, gateway flags, package paths, injected exporter API, default TTL, and batch timeout.

Type consistency:

- Gateway config type uses `gwconfig.Endpoint`.
- Shared chDB package is `github.com/everr-labs/everr/collector/internal/localgateway/chdb`.
- Exporter injection API is `NewFactoryWithHandle(*chdb.Handle)`.
- Gateway SQL package is `github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp`.
