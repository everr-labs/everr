package main

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	defer func() { _ = logger.Sync() }()

	cfg, err := loadConfig()
	if err != nil {
		logger.Fatal("load config", zap.Error(err))
	}

	db, err := sql.Open("postgres", cfg.PostgresDSN)
	if err != nil {
		logger.Fatal("open postgres", zap.Error(err))
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		logger.Fatal("ping postgres", zap.Error(err))
	}

	httpClient := &http.Client{
		Timeout: cfg.ReplayTimeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout: cfg.ReplayConnectTimeout,
			}).DialContext,
			ForceAttemptHTTP2:   true,
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 50,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	s := &server{
		cfg:    cfg,
		logger: logger.Named("ingress"),
	}
	s.store = newEventStore(db, cfg)
	tenantResolver := newTenantResolver(db, cfg.TenantCacheTTL)
	replayer := newCollectorReplayer(cfg.CollectorURL, httpClient, s.logger.Named("replayer"))
	s.processor = newEventProcessor(cfg, s.store, tenantResolver, replayer, s.logger.Named("processor"))

	ctxRun, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

	var wg sync.WaitGroup
	for i := 0; i < cfg.WorkerCount; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			s.runWorker(ctxRun, workerID)
		}(i + 1)
	}

	wg.Go(func() {
		s.runCleanupLoop(ctxRun)
	})

	mux := http.NewServeMux()
	mux.HandleFunc(cfg.Path, s.handleWebhook)

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	s.logger.Info("ingress listening",
		zap.String("listen_addr", cfg.ListenAddr),
		zap.String("path", cfg.Path),
		zap.String("collector_url", cfg.CollectorURL),
		zap.String("source", cfg.Source),
		zap.Int("worker_count", cfg.WorkerCount),
		zap.Int("worker_batch_size", cfg.WorkerBatchSize),
	)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		s.logger.Fatal("http server failed", zap.Error(err))
	}

	cancelRun()
	wg.Wait()
}
