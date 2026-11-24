package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// chDB leaves unknown files at its root alone.
const markerName = ".everr-store.json"

// A reset writes the tombstone before it deletes anything and removes it
// last, so a reset that stopped anywhere reads as one to finish.
const tombstoneName = ".everr-store-reset"

const metadataDir = "metadata"

func observe(path string) (observed, error) {
	entries, err := os.ReadDir(path)
	if errors.Is(err, fs.ErrNotExist) {
		return observed{kind: dirEmpty}, nil
	}
	if err != nil {
		return observed{}, fmt.Errorf("read chDB directory %s: %w", path, err)
	}

	if _, err := os.Lstat(filepath.Join(path, tombstoneName)); err == nil {
		return observed{kind: dirResetStopped}, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return observed{}, fmt.Errorf("read chDB directory %s: %w", path, err)
	}

	raw, err := os.ReadFile(filepath.Join(path, markerName))
	if err == nil {
		seen := observed{kind: dirMarked, queryDatabase: hasDatabase(path, QueryDatabase)}
		seen.markerErr = json.Unmarshal(raw, &seen.marker)
		return seen, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return observed{kind: dirMarked, markerErr: err}, nil
	}

	if hasCatalog(path) {
		return observed{kind: dirUnmarkedStore}, nil
	}
	for _, entry := range entries {
		if entry.Name()[0] != '.' {
			return observed{kind: dirForeign}, nil
		}
	}
	return observed{kind: dirEmpty}, nil
}

// hasCatalog reports whether chDB has written its catalog here. chDB links
// each database's name in metadata to its directory under store, a layout
// that a folder that merely happens to be called metadata does not have.
func hasCatalog(path string) bool {
	entries, err := os.ReadDir(filepath.Join(path, metadataDir))
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.Type()&fs.ModeSymlink != 0 {
			return true
		}
	}
	return false
}

// hasDatabase reports whether chDB's catalog lists the database.
func hasDatabase(path, name string) bool {
	info, err := os.Lstat(filepath.Join(path, metadataDir, name))
	return err == nil && info.Mode()&fs.ModeSymlink != 0
}

func reset(path string) error {
	tombstone := filepath.Join(path, tombstoneName)
	if err := os.WriteFile(tombstone, nil, 0o600); err != nil {
		return fmt.Errorf("mark the store reset: %w", err)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("read chDB directory %s: %w", path, err)
	}
	for _, entry := range entries {
		if entry.Name() == tombstoneName {
			continue
		}
		if err := os.RemoveAll(filepath.Join(path, entry.Name())); err != nil {
			return fmt.Errorf("delete %s: %w", entry.Name(), err)
		}
	}
	if err := os.Remove(tombstone); err != nil {
		return fmt.Errorf("finish the store reset: %w", err)
	}
	return nil
}

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
