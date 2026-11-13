package session

import (
	"encoding/json"
	"os"
	"reflect"
	"runtime"
	"testing"
)

func TestOldSessionFilesStayReadableAndSavingKeepsOnlyURLAndToken(t *testing.T) {
	store := At(t.TempDir())
	old := `{"session":{"api_base_url":"https://example.test","token":"old-token"},"settings":{"wizard_completed":true}}`
	if err := os.WriteFile(store.Path(), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := store.Load()
	if err != nil || session == nil {
		t.Fatalf("load: %v, %v", session, err)
	}
	session.Token = "new-token"
	if err := store.Save(*session); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	var saved any
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"session": map[string]any{"api_base_url": "https://example.test", "token": "new-token"}}
	if !reflect.DeepEqual(saved, want) {
		t.Errorf("saved %v, want %v", saved, want)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(store.Path())
		if err != nil {
			t.Fatal(err)
		}
		if perm := info.Mode().Perm(); perm != 0o600 {
			t.Errorf("session file mode %o, want 600", perm)
		}
	}
}

func TestClearingASessionPreservesANewerLogin(t *testing.T) {
	store := At(t.TempDir())
	old := Session{APIBaseURL: "https://example.test", Token: "old-token"}
	newer := Session{APIBaseURL: old.APIBaseURL, Token: "new-token"}
	for _, s := range []Session{old, newer} {
		if err := store.Save(s); err != nil {
			t.Fatal(err)
		}
	}

	if cleared, err := store.Clear(old); err != nil || cleared {
		t.Fatalf("clear old: %v, %v", cleared, err)
	}
	if got, _ := store.Load(); got == nil || *got != newer {
		t.Fatalf("session after clearing old = %v, want %v", got, newer)
	}
	if cleared, err := store.Clear(newer); err != nil || !cleared {
		t.Fatalf("clear newer: %v, %v", cleared, err)
	}
	if got, _ := store.Load(); got != nil {
		t.Fatalf("session after clear = %v, want none", got)
	}
	if cleared, err := store.Clear(newer); err != nil || cleared {
		t.Fatalf("clear again: %v, %v", cleared, err)
	}
}

func TestWipeRemovesTheSessionAndToleratesNone(t *testing.T) {
	store := At(t.TempDir())
	if err := store.Wipe(); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(Session{APIBaseURL: "https://example.test", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Wipe(); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Load(); got != nil {
		t.Fatalf("session after wipe = %v", got)
	}
}

func TestConfigDirMustBeAbsolute(t *testing.T) {
	t.Setenv("EVERR_CONFIG_DIR", "relative/dir")
	if _, err := UserConfigDir(); err == nil {
		t.Fatal("relative EVERR_CONFIG_DIR was accepted")
	}
}
