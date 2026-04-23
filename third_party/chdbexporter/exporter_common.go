package clickhouseexporter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

type chdbRunner struct {
	cfg    *Config
	logger *zap.Logger
	handle *chdbhandle.Handle
}

func (r *chdbRunner) ensureHandle() error {
	if r.handle != nil {
		return nil
	}
	handle, err := chdbhandle.Open(r.cfg.Path)
	if err != nil {
		return err
	}
	r.handle = handle
	return nil
}

func (r *chdbRunner) exec(ctx context.Context, sql string) error {
	if err := r.ensureHandle(); err != nil {
		return err
	}

	return r.handle.Do(ctx, func(_ context.Context, s chdbhandle.Session) error {
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

func (r *chdbRunner) execAll(ctx context.Context, queries ...string) error {
	for _, query := range queries {
		if err := r.exec(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

func (r *chdbRunner) insertRows(ctx context.Context, table string, rows []map[string]any) error {
	if len(rows) == 0 {
		return nil
	}
	if err := r.ensureHandle(); err != nil {
		return err
	}

	var body strings.Builder
	body.WriteString(fmt.Sprintf("INSERT INTO %q.%q FORMAT JSONEachRow\n", r.cfg.database(), table))
	for _, row := range rows {
		encoded, err := json.Marshal(row)
		if err != nil {
			return err
		}
		body.Write(encoded)
		body.WriteByte('\n')
	}

	if err := r.exec(ctx, body.String()); err != nil {
		return err
	}
	return touchSentinel(r.cfg.Path)
}

func touchSentinel(path string) error {
	sentinel := filepath.Join(path, ".last_flush")
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(sentinel, nil, 0o644); err != nil {
		return err
	}
	now := time.Now()
	return os.Chtimes(sentinel, now, now)
}

func formatTimestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05.999999999")
}
