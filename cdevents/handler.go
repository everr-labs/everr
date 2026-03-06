package main

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/go-github/v67/github"
)

func (s *server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	eventType := strings.TrimSpace(r.Header.Get(headerGitHubEvent))
	if eventType == "" {
		http.Error(w, "missing X-GitHub-Event", http.StatusBadRequest)
		return
	}

	deliveryID := strings.TrimSpace(r.Header.Get(headerGitHubID))
	if deliveryID == "" {
		http.Error(w, "missing X-GitHub-Delivery", http.StatusBadRequest)
		return
	}

	tenantID, err := parseTenantID(r.Header.Get(headerTenantID))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read request body", http.StatusBadRequest)
		return
	}

	parsed, err := github.ParseWebHook(eventType, body)
	if err != nil {
		http.Error(w, "parse webhook payload", http.StatusBadRequest)
		return
	}

	rows, err := s.transformer.Transform(transformInput{
		EventType:  eventType,
		DeliveryID: deliveryID,
		TenantID:   tenantID,
		Parsed:     parsed,
	})
	if err != nil {
		http.Error(w, "transform webhook payload", http.StatusInternalServerError)
		return
	}

	if len(rows) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	if err := s.writer.WriteRows(rows); err != nil {
		http.Error(w, "write cdevents rows", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func parseTenantID(raw string) (uint64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, errors.New("missing X-Everr-Tenant-Id")
	}

	tenantID, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, errors.New("invalid X-Everr-Tenant-Id")
	}
	return tenantID, nil
}
