package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type recordingSession struct {
	path   string
	mu     sync.Mutex
	sent   []string
	failOn string
}

type emptyResult struct{}

func (emptyResult) Buf() []byte { return nil }
func (emptyResult) Free()       {}

func (s *recordingSession) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failOn != "" && strings.Contains(query, s.failOn) {
		return nil, errors.New("chDB says no")
	}
	s.sent = append(s.sent, query)
	if database, ok := strings.CutPrefix(query, "CREATE DATABASE "); ok {
		return emptyResult{}, s.linkCatalog(database)
	}
	return emptyResult{}, nil
}

// linkCatalog writes what chDB writes for a new database.
func (s *recordingSession) linkCatalog(database string) error {
	target := filepath.Join("store", "abc", database)
	if err := os.MkdirAll(filepath.Join(s.path, target), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(s.path, metadataDir), 0o755); err != nil {
		return err
	}
	err := os.Symlink(filepath.Join("..", target), filepath.Join(s.path, metadataDir, database))
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	return err
}

func (s *recordingSession) Close()       {}
func (s *recordingSession) Path() string { return s.path }

func (s *recordingSession) statements() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.sent...)
}

// start runs open with a fake session and returns it. chDB pins one path per
// process, so each start releases the previous handle first.
func start(t *testing.T, dir string, fsys fstest.MapFS, failOn string) (*recordingSession, error) {
	t.Helper()
	chdb.ResetForTesting()
	t.Cleanup(chdb.ResetForTesting)
	session := &recordingSession{failOn: failOn}
	_, err := open(context.Background(), Options{Path: dir}, fsys, chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	return session, err
}

func migrationFiles() fstest.MapFS {
	return fstest.MapFS{
		"0001-setup.sql":  {Data: []byte("CREATE DATABASE app;")},
		"0003-tables.sql": {Data: []byte("-- the table\nCREATE TABLE app.t (\n  a UInt8\n) ENGINE = Null;\nCREATE TABLE app.u (a UInt8) ENGINE = Null;")},
	}
}

func appliedNames(t *testing.T, dir string) []string {
	t.Helper()
	seen, err := observe(dir)
	require.NoError(t, err)
	require.NoError(t, seen.markerErr)
	return sortedKeys(seen.marker.Applied)
}

func TestOpenAppliesEveryFileInOrderAndEndsOnTheQueryDatabase(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")

	session, err := start(t, dir, migrationFiles(), "")

	require.NoError(t, err)
	require.Equal(t, []string{
		"CREATE DATABASE app",
		"CREATE TABLE app.t (\n  a UInt8\n) ENGINE = Null",
		"CREATE TABLE app.u (a UInt8) ENGINE = Null",
		"USE app",
	}, session.statements())
	require.Equal(t, []string{"0001-setup.sql", "0003-tables.sql"}, appliedNames(t, dir))
}

func TestOpenAppliesOnlyANewFileToAKeptStore(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	files := migrationFiles()
	_, err := start(t, dir, files, "")
	require.NoError(t, err)
	files["0004-more.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE app.v (a UInt8) ENGINE = Null;")}

	session, err := start(t, dir, files, "")

	require.NoError(t, err)
	require.Equal(t, []string{"CREATE TABLE app.v (a UInt8) ENGINE = Null", "USE app"}, session.statements())
	require.Equal(t, []string{"0001-setup.sql", "0003-tables.sql", "0004-more.sql"}, appliedNames(t, dir))
}

func TestOpenNamesTheFileAndStatementThatFailedAndKeepsTheStore(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	files := migrationFiles()
	_, err := start(t, dir, fstest.MapFS{"0001-setup.sql": files["0001-setup.sql"]}, "")
	require.NoError(t, err)
	write(t, filepath.Join(dir, "metadata", "app.sql"), "data that must survive")

	_, err = start(t, dir, files, "app.u")

	require.ErrorContains(t, err, "0003-tables.sql")
	require.ErrorContains(t, err, "statement 2")
	require.ErrorContains(t, err, "CREATE TABLE app.u (a UInt8) ENGINE = Null")
	require.ErrorContains(t, err, "chDB says no")
	require.Equal(t, []string{"0001-setup.sql"}, appliedNames(t, dir), "the failed file is not recorded")
	require.FileExists(t, filepath.Join(dir, "metadata", "app.sql"), "a failed statement never resets the store")
}

