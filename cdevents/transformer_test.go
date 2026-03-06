package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-github/v67/github"
)

func TestTransformWorkflowRunCompleted(t *testing.T) {
	t.Parallel()

	payload := readFixture(t, "../collector/receiver/githubactionsreceiver/testdata/completed/8_workflow_run_completed.json")
	parsed, err := github.ParseWebHook("workflow_run", payload)
	if err != nil {
		t.Fatalf("parse webhook: %v", err)
	}

	rows, err := (transformer{}).Transform(transformInput{
		EventType:  "workflow_run",
		DeliveryID: "delivery-1",
		TenantID:   42,
		Parsed:     parsed,
	})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}

	row := rows[0]
	if row.EventKind != "pipelinerun" || row.EventPhase != "finished" {
		t.Fatalf("unexpected event type: %s.%s", row.EventKind, row.EventPhase)
	}
	if row.TenantID != 42 {
		t.Fatalf("unexpected tenant id: %d", row.TenantID)
	}
	if row.SubjectID != "6454805877" {
		t.Fatalf("unexpected subject id: %q", row.SubjectID)
	}
	if row.Outcome != "success" {
		t.Fatalf("unexpected outcome: %q", row.Outcome)
	}
	if !strings.Contains(row.CDEventJSON, "dev.cdevents.pipelinerun.finished.0.2.0") {
		t.Fatalf("expected cdevent type in payload, got %q", row.CDEventJSON)
	}
}

func TestTransformWorkflowJobCompleted(t *testing.T) {
	t.Parallel()

	payload := readFixture(t, "../collector/receiver/githubactionsreceiver/testdata/completed/9_workflow_job_completed.json")
	parsed, err := github.ParseWebHook("workflow_job", payload)
	if err != nil {
		t.Fatalf("parse webhook: %v", err)
	}

	rows, err := (transformer{}).Transform(transformInput{
		EventType:  "workflow_job",
		DeliveryID: "delivery-2",
		TenantID:   7,
		Parsed:     parsed,
	})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}

	row := rows[0]
	if row.EventKind != "taskrun" || row.EventPhase != "finished" {
		t.Fatalf("unexpected event type: %s.%s", row.EventKind, row.EventPhase)
	}
	if row.PipelineRunID != "6454805877" {
		t.Fatalf("unexpected pipeline run id: %q", row.PipelineRunID)
	}
	if row.SubjectName != "test" {
		t.Fatalf("unexpected subject name: %q", row.SubjectName)
	}
}

func TestTransformWorkflowRunRequested(t *testing.T) {
	t.Parallel()

	payload := []byte(`{
		"action":"requested",
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

	parsed, err := github.ParseWebHook("workflow_run", payload)
	if err != nil {
		t.Fatalf("parse webhook: %v", err)
	}

	rows, err := (transformer{}).Transform(transformInput{
		EventType:  "workflow_run",
		DeliveryID: "delivery-3",
		TenantID:   9,
		Parsed:     parsed,
	})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].EventPhase != "queued" {
		t.Fatalf("expected queued phase, got %q", rows[0].EventPhase)
	}
}

func TestTransformWorkflowJobQueuedIsIgnored(t *testing.T) {
	t.Parallel()

	payload := readFixture(t, "../collector/receiver/githubactionsreceiver/testdata/queued/1_workflow_job_queued.json")
	parsed, err := github.ParseWebHook("workflow_job", payload)
	if err != nil {
		t.Fatalf("parse webhook: %v", err)
	}

	rows, err := (transformer{}).Transform(transformInput{
		EventType:  "workflow_job",
		DeliveryID: "delivery-4",
		TenantID:   1,
		Parsed:     parsed,
	})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected no rows for queued workflow_job, got %d", len(rows))
	}
}

func readFixture(t *testing.T, relativePath string) []byte {
	t.Helper()

	payload, err := os.ReadFile(filepath.Clean(relativePath))
	if err != nil {
		t.Fatalf("read fixture %s: %v", relativePath, err)
	}
	return payload
}
