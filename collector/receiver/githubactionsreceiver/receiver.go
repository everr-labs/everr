// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/bradleyfalzon/ghinstallation/v2"
	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/receiverhelper"
	"go.uber.org/zap"
)

var errMissingEndpoint = errors.New("missing a receiver endpoint")
var errMissingInstallationIDFromEvent = errors.New("missing installation.id in webhook payload")
var errMissingGitHubAuth = errors.New("github api authentication is not configured")
var errMissingTenantResolver = errors.New("tenant resolver is not configured")

const maxPayloadSize = 25 * 1024 * 1024 // 25 MB — GitHub webhook max payload size

type githubActionsReceiver struct {
	logsConsumer   consumer.Logs
	tracesConsumer consumer.Traces
	config         *Config
	server         *http.Server
	serverMu       sync.Mutex
	shutdownWG     sync.WaitGroup
	settings       receiver.Settings
	logger         *zap.Logger
	obsrecv        *receiverhelper.ObsReport
	ghClient       *github.Client
	tenantResolver *tenantResolver
	forwardClient  *http.Client
}

func newReceiver(
	settings receiver.Settings,
	config *Config,
) (*githubActionsReceiver, error) {
	if config.NetAddr.Endpoint == "" {
		return nil, errMissingEndpoint
	}

	transport := "http"
	if config.TLS.HasValue() {
		transport = "https"
	}

	obsrecv, err := receiverhelper.NewObsReport(receiverhelper.ObsReportSettings{
		ReceiverID:             settings.ID,
		Transport:              transport,
		ReceiverCreateSettings: settings,
	})

	if err != nil {
		return nil, err
	}

	ghClient := github.NewClient(nil)

	if config.GitHubAPIConfig.BaseURL != "" && config.GitHubAPIConfig.UploadURL != "" {
		ghClient, err = ghClient.WithEnterpriseURLs(config.GitHubAPIConfig.BaseURL, config.GitHubAPIConfig.UploadURL)
		if err != nil {
			return nil, err
		}
	}

	var tenantResolver *tenantResolver
	if config.TenantResolution.PostgresDSN != "" {
		tenantResolver, err = newTenantResolver(config.TenantResolution.PostgresDSN, config.TenantResolution.CacheTTL)
		if err != nil {
			return nil, err
		}
	}

	gar := &githubActionsReceiver{
		config:         config,
		settings:       settings,
		logger:         settings.Logger,
		obsrecv:        obsrecv,
		ghClient:       ghClient,
		tenantResolver: tenantResolver,
		forwardClient: &http.Client{
			Timeout: config.EventForwarding.Timeout,
		},
	}

	return gar, nil
}

// newLogsReceiver creates a trace receiver based on provided config.
func newTracesReceiver(
	_ context.Context,
	set receiver.Settings,
	cfg component.Config,
	consumer consumer.Traces,
) (receiver.Traces, error) {
	rCfg := cfg.(*Config)
	var err error

	r := receivers.GetOrAdd(cfg, func() component.Component {
		var rcv component.Component
		rcv, err = newReceiver(set, rCfg)
		return rcv
	})
	if err != nil {
		return nil, err
	}

	r.Unwrap().(*githubActionsReceiver).tracesConsumer = consumer

	return r, nil
}

// newLogsReceiver creates a logs receiver based on provided config.
func newLogsReceiver(
	_ context.Context,
	set receiver.Settings,
	cfg component.Config,
	consumer consumer.Logs,
) (receiver.Logs, error) {
	rCfg := cfg.(*Config)
	var err error

	r := receivers.GetOrAdd(cfg, func() component.Component {
		var rcv component.Component
		rcv, err = newReceiver(set, rCfg)
		return rcv
	})
	if err != nil {
		return nil, err
	}

	r.Unwrap().(*githubActionsReceiver).logsConsumer = consumer

	return r, nil
}

