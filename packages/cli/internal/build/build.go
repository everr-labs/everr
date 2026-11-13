// Package build holds the values that differ between debug and release
// builds. Release builds are compiled with `-tags release`; everything else is
// a debug build, matching `cargo build` defaults in the previous CLI.
package build

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	everrcli "github.com/everr-labs/everr/packages/cli"
)

const SessionNamespace = "everr"

func Version() string { return everrcli.Version }

// VersionOutput is what `everr --version` prints after the program name.
func VersionOutput() string {
	return fmt.Sprintf("%s (%s build)", Version(), BuildTypeLabel)
}

var commandName = sync.OnceValue(func() string {
	exe, err := os.Executable()
	if err == nil && strings.HasPrefix(filepath.Base(exe), "everr-dev") {
		return "everr-dev"
	}
	return "everr"
})

// CommandName is the name users type to run this binary: everr-dev for
// installed debug builds, everr otherwise.
func CommandName() string { return commandName() }

// DebugOverride reads an environment override that only debug builds honor,
// so no environment variable can redirect a release binary. A blank value
// counts as unset.
func DebugOverride(name string) (string, bool) {
	if Release {
		return "", false
	}
	value := os.Getenv(name)
	if strings.TrimSpace(value) == "" {
		return "", false
	}
	return value, true
}

func LocalUIOrigin() string {
	if origin, ok := DebugOverride("EVERR_LOCAL_UI_ORIGIN"); ok {
		return origin
	}
	return fmt.Sprintf("http://127.0.0.1:%d", LocalUIPort)
}

// OTLPHTTPOrigin is the local collector's OTLP HTTP origin.
func OTLPHTTPOrigin() string {
	if origin, ok := DebugOverride("EVERR_OTLP_HTTP_ORIGIN"); ok {
		return origin
	}
	return fmt.Sprintf("http://127.0.0.1:%d", OTLPHTTPPort)
}

// SQLHTTPOrigin is the local collector's SQL HTTP origin, which also serves
// the collector's /health.
func SQLHTTPOrigin() string {
	if origin, ok := DebugOverride("EVERR_SQL_HTTP_ORIGIN"); ok {
		return origin
	}
	return fmt.Sprintf("http://127.0.0.1:%d", SQLHTTPPort)
}

func HealthcheckEndpoint() string {
	return strings.TrimRight(SQLHTTPOrigin(), "/") + "/health"
}

// TelemetryDir is the local telemetry data directory shared by the collector
// and CLI queries.
func TelemetryDir() (string, error) {
	if path := strings.TrimSpace(os.Getenv("EVERR_TELEMETRY_DIR")); path != "" {
		return os.Getenv("EVERR_TELEMETRY_DIR"), nil
	}
	base, err := DataLocalDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, SessionNamespace, telemetrySubdir), nil
}

// DataLocalDir mirrors the Rust `dirs::data_local_dir` locations the previous
// CLI stored data in, so upgrades keep finding existing state.
func DataLocalDir() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support"), nil
	default:
		if dir := os.Getenv("XDG_DATA_HOME"); filepath.IsAbs(dir) {
			return dir, nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", errors.New("failed to resolve user local data dir")
		}
		return filepath.Join(home, ".local", "share"), nil
	}
}
