package e2e

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	everrcli "github.com/everr-labs/everr/packages/cli"
)

func TestUpgradeIsANoopWhenAlreadyUpToDate(t *testing.T) {
	url, requests := releaseMetadataServer(t, everrcli.Version)
	out := NewEnv(t).WithReleaseMetadataURL(url).Run("upgrade").Success(t).Stdout
	assertContains(t, out, "Already up to date")
	assertNotContains(t, out, updateNotice)
	if got := requests.Load(); got != 1 {
		t.Fatalf("metadata requests = %d, want 1", got)
	}
}

func TestUpgradeRefusesToReplaceADebugBuild(t *testing.T) {
	url, _ := releaseMetadataServer(t, "2099.1.0")
	res := NewEnv(t).WithReleaseMetadataURL(url).Run("upgrade").Failure(t, 1)
	assertContains(t, res.Stderr, "refusing to self-update a debug build")
}

func TestUpgradeReplacesTheRunningBinaryWithTheVerifiedDownload(t *testing.T) {
	name := map[string]string{
		"darwin/arm64": "everr", "linux/arm64": "everr-linux-arm64", "linux/amd64": "everr-linux-x86_64",
	}[runtime.GOOS+"/"+runtime.GOARCH]
	if name == "" {
		t.Skip("no release artifact for this platform")
	}
	release := []byte("#!/bin/sh\necho upgraded\n")
	sum := sha256.Sum256(release)
	artifacts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/" + name:
			_, _ = w.Write(release)
		case "/" + name + ".sha256":
			fmt.Fprintf(w, "%s  %s\n", hex.EncodeToString(sum[:]), name)
		default:
			http.NotFound(w, r)
		}
	}))
	defer artifacts.Close()
	url, _ := releaseMetadataServer(t, "2099.1.0")

	installed := filepath.Join(t.TempDir(), "everr")
	current, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, current, 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := NewEnv(t).WithReleaseMetadataURL(url).
		Setenv("EVERR_DOWNLOAD_BASE_URL_FOR_TESTS", artifacts.URL).
		Command("upgrade")
	cmd.Path, cmd.Args[0] = installed, installed
	out := RunCmd(t, cmd).Success(t).Stdout
	assertContains(t, out, "Downloading Everr CLI v2099.1.0...", "→ v2099.1.0")

	got, err := os.ReadFile(installed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, release) {
		t.Fatal("installed binary was not replaced with the download")
	}
}
