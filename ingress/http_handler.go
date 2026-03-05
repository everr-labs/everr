package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.uber.org/zap"
)

func (s *server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.logger.Debug("rejecting non-post webhook request", zap.String("method", r.Method))
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload, err := github.ValidatePayload(r, []byte(s.cfg.WebhookSecret))
	if err != nil {
		s.logger.Warn("webhook signature validation failed", zap.Error(err))
		http.Error(w, "invalid payload or signature", http.StatusUnauthorized)
		return
	}

	eventID := strings.TrimSpace(r.Header.Get("X-GitHub-Delivery"))
	if eventID == "" {
		s.logger.Warn("webhook missing delivery id")
		http.Error(w, "missing X-GitHub-Delivery", http.StatusBadRequest)
		return
	}

	headers := cloneHeaders(r.Header)
	bodyHash := sha256.Sum256(payload)
	bodySHA := hex.EncodeToString(bodyHash[:])

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	enqueueStatus, err := s.store.enqueueEvent(ctx, s.cfg.Source, eventID, bodySHA, headers, payload)
	if err != nil {
		s.logger.Error("enqueue failed",
			zap.String("source", s.cfg.Source),
			zap.String("event_id", eventID),
			zap.Error(err),
		)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	switch enqueueStatus {
	case "inserted":
		s.logger.Info("webhook enqueued",
			zap.String("source", s.cfg.Source),
			zap.String("event_id", eventID),
		)
		w.WriteHeader(http.StatusAccepted)
	case "duplicate":
		s.logger.Info("webhook duplicate",
			zap.String("source", s.cfg.Source),
			zap.String("event_id", eventID),
		)
		w.WriteHeader(http.StatusOK)
	case "conflict":
		s.logger.Warn("webhook conflict: delivery id reused with different body hash",
			zap.String("source", s.cfg.Source),
			zap.String("event_id", eventID),
		)
		http.Error(w, "event conflict", http.StatusConflict)
	default:
		s.logger.Error("enqueue returned unknown status",
			zap.String("status", enqueueStatus),
			zap.String("event_id", eventID),
		)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}