func TestOpenRunsAFailedFileAgainFromItsFirstStatement(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	_, err := start(t, dir, migrationFiles(), "app.u")
	require.Error(t, err)

	session, err := start(t, dir, migrationFiles(), "")

	require.NoError(t, err)
	require.Equal(t, []string{
		"CREATE TABLE app.t (\n  a UInt8\n) ENGINE = Null",
		"CREATE TABLE app.u (a UInt8) ENGINE = Null",
		"USE app",
	}, session.statements())
	require.Equal(t, []string{"0001-setup.sql", "0003-tables.sql"}, appliedNames(t, dir))
}

func TestOpenResetsAStoreWhoseVersionDiffers(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	require.NoError(t, writeMarker(dir, marker{Version: Version + 1, Applied: map[string]string{"0001-setup.sql": "x"}}))
	write(t, filepath.Join(dir, "metadata", "app.sql"), "old")
	write(t, filepath.Join(dir, "data", "part"), "old")

	session, err := start(t, dir, migrationFiles(), "")

	require.NoError(t, err)
	require.NoFileExists(t, filepath.Join(dir, "metadata", "app.sql"))
	require.NoFileExists(t, filepath.Join(dir, "data", "part"))
	require.Len(t, session.statements(), 4, "every file runs again")
	seen, err := observe(dir)
	require.NoError(t, err)
	require.Equal(t, Version, seen.marker.Version)
}

func TestOpenFinishesAResetThatStopped(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores file permissions")
	}
	for name, locked := range map[string]string{
		"at the first entry":           "data",
		"while deleting the catalog":   filepath.Join("metadata", "zz"),
		"after the catalog is deleted": filepath.Join("store", "abc"),
	} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "chdb")
			require.NoError(t, writeMarker(dir, marker{Version: Version + 1, Applied: map[string]string{"0001-setup.sql": "x"}}))
			catalog(t, dir, "app")
			write(t, filepath.Join(dir, "metadata", "app.sql"), "old")
			write(t, filepath.Join(dir, "data", "part"), "old")
			write(t, filepath.Join(dir, locked, "part"), "old")
			require.NoError(t, os.Chmod(filepath.Join(dir, locked), 0o500))
			t.Cleanup(func() { _ = os.Chmod(filepath.Join(dir, locked), 0o700) })
			_, err := start(t, dir, migrationFiles(), "")
			require.Error(t, err, "the locked directory stops the reset")
			require.NoError(t, os.Chmod(filepath.Join(dir, locked), 0o700))

			session, err := start(t, dir, migrationFiles(), "")

			require.NoError(t, err)
			require.Len(t, session.statements(), 4, "every file runs again")
			require.NoDirExists(t, filepath.Join(dir, "data"))
			require.Equal(t, []string{"0001-setup.sql", "0003-tables.sql"}, appliedNames(t, dir))
		})
	}
}

func TestOpenResetsAStoreFromBeforeTheMarker(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	catalog(t, dir, "default")
	write(t, filepath.Join(dir, "store", "abc", "default", "t.sql"), "old")
	write(t, filepath.Join(dir, ".last_flush"), "1")

	session, err := start(t, dir, migrationFiles(), "")

	require.NoError(t, err)
	require.NoDirExists(t, filepath.Join(dir, "store", "abc", "default"))
	require.NoFileExists(t, filepath.Join(dir, metadataDir, "default"))
	require.Len(t, session.statements(), 4)
}

func TestOpenRefusesADirectoryThatIsNotAStore(t *testing.T) {
	for name, files := range map[string]map[string]string{
		"a file":                             {"notes.txt": "mine"},
		"a metadata folder that is not chDB": {"notes.txt": "mine", "metadata/readme.txt": "also mine"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			for file, text := range files {
				write(t, filepath.Join(dir, file), text)
			}

			session, err := start(t, dir, migrationFiles(), "")

			require.ErrorIs(t, err, errForeignDirectory)
			require.ErrorContains(t, err, dir)
			require.Empty(t, session.statements())
			for file, text := range files {
				content, readErr := os.ReadFile(filepath.Join(dir, file))
				require.NoError(t, readErr)
				require.Equal(t, text, string(content))
			}
		})
	}
}
