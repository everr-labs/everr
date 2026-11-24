package chdbtest

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type Session struct {
	Fail bool

	mu   sync.Mutex
	sent []string
}

type result struct{}

func (result) Buf() []byte { return nil }
func (result) Free()       {}

func (s *Session) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail {
		return nil, errors.New("chDB says no")
	}
	s.sent = append(s.sent, query)
	return result{}, nil
}

func (s *Session) Close()       {}
func (s *Session) Path() string { return "" }

func (s *Session) Statements() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.sent...)
}

// Open returns a handle on a recording session. chDB opens once per process,
// so the handle is released when the test ends.
func Open(t *testing.T) (*chdb.Handle, *Session) {
	t.Helper()
	chdb.ResetForTesting()
	session := &Session{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(string) (chdb.Session, error) {
		return session, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = handle.Close()
		chdb.ResetForTesting()
	})
	return handle, session
}
