package local

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/pkg/browser"
	"go.opentelemetry.io/otel"
	"go.uber.org/zap"
	"golang.org/x/term"

	"github.com/everr-labs/everr/collector/localcollector"
	"github.com/everr-labs/everr/packages/cli/internal/assets"
	"github.com/everr-labs/everr/packages/cli/internal/banner"
	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const (
	localTTL       = 7 * 24 * time.Hour
	collectorReady = 10 * time.Second
)

type startArgs struct {
	detach bool
	quiet  bool
	noOpen bool
}

func runStart(ctx context.Context, args startArgs, lifetime *Lifetime) error {
	if err := ensureSupportedPlatform(); err != nil {
		return err
	}
	status := Inspect(ctx)
	if _, ok := status.RunningInstance(); ok {
		if !args.quiet {
			printStartup()
		}
		openStartedUI(args)
		return nil
	}
	if err := status.RequireStopped(); err != nil {
		return err
	}
	if args.detach {
		if err := startDetached(ctx); err != nil {
			return err
		}
		if !args.quiet {
			path, err := logPath()
			if err != nil {
				return err
			}
			printStartup()
			fmt.Printf("log: %s\n", path)
		}
		openStartedUI(args)
		return nil
	}

	telemetryDir, err := build.TelemetryDir()
	if err != nil {
		return err
	}
	if err := lifetime.acquire(telemetryDir); err != nil {
		return err
	}
	for _, origin := range []string{build.SQLHTTPOrigin(), build.OTLPHTTPOrigin()} {
		if err := requireFreePort(origin); err != nil {
			return err
		}
	}
	instanceID, ok := os.LookupEnv(backgroundInstanceIDEnv)
	if !ok {
		instanceID = newInstanceID()
	}

	requests := make(chan supervisorRequest)
	ui, err := bindServer(instanceID, requests)
	if err != nil {
		return err
	}
	defer ui.listener.Close()
	library, err := extractChDBLibrary()
	if err != nil {
		return fmt.Errorf("extract embedded chDB library: %w", err)
	}
	gateway, err := openGateway(library, telemetryDir, instanceID)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = gateway.Close(closeCtx)
	}()
	collector, err := startPipeline(ctx, gateway, instanceID)
	if err != nil {
		return err
	}
	defer func() { collector.stop() }()

	if !args.quiet {
		printStartup()
	}

	served := make(chan error, 1)
	go func() { served <- ui.serve() }()
	signals, stopSignals := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	openStartedUI(args)

	var stopReply chan error
	var result error
loop:
	for {
		select {
		case result = <-served:
			break loop
		case req := <-requests:
			if req.stop {
				stopReply = req.reply
				break loop
			}
			collector.stop()
			collector, err = startPipeline(ctx, gateway, instanceID)
			if err != nil {
				collector = &pipeline{}
			}
			req.reply <- err
		case <-signals.Done():
			break loop
		case err := <-collector.exited():
			collector = &pipeline{}
			fmt.Fprintf(os.Stderr, "Collector stopped: %v. Restart it from the local UI.\n", err)
		}
	}
	collector.stop()
	if stopReply != nil {
		stopReply <- nil
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := ui.shutdown(shutdownCtx); err != nil && result == nil {
		result = err
	}
	return result
}

func openGateway(library, telemetryDir, instanceID string) (*localcollector.Gateway, error) {
	chdbPath := filepath.Join(telemetryDir, "chdb")
	if err := os.MkdirAll(chdbPath, 0o755); err != nil {
		return nil, fmt.Errorf("create chdb dir %s: %w", chdbPath, err)
	}
	logger, err := zap.NewProduction()
	if err != nil {
		return nil, err
	}
	return localcollector.Open(localcollector.Options{
		OTLPEndpoint:    build.OTLPHTTPOrigin(),
		SQLEndpoint:     build.SQLHTTPOrigin(),
		ChDBPath:        chdbPath,
		ChDBLibraryPath: library,
		TTL:             localTTL,
		Version:         build.Version(),
		InstanceID:      instanceID,
		Logger:          logger,
	})
}

// pipeline is one run of the collector's OTLP pipeline. A zero pipeline is a
// stopped one.
type pipeline struct {
	cancel context.CancelFunc
	done   chan error
}

func (p *pipeline) exited() <-chan error {
	return p.done
}

func (p *pipeline) stop() {
	if p.cancel == nil {
		return
	}
	p.cancel()
	<-p.done
	p.cancel = nil
	p.done = nil
}

