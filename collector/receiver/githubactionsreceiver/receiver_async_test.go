// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
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

	zipData := createCombinedZip(t, map[string]string{
		"pre-commit/1_Set up job.txt": "2023-10-13T10:11:33Z hello from async ingestion\n",
	})

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

// TestLogWorkerRetriesTransientFailures verifies the retry contract: once the
// webhook is acked the sender will not redeliver, so a failed attempt is
// re-enqueued after the backoff (without parking a worker slot) until the
// attempt budget is spent.
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
	gar.logRetryBackoff = 20 * time.Millisecond
	gar.logWorkerCtx, gar.logWorkerStop = context.WithCancel(context.Background())
	t.Cleanup(func() {
		gar.logWorkerStop()
		gar.logResubmitWG.Wait()
	})

	raw, err := os.ReadFile("./testdata/completed/8_workflow_run_completed.json")
	require.NoError(t, err)
	event, err := github.ParseWebHook("workflow_run", raw)
	require.NoError(t, err)

	job := logIngestJob{
		event:          event.(*github.WorkflowRunEvent),
		installationID: 123,
		headers:        http.Header{},
	}

	// A failed first attempt is re-enqueued after the backoff with the
	// attempt counter bumped, and makes exactly one API call itself.
	gar.processLogJob(job)
	require.Equal(t, int32(1), calls.Load())
	select {
	case retried := <-gar.logJobs:
		require.Equal(t, 1, retried.attempt)
	case <-time.After(5 * time.Second):
		t.Fatal("failed job was not re-enqueued after the backoff")
	}

	// A failure on the final attempt is given up on, not re-enqueued.
	job.attempt = logIngestRetries - 1
	gar.processLogJob(job)
	gar.logResubmitWG.Wait()
	select {
	case <-gar.logJobs:
		t.Fatal("exhausted job must not be re-enqueued")
	default:
	}
}
