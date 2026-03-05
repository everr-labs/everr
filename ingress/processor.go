package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/go-github/v67/github"
	"go.uber.org/zap"
)

type eventProcessor struct {
	cfg            config
	store          *eventStore
	tenantResolver *tenantResolver
	replayer       *collectorReplayer
	logger         *zap.Logger
}

func newEventProcessor(cfg config, store *eventStore, tenantResolver *tenantResolver, replayer *collectorReplayer, logger *zap.Logger) *eventProcessor {
	return &eventProcessor{
		cfg:            cfg,
		store:          store,
		tenantResolver: tenantResolver,
		replayer:       replayer,
		logger:         logger,
	}
}

func (p *eventProcessor) processEvent(ctx context.Context, event webhookEvent) error {
	childCtx, cancel := context.WithTimeout(ctx, p.cfg.ReplayTimeout)
	defer cancel()
	p.logger.Debug("processing event",
		zap.Int64("event_pk", event.ID),
		zap.String("event_id", event.EventID),
		zap.Int("attempt", event.Attempts),
	)

	eventType := firstHeader(event.Headers, "X-GitHub-Event")
	if eventType == "" {
		return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", "missing X-GitHub-Event header")
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
		if errors.Is(err, errTenantNotFound) {
			return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", err.Error())
		}
		return p.retryOrDead(childCtx, event, "retryable", fmt.Sprintf("resolve tenant: %v", err))
	}

	if err := p.replayer.replayEvent(childCtx, event, tenantID); err != nil {
		var terr *terminalError
		if errors.As(err, &terr) {
			return p.store.finalizeEvent(childCtx, event, eventDead, "terminal", terr.Error())
		}
		return p.retryOrDead(childCtx, event, "retryable", fmt.Sprintf("replay request failed: %v", err))
	}

	p.logger.Info("event processed",
		zap.Int64("event_pk", event.ID),
		zap.String("event_id", event.EventID),
		zap.Int64("installation_id", installationID),
		zap.Int64("tenant_id", tenantID),
	)

	return p.store.finalizeEvent(childCtx, event, eventDone, "", "")
}

func (p *eventProcessor) retryOrDead(ctx context.Context, event webhookEvent, errorClass, message string) error {
	if event.Attempts >= p.cfg.MaxAttempts {
		return p.store.finalizeEvent(ctx, event, eventDead, errorClass, message)
	}
	return p.store.finalizeEvent(ctx, event, eventFail, errorClass, message)
}
