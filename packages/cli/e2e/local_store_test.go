package e2e

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func (i *instance) storeDir() string {
	return filepath.Join(i.data, "chdb")
}

type storeMarker struct {
	Version int               `json:"version"`
	Applied map[string]string `json:"applied"`
}

func (i *instance) storeMarker(t *testing.T) storeMarker {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(i.storeDir(), ".everr-store.json"))
	if err != nil {
		t.Fatal(err)
	}
	var marker storeMarker
	if err := json.Unmarshal(raw, &marker); err != nil {
		t.Fatalf("store marker: %v\n%s", err, raw)
	}
	return marker
}

func (i *instance) logCount(t *testing.T) string {
	t.Helper()
	return i.Run("local", "query", "SELECT count() AS logs FROM logs", "--format", "ndjson").Success(t).Stdout
}

func TestTheLocalStoreKeepsTelemetryAcrossRestartsAndStartsEmptyOnAnotherVersion(t *testing.T) {
	i := newInstance(t)
	i.Run("local", "start", "-d", "--no-open").Success(t)
	i.sendLog(t, "before-restart")
	i.waitLog(t, "before-restart")
	built := i.storeMarker(t)
	if len(built.Applied) == 0 {
		t.Fatal("the marker lists no applied migration")
	}
	i.Run("local", "stop").Success(t)

	i.Run("local", "start", "-d", "--no-open").Success(t)
	i.waitLog(t, "before-restart")
	i.Run("local", "stop").Success(t)

	other, err := json.Marshal(storeMarker{Version: built.Version + 1, Applied: built.Applied})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(i.storeDir(), ".everr-store.json"), other, 0o644); err != nil {
		t.Fatal(err)
	}
	i.Run("local", "start", "-d", "--no-open").Success(t)
	if got := i.logCount(t); got != `{"logs":0}`+"\n" {
		t.Fatalf("a store on another version kept its rows: %s", got)
	}
	if got := i.storeMarker(t); got.Version != built.Version || len(got.Applied) != len(built.Applied) {
		t.Fatalf("marker after the rebuild = %+v, want version %d with %d migrations", got, built.Version, len(built.Applied))
	}
	i.sendLog(t, "after-rebuild")
	i.waitLog(t, "after-rebuild")
}

func TestAStoreFromBeforeTheMigrationsIsReplacedByAnEmptyOne(t *testing.T) {
	i := newInstance(t)
	// The layout chDB 26.7 writes for a table in the default database, which
	// is where the CLI before the migrations kept its tables.
	database := filepath.Join("store", "3cf", "3cfec65e-7563-48c2-8606-42e12443c558")
	table := filepath.Join("store", "70d", "70d94429-672b-4847-82c4-8cce0efdd3c4")
	for _, dir := range []string{database, filepath.Join(table, "all_1_1_0"), filepath.Join("data", "default"), "metadata"} {
		if err := os.MkdirAll(filepath.Join(i.storeDir(), dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for link, target := range map[string]string{
		filepath.Join("metadata", "default"):          filepath.Join("..", database),
		filepath.Join("data", "default", "otel_logs"): filepath.Join("..", "..", table),
	} {
		if err := os.Symlink(target, filepath.Join(i.storeDir(), link)); err != nil {
			t.Fatal(err)
		}
	}
	leftovers := []string{
		filepath.Join(i.storeDir(), database, "otel_logs.sql"),
		filepath.Join(i.storeDir(), table, "all_1_1_0", "data.bin"),
		filepath.Join(i.storeDir(), ".last_flush"),
	}
	for _, file := range leftovers {
		if err := os.WriteFile(file, []byte("old"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	leftovers = append(leftovers, filepath.Join(i.storeDir(), "metadata", "default"))

	i.Run("local", "start", "-d", "--no-open").Success(t)

	if got := i.logCount(t); got != `{"logs":0}`+"\n" {
		t.Fatalf("log count on the replaced store = %s", got)
	}
	for _, file := range leftovers {
		if _, err := os.Lstat(file); !os.IsNotExist(err) {
			t.Fatalf("%s survived the reset", file)
		}
	}
	if len(i.storeMarker(t).Applied) == 0 {
		t.Fatal("the marker lists no applied migration")
	}
	i.sendLog(t, "after-upgrade")
	i.waitLog(t, "after-upgrade")
}
