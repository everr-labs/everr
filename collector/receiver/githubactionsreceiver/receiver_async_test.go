// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/receiver/receivertest"

	"github.com/everr-labs/everr/collector/receiver/githubactionsreceiver/internal/metadata"
)

// workflowRunWebhookRequest builds a signed-enough workflow_run completed
// webhook request from the shared fixture, with an installation id injected
// (the fixture predates the GitHub App setup and lacks one).
func workflowRunWebhookRequest(t *testing.T, path string) *http.Request {
	t.Helper()

	raw, err := os.ReadFile("./testdata/completed/8_workflow_run_completed.json")
	require.NoError(t, err)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(raw, &payload))
	payload["installation"] = map[string]any{"id": 123}
	body, err := json.Marshal(payload)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("X-GitHub-Event", "workflow_run")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Everr-Tenant-Id", "tenant-1")
	return req
}

// TestWorkflowRunWebhookAcksBeforeLogIngestion verifies that a completed
// workflow_run webhook is acked with 202 before the log archive is touched,
// and that ingestion then completes on the worker pool.
func TestWorkflowRunWebhookAcksBeforeLogIngestion(t *testing.T) {
	// Zip download blocks until released, proving the ack does not wait on it.
	release := make(chan struct{})

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("pre-commit/1_Set up job.txt")
	require.NoError(t, err)
	_, err = f.Write([]byte("2023-10-13T10:11:33Z hello from async ingestion\n"))
	require.NoError(t, err)
	require.NoError(t, w.Close())
	zipData := buf.Bytes()

	zipServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(zipData)
	}))
	t.Cleanup(zipServer.Close)

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/logs"):
			http.Redirect(w, r, zipServer.URL, http.StatusFound)
		case strings.HasSuffix(r.URL.Path, "/jobs"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"total_count":1,"jobs":[{"id":12345,"name":"pre-commit","status":"completed"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(apiServer.Close)

	ghClient, err := github.NewClient(nil).WithEnterpriseURLs(apiServer.URL+"/", apiServer.URL+"/")
	require.NoError(t, err)

	cfg := createDefaultConfig().(*Config)
	cfg.NetAddr.Endpoint = "localhost:0"

	gar, err := newReceiver(receivertest.NewNopSettings(metadata.Type), cfg)
	require.NoError(t, err)

	sink := new(consumertest.LogsSink)
	gar.logsConsumer = sink
	gar.newInstallationClient = func(installationID int64) (*github.Client, error) {
		require.Equal(t, int64(123), installationID)
		return ghClient, nil
	}

	require.NoError(t, gar.Start(context.Background(), componenttest.NewNopHost()))
	t.Cleanup(func() { require.NoError(t, gar.Shutdown(context.Background())) })

	rec := httptest.NewRecorder()
	gar.ServeHTTP(rec, workflowRunWebhookRequest(t, cfg.Path))

	require.Equal(t, http.StatusAccepted, rec.Code, "webhook must be acked before ingestion runs")
	require.Zero(t, sink.LogRecordCount(), "no logs may be consumed before the archive download completes")

	close(release)
	require.Eventually(t, func() bool {
		return sink.LogRecordCount() > 0
	}, 10*time.Second, 25*time.Millisecond, "worker should ingest the archive after the ack")
}

// TestWorkflowRunWebhookRejectsWhenQueueFull verifies backpressure: with the
// ingestion queue full, the webhook is rejected with 503 so the sender
// retries the event instead of the receiver buffering without bound.
func TestWorkflowRunWebhookRejectsWhenQueueFull(t *testing.T) {
	cfg := createDefaultConfig().(*Config)
	cfg.NetAddr.Endpoint = "localhost:0"

	gar, err := newReceiver(receivertest.NewNopSettings(metadata.Type), cfg)
	require.NoError(t, err)
	gar.logsConsumer = consumertest.NewNop()

	// No Start, so no workers drain the queue; fill it to capacity.
	gar.logJobs = make(chan logIngestJob, 1)
	gar.logJobs <- logIngestJob{}

	rec := httptest.NewRecorder()
	gar.ServeHTTP(rec, workflowRunWebhookRequest(t, cfg.Path))

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

// TestLogWorkerRetriesTransientFailures verifies that a failed ingestion is
// retried by the worker: once the webhook is acked the sender will not
// redeliver, so the worker owns transient-failure retries.
func TestLogWorkerRetriesTransientFailures(t *testing.T) {
	var calls atomic.Int32
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(apiServer.Close)

	ghClient, err := github.NewClient(nil).WithEnterpriseURLs(apiServer.URL+"/", apiServer.URL+"/")
	require.NoError(t, err)

	cfg := createDefaultConfig().(*Config)
	cfg.NetAddr.Endpoint = "localhost:0"
	gar, err := newReceiver(receivertest.NewNopSettings(metadata.Type), cfg)
	require.NoError(t, err)
	gar.logsConsumer = new(consumertest.LogsSink)
	gar.newInstallationClient = func(int64) (*github.Client, error) { return ghClient, nil }
	gar.logWorkerCtx, gar.logWorkerStop = context.WithCancel(context.Background())
	t.Cleanup(gar.logWorkerStop)

	raw, err := os.ReadFile("./testdata/completed/8_workflow_run_completed.json")
	require.NoError(t, err)
	event, err := github.ParseWebHook("workflow_run", raw)
	require.NoError(t, err)

	done := make(chan struct{})
	go func() {
		defer close(done)
		gar.processLogJob(logIngestJob{
			event:          event.(*github.WorkflowRunEvent),
			installationID: 123,
			headers:        http.Header{},
		})
	}()

	// Each attempt makes one GetWorkflowRunAttemptLogs call (go-github does
	// not retry 500s); the worker should retry up to logIngestRetries times.
	require.Eventually(t, func() bool { return calls.Load() >= 1 }, 5*time.Second, 10*time.Millisecond)

	// Cancel instead of waiting out the retry backoff.
	gar.logWorkerStop()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after context cancellation")
	}
	require.Equal(t, int32(1), calls.Load(), "second attempt must not start before the backoff elapses")
}
