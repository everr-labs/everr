package clickhouseexporter

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/exporter/exportertest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type fakeChDBResult struct {
	buf []byte
}

func (r fakeChDBResult) Buf() []byte { return r.buf }
func (r fakeChDBResult) Free()       {}

type fakeChDBSession struct {
	path    string
	queries []string
	mu      sync.Mutex
}

func (s *fakeChDBSession) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	return fakeChDBResult{buf: []byte(`{"name":"EventName","type":"String"}` + "\n")}, nil
}

func (s *fakeChDBSession) Close()       {}
func (s *fakeChDBSession) Path() string { return s.path }

func TestDefaultConfigIsLocalChDBConfig(t *testing.T) {
	cfg := createDefaultConfig().(*Config)

	require.NoError(t, cfg.Validate())
	require.Empty(t, cfg.Endpoint)
	require.Equal(t, 7*24*time.Hour, cfg.TTL)
}

func TestFactoryWithHandleStartsLogsExporter(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	factory := NewFactoryWithHandle(handle)
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.CreateSchema = false
	})
	params := exportertest.NewNopSettings(metadata.Type)

	exp, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), nil))
	require.NoError(t, exp.Shutdown(t.Context()))

	session.mu.Lock()
	defer session.mu.Unlock()
	require.NotEmpty(t, session.queries)
}

func TestFactoryWithoutHandleFailsOnStart(t *testing.T) {
	factory := NewFactory()
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.CreateSchema = false
	})
	params := exportertest.NewNopSettings(metadata.Type)

	exp, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.ErrorContains(t, exp.Start(t.Context(), nil), "chdb handle is required")
}
