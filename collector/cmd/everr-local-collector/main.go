package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/localcollector"
)

const (
	defaultOTLPEndpoint = "http://127.0.0.1:4318"
	defaultSQLEndpoint  = "http://127.0.0.1:8080"
	defaultChDBPath     = "./chdb"
	defaultTTL          = 7 * 24 * time.Hour
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "everr-local-collector: %v\n", err)
		os.Exit(1)
	}
}

func parseOptions(args []string) (localcollector.Options, error) {
	fs := flag.NewFlagSet("everr-local-collector", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	opts := localcollector.Options{TTL: defaultTTL}
	fs.StringVar(&opts.OTLPEndpoint, "otlp-http-endpoint", defaultOTLPEndpoint, "OTLP HTTP endpoint apps send telemetry to")
	fs.StringVar(&opts.SQLEndpoint, "sql-http-endpoint", defaultSQLEndpoint, "SQL HTTP endpoint")
	fs.StringVar(&opts.ChDBPath, "chdb-path", defaultChDBPath, "chDB database path")
	fs.Var(ttlFlag{value: &opts.TTL}, "ttl", "local telemetry TTL")
	if err := fs.Parse(args); err != nil {
		return localcollector.Options{}, err
	}
	return opts, nil
}

type ttlFlag struct {
	value *time.Duration
}

func (f ttlFlag) Set(raw string) error {
	ttl, err := parseTTL(raw)
	if err != nil {
		return err
	}
	*f.value = ttl
	return nil
}

func (f ttlFlag) String() string {
	if f.value == nil {
		return ""
	}
	if *f.value%(24*time.Hour) == 0 {
		return fmt.Sprintf("%dd", *f.value/(24*time.Hour))
	}
	return f.value.String()
}

func parseTTL(raw string) (time.Duration, error) {
	if strings.HasSuffix(raw, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(raw, "d"))
		if err != nil {
			return 0, fmt.Errorf("parse ttl days: %w", err)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(raw)
}

func run(ctx context.Context, args []string) error {
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}

	logger, err := zap.NewProduction()
	if err != nil {
		return fmt.Errorf("create logger: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	opts.Version = os.Getenv("EVERR_LOCAL_VERSION")
	opts.InstanceID = os.Getenv("EVERR_LOCAL_INSTANCE_ID")
	opts.Logger = logger
	gateway, err := localcollector.Open(opts)
	if err != nil {
		return err
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = gateway.Close(shutdownCtx)
	}()

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := gateway.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}