func (gar *githubActionsReceiver) Start(ctx context.Context, host component.Host) error {
	endpoint := fmt.Sprintf("%s%s", gar.config.ServerConfig.NetAddr.Endpoint, gar.config.Path)
	gar.logger.Info("Starting GithubActions server", zap.String("endpoint", endpoint))

	server := &http.Server{
		Addr:              gar.config.ServerConfig.NetAddr.Endpoint,
		Handler:           gar,
		ReadHeaderTimeout: 20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	gar.serverMu.Lock()
	gar.server = server
	gar.serverMu.Unlock()

	gar.shutdownWG.Add(1)
	go func() {
		defer gar.shutdownWG.Done()

		if errHTTP := server.ListenAndServe(); !errors.Is(errHTTP, http.ErrServerClosed) && errHTTP != nil {
			gar.settings.TelemetrySettings.Logger.Error("Server closed with error", zap.Error(errHTTP))
		}
	}()

	return nil
}

func (gar *githubActionsReceiver) Shutdown(ctx context.Context) error {
	gar.serverMu.Lock()
	server := gar.server
	gar.serverMu.Unlock()

	var err error
	if server != nil {
		err = server.Shutdown(ctx)
	}
	if closeErr := gar.tenantResolver.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	gar.shutdownWG.Wait()
	return err
}

func (gar *githubActionsReceiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Validate request path
	if r.URL.Path != gar.config.Path {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	// Limit request body size to prevent OOM from oversized payloads
	r.Body = http.MaxBytesReader(w, r.Body, maxPayloadSize)

	// Validate the payload using the configured secret
	payload, err := github.ValidatePayload(r, []byte(gar.config.Secret))
	if err != nil {
		gar.logger.Debug("Payload validation failed", zap.Error(err))
		http.Error(w, "Invalid payload or signature", http.StatusBadRequest)
		return
	}

	// Determine the type of GitHub webhook event and ensure it's one we handle
	eventType := github.WebHookType(r)
	if eventType == "installation" || eventType == "installation_repositories" {
		if gar.config.EventForwarding.InstallationEventsURL == "" {
			gar.logger.Debug("Skipping installation event forwarding because installation_events_url is not configured", zap.String("event", eventType))
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if err := gar.forwardInstallationEvent(ctx, eventType, payload, r.Header); err != nil {
			gar.logger.Error("Failed to forward installation event", zap.String("event", eventType), zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusAccepted)
		return
	}

	event, err := github.ParseWebHook(eventType, payload)
	if err != nil {
		gar.logger.Debug("Webhook parsing failed", zap.Error(err))
		http.Error(w, "Failed to parse webhook", http.StatusBadRequest)
		return
	}

	// Handle events based on specific types and completion status
	switch e := event.(type) {
	case *github.WorkflowJobEvent:
		if e.GetWorkflowJob().GetStatus() != "completed" {
			gar.logger.Debug("Skipping non-completed WorkflowJobEvent", zap.String("status", e.GetWorkflowJob().GetStatus()))
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case *github.WorkflowRunEvent:
		if e.GetWorkflowRun().GetStatus() != "completed" {
			gar.logger.Debug("Skipping non-completed WorkflowRunEvent", zap.String("status", e.GetWorkflowRun().GetStatus()))
			w.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		gar.logger.Debug("Skipping unsupported event type", zap.String("event", eventType))
		w.WriteHeader(http.StatusNoContent)
		return
	}

	gar.logger.Debug("Received valid GitHub event", zap.String("type", eventType))
	var processingFailed bool
	traceErr := false

	installationID, err := installationIDFromWebhookEvent(event)
	if err != nil {
		gar.logger.Error("Failed to extract installation ID from event", zap.Error(err))
		http.Error(w, "Missing installation id", http.StatusBadRequest)
		return
	}

	if gar.tenantResolver == nil {
		processingFailed = true
		gar.logger.Error("Failed to resolve tenant for installation", zap.Int64("installation_id", installationID), zap.Error(errMissingTenantResolver))
	}

	var tenantID int64
	if !processingFailed {
		tenantID, err = gar.tenantResolver.ResolveTenantID(ctx, installationID)
		if err != nil {
			if errors.Is(err, errTenantNotFound) {
				gar.logger.Info(
					"Dropping event with unresolved tenant mapping",
					zap.Int64("installation_id", installationID),
				)
				w.WriteHeader(http.StatusAccepted)
				return
			}
			processingFailed = true
			gar.logger.Error("Failed to resolve tenant for installation", zap.Int64("installation_id", installationID), zap.Error(err))
		}
	}

	// if a trace consumer is set, process the event into traces
	if !processingFailed && gar.tracesConsumer != nil {
		td, err := eventToTraces(event, gar.config, gar.logger.Named("eventToTraces"), tenantID)
		if err != nil {
			traceErr = true
			processingFailed = true
			gar.logger.Error("Failed to convert event to traces", zap.Error(err))
		}

		if td != nil {
			consumerErr := gar.tracesConsumer.ConsumeTraces(ctx, *td)
			if consumerErr != nil {
				traceErr = true
				processingFailed = true
				gar.logger.Error("Failed to process traces", zap.Error(consumerErr))
			}
		}
	}

	// if a log consumer is set, process the event into logs
	if !processingFailed && gar.logsConsumer != nil {
		ghClient, err := gar.githubClientForInstallation(installationID)
		if err != nil {
			processingFailed = true
			gar.logger.Error("Failed to initialize GitHub client for logs", zap.Error(err))
		} else {
			withTraceInfo := gar.tracesConsumer != nil && !traceErr

			ld, err := eventToLogs(ctx, event, gar.config, ghClient, gar.logger.Named("eventToLogs"), withTraceInfo, tenantID)
			if err != nil {
				processingFailed = true
				gar.logger.Error("Failed to process logs", zap.Error(err))
			}

			if ld != nil {
				consumerErr := gar.logsConsumer.ConsumeLogs(ctx, *ld)
				if consumerErr != nil {
					processingFailed = true
					gar.logger.Error("Failed to consume logs", zap.Error(consumerErr))
				}
			}
		}
	}

	if processingFailed {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func (gar *githubActionsReceiver) forwardInstallationEvent(ctx context.Context, eventType string, payload []byte, inHeader http.Header) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gar.config.EventForwarding.InstallationEventsURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", eventType)

	if delivery := inHeader.Get("X-GitHub-Delivery"); delivery != "" {
		req.Header.Set("X-GitHub-Delivery", delivery)
	}
	if signature := inHeader.Get("X-Hub-Signature-256"); signature != "" {
		req.Header.Set("X-Hub-Signature-256", signature)
	}
	if userAgent := inHeader.Get("User-Agent"); userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}

	resp, err := gar.forwardClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("forward endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

func (gar *githubActionsReceiver) githubClientForInstallation(installationID int64) (*github.Client, error) {
	if gar.config.GitHubAPIConfig.Auth.AppID == 0 || gar.config.GitHubAPIConfig.Auth.PrivateKeyPath == "" {
		return nil, errMissingGitHubAuth
	}

	itr, err := ghinstallation.NewKeyFromFile(http.DefaultTransport, gar.config.GitHubAPIConfig.Auth.AppID, installationID, gar.config.GitHubAPIConfig.Auth.PrivateKeyPath)
	if err != nil {
		return nil, err
	}

	client := github.NewClient(&http.Client{Transport: itr})
	if gar.config.GitHubAPIConfig.BaseURL != "" && gar.config.GitHubAPIConfig.UploadURL != "" {
		client, err = client.WithEnterpriseURLs(gar.config.GitHubAPIConfig.BaseURL, gar.config.GitHubAPIConfig.UploadURL)
		if err != nil {
			return nil, err
		}
	}

	return client, nil
}

func installationIDFromWebhookEvent(event interface{}) (int64, error) {
	var installation *github.Installation
	switch e := event.(type) {
	case *github.WorkflowRunEvent:
		installation = e.GetInstallation()
	case *github.WorkflowJobEvent:
		installation = e.GetInstallation()
	default:
		return 0, errMissingInstallationIDFromEvent
	}

	if installation == nil || installation.GetID() == 0 {
		return 0, errMissingInstallationIDFromEvent
	}

	return installation.GetID(), nil
}