func startPipeline(ctx context.Context, gateway *localcollector.Gateway, instanceID string) (*pipeline, error) {
	// The collector installs its own global OTel error handler on start,
	// which would log the CLI's telemetry export failures as stack traces.
	errorHandler := otel.GetErrorHandler()
	defer otel.SetErrorHandler(errorHandler)
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	done := make(chan error, 1)
	go func() { done <- gateway.Run(runCtx) }()
	p := &pipeline{cancel: cancel, done: done}

	ready := make(chan bool, 1)
	go func() { ready <- waitForCollector(ctx, build.HealthcheckEndpoint(), instanceID, collectorReady) }()
	select {
	case err := <-done:
		cancel()
		return nil, fmt.Errorf("collector exited before it became ready: %w", err)
	case ok := <-ready:
		if ok {
			return p, nil
		}
		p.stop()
		return nil, fmt.Errorf("collector healthcheck did not become ready; collector URL: %s", build.OTLPHTTPOrigin())
	}
}

func ensureSupportedPlatform() error {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64", "linux/arm64", "linux/amd64":
		return nil
	}
	return errors.New("embedded local collector is currently supported only on macOS arm64 and Linux arm64/x86_64")
}

func printStartup() {
	if term.IsTerminal(int(os.Stdout.Fd())) {
		banner.PrintBanner()
	}
	fmt.Printf("otlp: %s\n", build.OTLPHTTPOrigin())
	fmt.Printf("sql: %s\n", build.SQLHTTPOrigin())
	fmt.Printf("ui: %s\n", build.LocalUIOrigin())
}

func openStartedUI(args startArgs) {
	if args.noOpen || args.quiet {
		return
	}
	if err := openBrowser(build.LocalUIOrigin()); err != nil {
		fmt.Fprintf(os.Stderr, "Could not open the local UI: %v\n", err)
	}
}

func openBrowser(url string) error {
	browser.Stdout, browser.Stderr = io.Discard, io.Discard
	return browser.OpenURL(url)
}

// extractChDBLibrary unpacks the embedded libchdb into a cache directory
// named by its digest and returns its path. Debug builds can point
// CHDB_LIB_PATH at an existing library to skip the ~340 MB extraction.
func extractChDBLibrary() (string, error) {
	if !build.Release {
		if path := os.Getenv("CHDB_LIB_PATH"); path != "" {
			return path, nil
		}
	}
	zst, digest, ok := assets.ChDBLibraryZst()
	if !ok {
		return "", fmt.Errorf("chDB is not embedded in this CLI build; rebuild with `pnpm --filter @everr/cli build:debug`")
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve user cache directory: %w", err)
	}
	return extractToCache(filepath.Join(cacheDir, build.SessionNamespace, "chdb-library"), zst, digest)
}

func extractToCache(cacheRoot string, zst []byte, digest string) (string, error) {
	dir := filepath.Join(cacheRoot, digest)
	library := filepath.Join(dir, "libchdb.so")
	marker := filepath.Join(dir, ".complete")
	if fileExists(marker) && fileExists(library) {
		if err := os.Chmod(library, 0o644); err != nil {
			return "", err
		}
		return library, pruneStale(cacheRoot, dir)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create %s: %w", dir, err)
	}
	if err := writeDecompressed(zst, library); err != nil {
		return "", err
	}
	if err := os.WriteFile(marker, []byte(digest+"\n"), 0o644); err != nil {
		return "", err
	}
	return library, pruneStale(cacheRoot, dir)
}

// pruneStale removes libraries extracted by other CLI builds.
func pruneStale(cacheRoot, keep string) error {
	entries, err := os.ReadDir(cacheRoot)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		path := filepath.Join(cacheRoot, entry.Name())
		if path == keep || !entry.IsDir() {
			continue
		}
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove stale chDB cache %s: %w", path, err)
		}
	}
	return nil
}

func writeDecompressed(zst []byte, dest string) error {
	reader, err := zstd.NewReader(bytes.NewReader(zst))
	if err != nil {
		return fmt.Errorf("decompress %s: %w", dest, err)
	}
	defer reader.Close()
	tmp := fmt.Sprintf("%s.%d.tmp", dest, os.Getpid())
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if _, err := io.Copy(file, reader); err != nil {
		file.Close()
		os.Remove(tmp)
		return fmt.Errorf("decompress %s: %w", dest, err)
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dest)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
