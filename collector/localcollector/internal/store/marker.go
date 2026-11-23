package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// markerName lives inside the chDB directory, so deleting the store deletes
// it. chDB leaves unknown files at its root alone.
const markerName = ".everr-store.json"

// metadataDir is chDB's catalog. A reset deletes it last: while it exists,
// the next start recognizes the leftovers as a store and resets again.
const metadataDir = "metadata"

func observe(path string) (observed, error) {
	entries, err := os.ReadDir(path)
	if errors.Is(err, fs.ErrNotExist) {
		return observed{kind: dirEmpty}, nil
	}
	if err != nil {
		return observed{}, fmt.Errorf("read chDB directory %s: %w", path, err)
	}

	raw, err := os.ReadFile(filepath.Join(path, markerName))
	if err == nil {
		seen := observed{kind: dirMarked}
		seen.markerErr = json.Unmarshal(raw, &seen.marker)
		return seen, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return observed{kind: dirMarked, markerErr: err}, nil
	}

	foreign := false
	for _, entry := range entries {
		if entry.Name() == metadataDir && entry.IsDir() {
			return observed{kind: dirChDB}, nil
		}
		if entry.Name()[0] != '.' {
			foreign = true
		}
	}
	if foreign {
		return observed{kind: dirForeign}, nil
	}
	return observed{kind: dirEmpty}, nil
}

// reset empties the directory and keeps the directory itself. The marker
// goes first and the metadata directory last, so a crash at any point leaves
// a state decide resets or builds again.
func reset(path string) error {
	if err := os.Remove(filepath.Join(path, markerName)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("delete store marker: %w", err)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("read chDB directory %s: %w", path, err)
	}
	for _, entry := range entries {
		if entry.Name() != metadataDir {
			if err := os.RemoveAll(filepath.Join(path, entry.Name())); err != nil {
				return fmt.Errorf("delete %s: %w", entry.Name(), err)
			}
		}
	}
	if err := os.RemoveAll(filepath.Join(path, metadataDir)); err != nil {
		return fmt.Errorf("delete %s: %w", metadataDir, err)
	}
	return nil
}

// writeMarker writes the whole marker through a temp file and a rename, so a
// reader sees the old marker or the new one.
func writeMarker(path string, mk marker) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("create chDB directory %s: %w", path, err)
	}
	raw, err := json.MarshalIndent(mk, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(path, ".everr-store-*.tmp")
	if err != nil {
		return fmt.Errorf("write store marker: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("write store marker: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("write store marker: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write store marker: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(path, markerName)); err != nil {
		return fmt.Errorf("write store marker: %w", err)
	}
	return nil
}
