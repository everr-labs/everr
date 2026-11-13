// Package session stores the signed-in Everr Cloud session.
package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gofrs/flock"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

// Session is the saved login. The JSON field names are the on-disk format
// shared with the previous CLI.
type Session struct {
	APIBaseURL string `json:"api_base_url"`
	Token      string `json:"token"`
}

func (s *Session) UnmarshalJSON(data []byte) error {
	var raw struct {
		APIBaseURL *string `json:"api_base_url"`
		Token      *string `json:"token"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw.APIBaseURL == nil {
		return errors.New("missing field `api_base_url`")
	}
	if raw.Token == nil {
		return errors.New("missing field `token`")
	}
	s.APIBaseURL, s.Token = *raw.APIBaseURL, *raw.Token
	return nil
}

// Older files carry extra top-level keys (settings); they are ignored on load
// and dropped on the next save.
type sessionFile struct {
	Session *Session `json:"session"`
}

// Store reads and writes the session file in one directory.
type Store struct {
	dir string
}

// User returns the store in the user's config directory.
func User() (*Store, error) {
	dir, err := UserConfigDir()
	if err != nil {
		return nil, err
	}
	return At(dir), nil
}

// At returns a store rooted at dir.
func At(dir string) *Store { return &Store{dir: dir} }

// Path is the session file's location.
func (s *Store) Path() string {
	return filepath.Join(s.dir, build.SessionFileName)
}

// Load returns the saved session, or nil when there is none.
func (s *Store) Load() (*Session, error) {
	path := s.Path()
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var file sessionFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("Invalid session file %s: %w", path, err)
	}
	return file.Session, nil
}

// Save replaces the saved session atomically.
func (s *Store) Save(session Session) error {
	unlock, err := s.lock()
	if err != nil {
		return err
	}
	defer unlock()
	data, err := json.MarshalIndent(sessionFile{Session: &session}, "", "  ")
	if err != nil {
		return err
	}
	// CreateTemp makes the file 0600, which the token needs.
	tmp, err := os.CreateTemp(s.dir, ".tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.Path())
}

// Clear removes the saved session only if it is still expected, so a logout
// racing a newer login keeps the newer one. It reports whether it removed it.
func (s *Store) Clear(expected Session) (bool, error) {
	unlock, err := s.lock()
	if err != nil {
		return false, err
	}
	defer unlock()
	current, err := s.Load()
	if err != nil {
		return false, err
	}
	if current == nil || *current != expected {
		return false, nil
	}
	return true, os.Remove(s.Path())
}

// Wipe removes the saved session, if any.
func (s *Store) Wipe() error {
	unlock, err := s.lock()
	if err != nil {
		return err
	}
	defer unlock()
	if err := os.Remove(s.Path()); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func (s *Store) lock() (unlock func(), err error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	path := strings.TrimSuffix(s.Path(), filepath.Ext(s.Path())) + ".lock"
	lock := flock.New(path)
	if err := lock.Lock(); err != nil {
		return nil, err
	}
	return func() { _ = lock.Close() }, nil
}

// UserConfigDir is where the session lives: EVERR_CONFIG_DIR, else the
// platform config directory the previous CLI used.
func UserConfigDir() (string, error) {
	if dir, ok := os.LookupEnv("EVERR_CONFIG_DIR"); ok {
		if !filepath.IsAbs(dir) {
			return "", errors.New("EVERR_CONFIG_DIR must be an absolute path")
		}
		return dir, nil
	}
	base, err := platformConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve user config dir: %w", err)
	}
	return filepath.Join(base, build.SessionNamespace), nil
}

// platformConfigDir follows the Rust `dirs::config_dir` rules so existing
// sessions are found after upgrading.
func platformConfigDir() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support"), nil
	case "windows":
		if dir := os.Getenv("APPDATA"); dir != "" {
			return dir, nil
		}
		return "", errors.New("%APPDATA% is not set")
	default:
		if dir := os.Getenv("XDG_CONFIG_HOME"); filepath.IsAbs(dir) {
			return dir, nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".config"), nil
	}
}
