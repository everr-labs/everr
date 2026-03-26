// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/bradleyfalzon/ghinstallation/v2"
	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/receiverhelper"
	"go.uber.org/zap"
)

var errMissingEndpoint = errors.New("missing a receiver endpoint")
var errMissingInstallationIDFromEvent = errors.New("missing installation.id in webhook payload")
var errMissingGitHubAuth = errors.New("github api authentication is not configured")

const maxPayloadSize = 25 * 1024 * 1024 // 25 MB — GitHub webhook max payload size

type githubActionsReceiver struct {
	logsConsumer    consumer.Logs
	metricsConsumer consumer.Metrics
	tracesConsumer  consumer.Traces
	config          *Config
	server          *http.Server
	serverMu        sync.Mutex
	shutdownWG      sync.WaitGroup
	settings        receiver.Settings
	logger          *zap.Logger
	obsrecv         *receiverhelper.ObsReport
	ghClient        *github.Client
	jobNames        *jobNameCache
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

	gar := &githubActionsReceiver{
		config:   config,
		settings: settings,
		logger:   settings.Logger,
		obsrecv:  obsrecv,
		ghClient: ghClient,
		jobNames: newJobNameCache(1024, 30*time.Minute),
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

// newMetricsReceiver creates a metrics receiver based on provided config.
func newMetricsReceiver(
	_ context.Context,
	set receiver.Settings,
	cfg component.Config,
	consumer consumer.Metrics,
) (receiver.Metrics, error) {
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

	r.Unwrap().(*githubActionsReceiver).metricsConsumer = consumer

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
		jobName := e.GetWorkflowJob().GetName()
		// Cache job names containing "/" (need resolution) and "_" (need to
		// distinguish genuine underscores from sanitized slashes). If the cache
		// has entries for a run, it's authoritative — a cache hit with no "/"
		// match means the "_" was literal, avoiding a false-positive API call
		// from the looksLikeSanitizedJobName heuristic.
		if strings.Contains(jobName, "/") || strings.Contains(jobName, "_") {
			key := runKey{
				repoID:     e.GetRepo().GetID(),
				runID:      e.GetWorkflowJob().GetRunID(),
				runAttempt: int(e.GetWorkflowJob().GetRunAttempt()),
			}
			gar.jobNames.AddJobName(key, jobName)
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

	// Preserve incoming request headers in client metadata so downstream processors
	// can enrich telemetry using from_context metadata access.
	ci := client.FromContext(ctx)
	ci.Metadata = client.NewMetadata(r.Header)
	ctx = client.NewContext(ctx, ci)

	installationID, err := installationIDFromWebhookEvent(event)
	if err != nil {
		gar.logger.Error("Failed to extract installation ID from event", zap.Error(err))
		http.Error(w, "Missing installation id", http.StatusBadRequest)
		return
	}

	var installationClient *github.Client
	getInstallationClient := func() (*github.Client, error) {
		if installationClient != nil {
			return installationClient, nil
		}

		client, clientErr := gar.githubClientForInstallation(installationID)
		if clientErr != nil {
			return nil, clientErr
		}

		installationClient = client
		return installationClient, nil
	}

	// if a trace consumer is set, process the event into traces
	if !processingFailed && gar.tracesConsumer != nil {
		td, err := eventToTraces(event, gar.config, gar.logger.Named("eventToTraces"))
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

	// if a metrics consumer is set, process the event into metrics
	if !processingFailed && gar.metricsConsumer != nil {
		ghClient, clientErr := getInstallationClient()
		if clientErr != nil {
			processingFailed = true
			gar.logger.Error("Failed to initialize GitHub client for metrics", zap.Error(clientErr))
		} else {
			md, metricsErr := eventToMetrics(ctx, event, gar.config, ghClient, gar.logger.Named("eventToMetrics"))
			if metricsErr != nil {
				processingFailed = true
				gar.logger.Error("Failed to process metrics", zap.Error(metricsErr))
			}

			if md != nil {
				consumerErr := gar.metricsConsumer.ConsumeMetrics(ctx, *md)
				if consumerErr != nil {
					processingFailed = true
					gar.logger.Error("Failed to consume metrics", zap.Error(consumerErr))
				}
			}
		}
	}

	// if a log consumer is set, process the event into logs
	if !processingFailed && gar.logsConsumer != nil {
		ghClient, clientErr := getInstallationClient()
		if clientErr != nil {
			processingFailed = true
			gar.logger.Error("Failed to initialize GitHub client for logs", zap.Error(clientErr))
		} else {
			withTraceInfo := gar.tracesConsumer != nil && !traceErr

			ld, err := eventToLogs(ctx, event, gar.config, ghClient, gar.logger.Named("eventToLogs"), withTraceInfo, gar.jobNames)
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

func (gar *githubActionsReceiver) githubClientForInstallation(installationID int64) (*github.Client, error) {
	if gar.config.GitHubAPIConfig.Auth.AppID == 0 {
		return nil, errMissingGitHubAuth
	}

	privateKey := gar.config.GitHubAPIConfig.Auth.PrivateKey
	privateKeyPath := gar.config.GitHubAPIConfig.Auth.PrivateKeyPath

	if privateKey == "" && privateKeyPath == "" {
		return nil, errMissingGitHubAuth
	}

	if privateKey != "" && privateKeyPath != "" {
		return nil, errMultiplePrivateKeySources
	}

	var (
		itr *ghinstallation.Transport
		err error
	)

	if privateKey != "" {
		itr, err = ghinstallation.New(http.DefaultTransport, gar.config.GitHubAPIConfig.Auth.AppID, installationID, []byte(privateKey))
	} else {
		itr, err = ghinstallation.NewKeyFromFile(http.DefaultTransport, gar.config.GitHubAPIConfig.Auth.AppID, installationID, privateKeyPath)
	}
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
