package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheck(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer healthy.Close()
	if err := check(healthy.URL); err != nil {
		t.Fatalf("healthy endpoint: %v", err)
	}

	unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer unavailable.Close()
	if err := check(unavailable.URL); err == nil {
		t.Fatal("unavailable endpoint: want an error")
	}

	unavailable.Close()
	if err := check(unavailable.URL); err == nil {
		t.Fatal("closed endpoint: want an error")
	}
}
