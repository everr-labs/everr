//go:build !release

package build

const (
	Release = false

	BuildTypeLabel     = "debug"
	DefaultAPIBaseURL  = "http://localhost:5173"
	DefaultDocsBaseURL = "http://localhost:3000"
	SessionFileName    = "session-dev.json"
	telemetrySubdir    = "telemetry-dev"

	OTLPHTTPPort = 54318
	SQLHTTPPort  = 54320
	LocalUIPort  = 54321
)
