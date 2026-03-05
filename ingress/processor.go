package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/go-github/v67/github"
	"go.uber.org/zap"
)

type eventProcessor struct {
	cfg              config
	store            *eventStore
	tenantResolver   *tenantResolver
	replayer         *collectorReplayer
	installForwarder *installationEventForwarder
	logger           *zap.Logger
}

// newEventProcessor creates the background event processor with all required dependencies.
func newEventProcessor(cfg config, store *eventStore, tenantResolver *tenantResolver, replayer *collectorReplayer, installForwarder *installationEventForwarder, logger *zap.Logger) *eventProcessor {
	return &eventProcessor{
		cfg:              cfg,
		store:            store,
		tenantResolver:   tenantResolver,
		replayer:         replayer,
		installForwarder: installForwarder,
		logger:           logger,
	}
}

// processEvent resolves tenant context and routes a claimed event to the correct downstream target.
func (p *eventProcessor) processEvent(ctx context.Context, event webhookEvent) error {
	childCtx, cancel := context.WithTimeout(ctx, p.cfg.ReplayTimeout)
	defer cancel()
	p.logger.Debug("processing event",
		zap.Int64("event_pk", event.ID),
		zap.String("event_id", event.EventID),
		zap.Int("attempt", event.Attempts),
	)

	eventType := strings.TrimSpace(event.Headers.Get("X-GitHub-Event"))
	if eventType == "" {
		return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", "missing X-GitHub-Event header")
	}
	if eventType == "installation" || eventType == "installation_repositories" {
		if p.installForwarder == nil {
			p.logger.Debug("installation event forwarding disabled, dropping event", zap.String("event_type", eventType), zap.String("event_id", event.EventID))
			return p.store.finalizeEvent(childCtx, event, eventDone, "", "")
		}

		if err := p.installForwarder.forwardEvent(childCtx, event); err != nil {
			return p.finalizeStepError(childCtx, event, "forward installation event failed", err)
		}

		p.logger.Info("installation event forwarded", zap.Int64("event_pk", event.ID), zap.String("event_id", event.EventID), zap.String("event_type", eventType))
		return p.store.finalizeEvent(childCtx, event, eventDone, "", "")
	}

	parsedEvent, err := github.ParseWebHook(eventType, event.Body)
	if err != nil {
		return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", fmt.Sprintf("parse webhook: %v", err))
	}

	installationEvent, ok := parsedEvent.(githubWebhookWithInstallation)
	if !ok {
		return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", "unsupported webhook event type")
	}
	installationID, err := installationIDFromWebhookEvent(installationEvent)
	if err != nil {
		return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", err.Error())
	}

	tenantID, err := p.tenantResolver.ResolveTenantID(childCtx, installationID)
	if err != nil {
		return p.finalizeStepError(childCtx, event, "resolve tenant failed", err)
	}

	if err := p.replayer.replayEvent(childCtx, event, tenantID); err != nil {
		return p.finalizeStepError(childCtx, event, "replay request failed", err)
	}

	p.logger.Info("event processed",
		zap.Int64("event_pk", event.ID),
		zap.String("event_id", event.EventID),
		zap.Int64("installation_id", installationID),
		zap.Int64("tenant_id", tenantID),
	)

	return p.store.finalizeEvent(childCtx, event, eventDone, "", "")
}

// retryOrDead marks a failed event for retry or dead-lettering based on attempt limits.
func (p *eventProcessor) retryOrDead(ctx context.Context, event webhookEvent, errorClass, message string) error {
	if event.Attempts >= p.cfg.MaxAttempts {
		return p.store.finalizeEvent(ctx, event, eventDead, errorClass, message)
	}
	return p.store.finalizeEvent(ctx, event, eventFail, errorClass, message)
}

func (p *eventProcessor) finalizeStepError(ctx context.Context, event webhookEvent, message string, err error) error {
	var terr *terminalError
	if errors.As(err, &terr) {
		return p.store.finalizeEvent(ctx, event, eventDead, "terminal", terr.Error())
	}
	return p.retryOrDead(ctx, event, "retryable", fmt.Sprintf("%s: %v", message, err))
}
