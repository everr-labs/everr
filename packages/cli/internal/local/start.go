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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/pkg/browser"
	"go.opentelemetry.io/otel"
	"go.uber.org/zap"
	"golang.org/x/sys/unix"
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
	// Serve right away: until setReady, the UI answers as starting rather
	// than leaving connections hanging while chDB loads.
	served := make(chan error, 1)
	go func() { served <- ui.serve() }()
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

	ui.setReady()
	if !args.quiet {
		printStartup()
	}

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
	ui.supervisorStopped()
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
	// chDB only reports a failed connection; its reason goes to the log.
	probe, err := os.CreateTemp(chdbPath, ".write-check-*")
	if err != nil {
		return nil, fmt.Errorf("chDB data directory %s is not writable: %w", chdbPath, err)
	}
	probe.Close()
	_ = os.Remove(probe.Name())
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
	cacheRoot, err := libraryCacheRoot()
	if err != nil {
		return "", err
	}
	// Best effort: a leftover only wastes disk space.
	_ = os.RemoveAll(legacyCollectorAssets(cacheRoot))
	library, inUse, err := extractToCache(cacheRoot, zst, digest)
	if err != nil {
		return "", err
	}
	// Held for the life of the process; closing it would let another build
	// prune the library this one has loaded.
	libraryInUse = inUse
	return library, nil
}

var libraryInUse *os.File

func libraryCacheRoot() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve user cache directory: %w", err)
	}
	return filepath.Join(cacheDir, build.SessionNamespace, "chdb-library"), nil
}

// legacyCollectorAssets is where the Rust CLI unpacked its collector binary
// and libchdb (about 380 MB). Nothing reads it any more.
func legacyCollectorAssets(cacheRoot string) string {
	return filepath.Join(filepath.Dir(cacheRoot), "collector-assets")
}

// RemoveLibraryCache deletes every libchdb extracted by `everr local start`,
// and what the Rust CLI extracted before it.
func RemoveLibraryCache() error {
	cacheRoot, err := libraryCacheRoot()
	if err != nil {
		return err
	}
	return errors.Join(os.RemoveAll(cacheRoot), os.RemoveAll(legacyCollectorAssets(cacheRoot)))
}

// extractToCache unpacks the library into cacheRoot/digest unless a previous
// run already did, and prunes libraries of other builds. Builds with
// separate telemetry locks (`everr` and `everr-dev`) share cacheRoot, so an
// exclusive lock serializes extraction and pruning. The returned file holds a
// shared lock on the library that keeps other builds from pruning it.
func extractToCache(cacheRoot string, zst []byte, digest string) (library string, inUse *os.File, err error) {
	if err := os.MkdirAll(cacheRoot, 0o755); err != nil {
		return "", nil, fmt.Errorf("create %s: %w", cacheRoot, err)
	}
	extracting, err := lockFile(filepath.Join(cacheRoot, ".extract.lock"), unix.LOCK_EX)
	if err != nil {
		return "", nil, err
	}
	defer extracting.Close()

	dir := filepath.Join(cacheRoot, digest)
	library = filepath.Join(dir, "libchdb.so")
	marker := filepath.Join(dir, ".complete")
	if extracted(marker, library) {
		if err := os.Chmod(library, 0o644); err != nil {
			return "", nil, err
		}
	} else {
		// Starts over, dropping temp files an interrupted extraction left
		// behind.
		if err := os.RemoveAll(dir); err != nil {
			return "", nil, fmt.Errorf("clear %s: %w", dir, err)
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", nil, fmt.Errorf("create %s: %w", dir, err)
		}
		size, err := writeDecompressed(zst, library)
		if err != nil {
			return "", nil, err
		}
		if err := writeSynced(marker, fmt.Appendf(nil, "%s %d\n", digest, size)); err != nil {
			return "", nil, err
		}
	}
	if inUse, err = lockFile(filepath.Join(dir, ".in-use"), unix.LOCK_SH); err != nil {
		return "", nil, err
	}
	if err := pruneStale(cacheRoot, dir); err != nil {
		inUse.Close()
		return "", nil, err
	}
	return library, inUse, nil
}

func lockFile(path string, how int) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(file.Fd()), how); err != nil {
		file.Close()
		return nil, fmt.Errorf("lock %s: %w", path, err)
	}
	return file, nil
}

// extracted reports whether a previous extraction finished. The marker
// records the library's size, so a library cut short by a crash is redone.
func extracted(marker, library string) bool {
	data, err := os.ReadFile(marker)
	if err != nil {
		return false
	}
	_, sizeText, ok := strings.Cut(strings.TrimSpace(string(data)), " ")
	if !ok {
		return false
	}
	size, err := strconv.ParseInt(sizeText, 10, 64)
	if err != nil {
		return false
	}
	info, err := os.Stat(library)
	return err == nil && info.Mode().IsRegular() && info.Size() == size
}

// pruneStale removes libraries extracted by other CLI builds, except those a
// running process still holds.
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
		unused, err := lockFile(filepath.Join(path, ".in-use"), unix.LOCK_EX|unix.LOCK_NB)
		if err != nil {
			continue
		}
		err = os.RemoveAll(path)
		unused.Close()
		if err != nil {
			return fmt.Errorf("remove stale chDB cache %s: %w", path, err)
		}
	}
	return nil
}

func writeDecompressed(zst []byte, dest string) (int64, error) {
	reader, err := zstd.NewReader(bytes.NewReader(zst))
	if err != nil {
		return 0, fmt.Errorf("decompress %s: %w", dest, err)
	}
	defer reader.Close()
	var size int64
	err = writeAtomically(dest, func(file *os.File) error {
		size, err = io.Copy(file, reader)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("decompress %s: %w", dest, err)
	}
	return size, nil
}

func writeSynced(dest string, data []byte) error {
	return writeAtomically(dest, func(file *os.File) error {
		_, err := file.Write(data)
		return err
	})
}

// writeAtomically writes dest through a synced temp file, so a crash leaves
// either the old file or the complete new one.
func writeAtomically(dest string, write func(*os.File) error) error {
	tmp := fmt.Sprintf("%s.%d.tmp", dest, os.Getpid())
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	err = write(file)
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp, dest)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}
