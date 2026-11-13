package everrusageextension

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

// The collector configs in the repository pass the same topology check that
// the extension runs at start, so a queue or routing edit cannot ship broken.
func TestShippedConfigsPassTopology(t *testing.T) {
	for _, path := range []string{
		"../../config.example.yml",
		"../../../scripts/dev/collector-cloud.yaml",
	} {
		t.Run(filepath.Base(path), func(t *testing.T) {
			raw, err := os.ReadFile(path)
			require.NoError(t, err)
			retrieved, err := confmap.NewRetrievedFromYAML(raw)
			require.NoError(t, err)
			conf, err := retrieved.AsConf()
			require.NoError(t, err)
			require.NoError(t, validateTopology(conf))
		})
	}
}
