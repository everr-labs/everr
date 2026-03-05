package main

import (
	"errors"
	"net/http"
	"time"

	"go.uber.org/zap"
)

const (
	headerTenantID         = "X-Everr-Tenant-Id"
	sourceGitHub           = "github"
	defaultListenAddr      = ":8081"
	defaultPath            = "/webhook/github"
	defaultWorkerCount     = 2
	defaultWorkerBatchSize = 10
	defaultPollInterval    = 2 * time.Second
	defaultLockDuration    = 2 * time.Minute
	defaultMaxAttempts     = 10
	defaultReplayTimeout   = 30 * time.Second
	defaultConnectTimeout  = 10 * time.Second
	defaultTenantCacheTTL  = time.Minute
	defaultDoneDays        = 7
	defaultDeadDays        = 30
	cleanupBatchSize       = 500
)

type config struct {
	ListenAddr            string
	Path                  string
	PostgresDSN           string
	WebhookSecret         string
	CollectorURL          string
	InstallationEventsURL string
	Source                string
	WorkerCount           int
	WorkerBatchSize       int
	PollInterval          time.Duration
	LockDuration          time.Duration
	MaxAttempts           int
	ReplayTimeout         time.Duration
	ReplayConnectTimeout  time.Duration
	TenantCacheTTL        time.Duration
	RetentionDoneDays     int
	RetentionDeadDays     int
	CleanupInterval       time.Duration
	ShutdownGracePeriod   time.Duration
}

type server struct {
	cfg       config
	store     *eventStore
	processor *eventProcessor
	logger    *zap.Logger
}

type webhookEvent struct {
	ID       int64
	Source   string
	EventID  string
	Headers  map[string][]string
	Body     []byte
	Attempts int
}

type eventResult string

const (
	eventDone eventResult = "done"
	eventDead eventResult = "dead"
	eventFail eventResult = "failed"
)

var errMissingInstallationID = errors.New("missing installation.id")
var errTenantNotFound = errors.New("tenant mapping not found for installation")

type terminalError struct {
	Err error
}

// Error returns the wrapped terminal error message.
func (e *terminalError) Error() string {
	if e == nil || e.Err == nil {
		return "terminal error"
	}
	return e.Err.Error()
}

// Unwrap exposes the underlying error for errors.Is/errors.As checks.
func (e *terminalError) Unwrap() error { return e.Err }

type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}
