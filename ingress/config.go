package main

import (
	"errors"
	"os"
	"strings"
	"time"
)

func loadConfig() (config, error) {
	cfg := config{
		ListenAddr:            envString("INGRESS_LISTEN_ADDR", defaultListenAddr),
		Path:                  envString("INGRESS_PATH", defaultPath),
		PostgresDSN:           strings.TrimSpace(os.Getenv("INGRESS_POSTGRES_DSN")),
		WebhookSecret:         strings.TrimSpace(os.Getenv("INGRESS_WEBHOOK_SECRET")),
		CollectorURL:          strings.TrimSpace(os.Getenv("INGRESS_COLLECTOR_URL")),
		InstallationEventsURL: strings.TrimSpace(os.Getenv("INGRESS_INSTALLATION_EVENTS_URL")),
		Source:                envString("INGRESS_SOURCE", sourceGitHub),
		WorkerCount:           envInt("INGRESS_WORKER_COUNT", defaultWorkerCount),
		WorkerBatchSize:       envInt("INGRESS_WORKER_BATCH_SIZE", defaultWorkerBatchSize),
		MaxAttempts:           envInt("INGRESS_MAX_ATTEMPTS", defaultMaxAttempts),
		RetentionDoneDays:     envInt("INGRESS_RETENTION_DONE_DAYS", defaultDoneDays),
		RetentionDeadDays:     envInt("INGRESS_RETENTION_DEAD_DAYS", defaultDeadDays),
		PollInterval:          envDuration("INGRESS_POLL_INTERVAL", defaultPollInterval),
		LockDuration:          envDuration("INGRESS_LOCK_DURATION", defaultLockDuration),
		ReplayTimeout:         envDuration("INGRESS_REPLAY_TIMEOUT", defaultReplayTimeout),
		ReplayConnectTimeout:  envDuration("INGRESS_REPLAY_CONNECT_TIMEOUT", defaultConnectTimeout),
		TenantCacheTTL:        envDuration("INGRESS_TENANT_CACHE_TTL", defaultTenantCacheTTL),
		CleanupInterval:       envDuration("INGRESS_CLEANUP_INTERVAL", time.Hour),
		ShutdownGracePeriod:   envDuration("INGRESS_SHUTDOWN_GRACE", 15*time.Second),
	}

	if cfg.PostgresDSN == "" {
		return config{}, errors.New("INGRESS_POSTGRES_DSN is required")
	}
	if cfg.WebhookSecret == "" {
		return config{}, errors.New("INGRESS_WEBHOOK_SECRET is required")
	}
	if cfg.CollectorURL == "" {
		return config{}, errors.New("INGRESS_COLLECTOR_URL is required")
	}
	if cfg.InstallationEventsURL == "" {
		return config{}, errors.New("INGRESS_INSTALLATION_EVENTS_URL is required")
	}
	if cfg.WorkerCount <= 0 {
		return config{}, errors.New("INGRESS_WORKER_COUNT must be > 0")
	}
	if cfg.WorkerBatchSize <= 0 {
		return config{}, errors.New("INGRESS_WORKER_BATCH_SIZE must be > 0")
	}
	if cfg.MaxAttempts <= 0 {
		return config{}, errors.New("INGRESS_MAX_ATTEMPTS must be > 0")
	}
	if cfg.TenantCacheTTL < 0 {
		return config{}, errors.New("INGRESS_TENANT_CACHE_TTL must be >= 0")
	}
	if cfg.Path == "" || cfg.Path[0] != '/' {
		return config{}, errors.New("INGRESS_PATH must start with '/'")
	}

	return cfg, nil
}
