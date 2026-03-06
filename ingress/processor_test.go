package main

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap"
)

type stubStore struct {
	result     eventResult
	errorClass string
	lastError  string
	calls      int
	tenantID   int64
	persisted  bool
}

func (s *stubStore) finalizeEvent(_ context.Context, _ webhookEvent, result eventResult, errorClass, lastError string) error {
	s.calls++
	s.result = result
	s.errorClass = errorClass
	s.lastError = lastError
	return nil
}

func (s *stubStore) persistTenantID(_ context.Context, _ webhookEvent, tenantID int64) error {
	s.persisted = true
	s.tenantID = tenantID
	return nil
}

type stubTenantResolver struct {
	tenantID int64
	err      error
}

func (r *stubTenantResolver) ResolveTenantID(context.Context, int64) (int64, error) {
	return r.tenantID, r.err
}

type stubReplayTarget struct {
	name  string
	err   error
	calls int
}

func (t *stubReplayTarget) Name() string { return t.name }

func (t *stubReplayTarget) replayEvent(context.Context, webhookEvent, int64) error {
	t.calls++
	return t.err
}

func TestProcessEventIgnoresOptionalReplayFailure(t *testing.T) {
	t.Parallel()

	store := &stubStore{}
	collector := &stubReplayTarget{name: "collector"}
	cdevents := &stubReplayTarget{name: "cdevents"}
	processor := newEventProcessor(config{
		ReplayTimeout: time.Second,
		MaxAttempts:   10,
	}, store, &stubTenantResolver{tenantID: 42}, map[string]replayTarget{
		topicCollector: collector,
		topicCDEvents:  cdevents,
	}, nil, zap.NewNop())

	err := processor.processEvent(context.Background(), webhookEvent{
		ID:       1,
		EventID:  "delivery-1",
		Topic:    topicCollector,
		Attempts: 1,
		Headers:  newGitHubEventHeader("workflow_run"),
		Body:     workflowRunEventPayload(),
	})
	if err != nil {
		t.Fatalf("process event: %v", err)
	}

	if store.result != eventDone {
		t.Fatalf("expected eventDone, got %q (%s)", store.result, store.lastError)
	}
	if collector.calls != 1 || cdevents.calls != 0 {
		t.Fatalf("expected only collector to run, got collector=%d cdevents=%d", collector.calls, cdevents.calls)
	}
	if !store.persisted || store.tenantID != 42 {
		t.Fatalf("expected tenant id 42 to be persisted, got persisted=%v tenant=%d", store.persisted, store.tenantID)
	}
}

func TestProcessEventFailsWhenCollectorReplayFails(t *testing.T) {
	t.Parallel()

	store := &stubStore{}
	collector := &stubReplayTarget{name: "collector", err: errors.New("unavailable")}
	processor := newEventProcessor(config{
		ReplayTimeout: time.Second,
		MaxAttempts:   10,
	}, store, &stubTenantResolver{tenantID: 42}, map[string]replayTarget{
		topicCollector: collector,
	}, nil, zap.NewNop())

	err := processor.processEvent(context.Background(), webhookEvent{
		ID:       1,
		EventID:  "delivery-2",
		Topic:    topicCollector,
		Attempts: 1,
		Headers:  newGitHubEventHeader("workflow_run"),
		Body:     workflowRunEventPayload(),
	})
	if err != nil {
		t.Fatalf("process event: %v", err)
	}

	if store.result != eventFail {
		t.Fatalf("expected eventFail, got %q (%s)", store.result, store.lastError)
	}
	if store.errorClass != "retryable" {
		t.Fatalf("expected retryable error class, got %q", store.errorClass)
	}
}

func TestProcessEventFailsWhenCDEventsReplayFails(t *testing.T) {
	t.Parallel()

	store := &stubStore{}
	collector := &stubReplayTarget{name: "collector"}
	cdevents := &stubReplayTarget{name: "cdevents", err: errors.New("unavailable")}
	processor := newEventProcessor(config{
		ReplayTimeout: time.Second,
		MaxAttempts:   10,
	}, store, &stubTenantResolver{tenantID: 42}, map[string]replayTarget{
		topicCollector: collector,
		topicCDEvents:  cdevents,
	}, nil, zap.NewNop())

	err := processor.processEvent(context.Background(), webhookEvent{
		ID:       1,
		EventID:  "delivery-3",
		Topic:    topicCDEvents,
		Attempts: 1,
		Headers:  newGitHubEventHeader("workflow_run"),
		Body:     workflowRunEventPayload(),
	})
	if err != nil {
		t.Fatalf("process event: %v", err)
	}

	if store.result != eventFail {
		t.Fatalf("expected eventFail, got %q (%s)", store.result, store.lastError)
	}
	if store.errorClass != "retryable" {
		t.Fatalf("expected retryable error class, got %q", store.errorClass)
	}
	if collector.calls != 0 || cdevents.calls != 1 {
		t.Fatalf("expected only cdevents to run, got collector=%d cdevents=%d", collector.calls, cdevents.calls)
	}
}

func TestProcessEventAppTopicForwardsWithoutTenantResolution(t *testing.T) {
	t.Parallel()

	store := &stubStore{}
	appForwarder := &installationEventForwarder{}
	calls := 0
	appForwarder = &installationEventForwarder{
		appURL: "http://app",
		httpClient: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{
				StatusCode: http.StatusAccepted,
				Body:       http.NoBody,
				Header:     make(http.Header),
			}, nil
		}),
		logger: zap.NewNop(),
	}

	processor := newEventProcessor(config{
		ReplayTimeout: time.Second,
		MaxAttempts:   10,
	}, store, &stubTenantResolver{tenantID: 42}, nil, appForwarder, zap.NewNop())

	err := processor.processEvent(context.Background(), webhookEvent{
		ID:       1,
		EventID:  "delivery-4",
		Topic:    topicApp,
		Attempts: 1,
		Headers:  newGitHubEventHeader("installation"),
		Body:     []byte(`{"action":"created"}`),
	})
	if err != nil {
		t.Fatalf("process event: %v", err)
	}
	if store.result != eventDone {
		t.Fatalf("expected eventDone, got %q", store.result)
	}
	if store.persisted {
		t.Fatalf("did not expect tenant persistence for app topic")
	}
	if calls != 1 {
		t.Fatalf("expected app forwarder to be called once, got %d", calls)
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (fn roundTripFunc) Do(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newGitHubEventHeader(eventType string) http.Header {
	headers := make(http.Header)
	headers.Set("X-GitHub-Event", eventType)
	return headers
}

func workflowRunEventPayload() []byte {
	return []byte(`{
		"action":"requested",
		"installation":{"id":123},
		"workflow_run":{
			"id":123,
			"name":"Tests",
			"html_url":"https://github.com/acme/repo/actions/runs/123",
			"head_branch":"main",
			"head_sha":"abc123",
			"created_at":"2026-03-05T10:00:00Z",
			"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
		},
		"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
	}`)
}
