// Package store owns the local telemetry store: the chDB directory, its
// format version, and the ClickHouse migrations applied to it.
//
// What decides a reset is read from the file system before chDB opens, because
// a reset deletes the directory's contents and chDB opens once per process.
package store

import (
	"context"
	"fmt"
	"io/fs"
	"maps"
	"strings"

	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"github.com/everr-labs/everr/packages/app/clickhouse"
)

// QueryDatabase is the database bare table names such as logs resolve in.
const QueryDatabase = "app"

type Options struct {
	// Path is the chDB directory. A reset deletes everything in it.
	Path        string
	LibraryPath string
	Logger      *zap.Logger
}

// Open returns the process's chDB handle on a store at Version with every
// untagged migration applied and `app` as the session's database.
//
// A statement that fails stops Open with an error that names the file, the
// statement's number and its first line. It never resets the store: the file
// stays pending and runs again from its first statement on the next start.
func Open(ctx context.Context, opts Options) (*chdb.Handle, error) {
	return open(ctx, opts, clickhouse.Files)
}

func open(ctx context.Context, opts Options, fsys fs.FS, chdbOpts ...chdb.Option) (*chdb.Handle, error) {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	local, err := localMigrations(fsys)
	if err != nil {
		return nil, err
	}
	seen, err := observe(opts.Path)
	if err != nil {
		return nil, err
	}
	p, err := decide(seen, local)
	if err != nil {
		return nil, fmt.Errorf("open local store at %s: %w", opts.Path, err)
	}

	applied := map[string]string{}
	if p.reset != noReset {
		logger.Info("Resetting the local store", zap.String("reason", string(p.reset)), zap.String("path", opts.Path))
		if err := reset(opts.Path); err != nil {
			return nil, err
		}
	} else if !p.freshMarker {
		maps.Copy(applied, seen.marker.Applied)
	}
	if p.freshMarker {
		if err := writeMarker(opts.Path, marker{Version: Version, Applied: applied}); err != nil {
			return nil, err
		}
	}

	handle, err := chdb.Open(opts.Path, append([]chdb.Option{chdb.WithLibraryPath(opts.LibraryPath)}, chdbOpts...)...)
	if err != nil {
		return nil, err
	}
	for _, m := range p.pending {
		if err := apply(ctx, handle, m, logger); err != nil {
			return nil, err
		}
		applied[m.name] = m.sum
		if err := writeMarker(opts.Path, marker{Version: Version, Applied: applied}); err != nil {
			return nil, err
		}
	}
	if err := run(ctx, handle, "USE "+QueryDatabase); err != nil {
		return nil, fmt.Errorf("use database %s: %w", QueryDatabase, err)
	}
	return handle, nil
}

func apply(ctx context.Context, handle *chdb.Handle, m migration, logger *zap.Logger) error {
	for i, statement := range statements(m.sql) {
		if classify(statement) == accessControl {
			logger.Debug("Skipping an access control statement", zap.String("migration", m.name), zap.Int("statement", i+1))
			continue
		}
		if err := run(ctx, handle, statement); err != nil {
			first, _, _ := strings.Cut(statement, "\n")
			return fmt.Errorf("migration %s statement %d (%s): %w", m.name, i+1, first, err)
		}
	}
	return nil
}

// run sends the statement with the empty output format, under which tables,
// data and functions persist across restarts.
func run(ctx context.Context, handle *chdb.Handle, statement string) error {
	return handle.Do(ctx, func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(statement, "")
		if result != nil {
			result.Free()
		}
		return err
	})
}
