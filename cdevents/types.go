package main

import "time"

const (
	headerGitHubEvent  = "X-GitHub-Event"
	headerGitHubID     = "X-GitHub-Delivery"
	headerTenantID     = "X-Everr-Tenant-Id"
	defaultListenAddr  = ":8082"
	defaultPath        = "/webhook/github"
	defaultBatchSize   = 100
	defaultFlushPeriod = 5 * time.Second
	defaultRetryDelay  = time.Second
)

const (
	cdeventsTableName = "otel.cdevents_raw"
	specVersion       = "0.4.1"
)

type config struct {
	ListenAddr          string
	Path                string
	ClickHouseAddr      string
	ClickHouseDatabase  string
	ClickHouseUsername  string
	ClickHousePassword  string
	BatchSize           int
	FlushInterval       time.Duration
	FlushRetryDelay     time.Duration
	ShutdownGracePeriod time.Duration
}

type eventRow struct {
	TenantID      uint64
	DeliveryID    string
	EventKind     string
	EventPhase    string
	EventTime     time.Time
	SubjectID     string
	SubjectName   string
	SubjectURL    string
	PipelineRunID string
	Repository    string
	SHA           string
	GitRef        string
	Outcome       string
	CDEventJSON   string
}

type server struct {
	cfg         config
	transformer transformer
	writer      eventWriter
}

type eventWriter interface {
	WriteRows(rows []eventRow) error
	Close() error
}
