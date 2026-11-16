//go:build release

package build

const (
	Release = true

	BuildTypeLabel     = "release"
	DefaultAPIBaseURL  = "https://app.everr.dev"
	DefaultDocsBaseURL = "https://everr.dev"
	SessionFileName    = "session.json"
	telemetrySubdir    = "telemetry"

	OTLPHTTPPort = 54418
	SQLHTTPPort  = 54420
	LocalUIPort  = 54421
)
