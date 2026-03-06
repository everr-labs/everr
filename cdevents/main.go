package main

import (
	"errors"
	"net/http"
	"time"

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

	inserter, err := newClickHouseInserter(cfg)
	if err != nil {
		logger.Fatal("open clickhouse", zap.Error(err))
	}

	writer := newBufferedWriter(inserter, cfg, logger.Named("writer"))
	defer func() {
		if err := writer.Close(); err != nil {
			logger.Error("close writer", zap.Error(err))
		}
	}()

	s := &server{
		cfg:         cfg,
		transformer: transformer{},
		writer:      writer,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(cfg.Path, s.handleWebhook)

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	logger.Info("cdevents listening",
		zap.String("listen_addr", cfg.ListenAddr),
		zap.String("path", cfg.Path),
		zap.String("clickhouse_addr", cfg.ClickHouseAddr),
		zap.String("clickhouse_database", cfg.ClickHouseDatabase),
	)

	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatal("http server failed", zap.Error(err))
	}
}
