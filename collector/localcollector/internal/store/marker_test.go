package store

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(text), 0o644))
}

// catalog lays out what chDB writes for a database: a symlink in metadata
// that points into store.
func catalog(t *testing.T, dir, database string) {
	t.Helper()
	target := filepath.Join("store", "abc", database)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, target), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, metadataDir), 0o755))
	require.NoError(t, os.Symlink(filepath.Join("..", target), filepath.Join(dir, metadataDir, database)))
}

func entryNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

func TestObserveReadsTheDirectoryWithoutChDB(t *testing.T) {
	for name, tc := range map[string]struct {
		files    map[string]string
		database string
		kind     dirKind
	}{
		"an empty directory":                      {nil, "", dirEmpty},
		"only dotfiles":                           {map[string]string{".last_flush": "1", ".DS_Store": ""}, "", dirEmpty},
		"a catalog from an older build":           {map[string]string{"data/a": "1"}, "default", dirUnmarkedStore},
		"a catalog and dotfiles":                  {map[string]string{".last_flush": "1"}, "default", dirUnmarkedStore},
		"a catalog from this build":               {map[string]string{"metadata/app.sql": "x"}, "app", dirUnmarkedStore},
		"files that are not a chDB store":         {map[string]string{"notes.txt": "mine"}, "", dirForeign},
		"a metadata file, not a directory":        {map[string]string{"metadata": "mine"}, "", dirForeign},
		"a metadata directory without a catalog":  {map[string]string{"metadata/readme.txt": "mine"}, "", dirForeign},
		"a metadata directory of .sql files only": {map[string]string{"metadata/default.sql": "x"}, "", dirForeign},
		"a marker": {map[string]string{markerName: `{"version":1,"applied":{}}`, "metadata/x": "x"}, "", dirMarked},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			for file, text := range tc.files {
				write(t, filepath.Join(dir, file), text)
			}
			if tc.database != "" {
				catalog(t, dir, tc.database)
			}

			seen, err := observe(dir)

			require.NoError(t, err)
			require.Equal(t, tc.kind, seen.kind)
			require.NoError(t, seen.markerErr)
		})
	}
}

func TestObserveTreatsAMissingDirectoryAsEmpty(t *testing.T) {
	seen, err := observe(filepath.Join(t.TempDir(), "absent"))

	require.NoError(t, err)
	require.Equal(t, dirEmpty, seen.kind)
}

func TestObserveFlagsAnUnreadableMarker(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, markerName), "{not json")

	seen, err := observe(dir)

	require.NoError(t, err)
	require.Equal(t, dirMarked, seen.kind)
	require.Error(t, seen.markerErr)
}

func TestMarkerRoundTripsThroughTheDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "chdb")
	want := marker{Version: 3, Applied: map[string]string{"0001-setup.sql": "aa", "0002-next.sql": "bb"}}

	require.NoError(t, writeMarker(dir, want))
	seen, err := observe(dir)

	require.NoError(t, err)
	require.Equal(t, dirMarked, seen.kind)
	require.Equal(t, want, seen.marker)
	require.Equal(t, []string{markerName}, entryNames(t, dir), "the temp file is gone")
}

func TestWriteMarkerReplacesTheWholeMarker(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, writeMarker(dir, marker{Version: 1, Applied: map[string]string{"a.sql": "1", "b.sql": "2"}}))
	require.NoError(t, writeMarker(dir, marker{Version: 1, Applied: map[string]string{"a.sql": "1"}}))

	seen, err := observe(dir)

	require.NoError(t, err)
	require.Equal(t, map[string]string{"a.sql": "1"}, seen.marker.Applied)
}

func TestResetEmptiesTheDirectoryAndKeepsIt(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, writeMarker(dir, marker{Version: 1, Applied: map[string]string{"a.sql": "1"}}))
	catalog(t, dir, "app")
	write(t, filepath.Join(dir, "metadata", "app.sql"), "x")
	write(t, filepath.Join(dir, ".last_flush"), "1")

	require.NoError(t, reset(dir))

	require.Empty(t, entryNames(t, dir))
}

func TestResetOfAStoppedResetLeavesAStateTheNextStartResets(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores file permissions")
	}
	dir := t.TempDir()
	require.NoError(t, writeMarker(dir, marker{Version: Version, Applied: map[string]string{"a.sql": "1"}}))
	catalog(t, dir, "app")
	write(t, filepath.Join(dir, "data", "part"), "x")
	locked := filepath.Join(dir, "store", "abc")
	write(t, filepath.Join(locked, "part"), "x")
	require.NoError(t, os.Chmod(locked, 0o500))
	t.Cleanup(func() { _ = os.Chmod(locked, 0o700) })

	require.Error(t, reset(dir), "the locked directory stops the reset")

	seen, err := observe(dir)
	require.NoError(t, err)
	require.Equal(t, dirUnmarkedStore, seen.kind, "the marker is gone and the catalog is still there")
	p, err := decide(seen, nil)
	require.NoError(t, err)
	require.Equal(t, unmarkedStore, p.reset)
}
